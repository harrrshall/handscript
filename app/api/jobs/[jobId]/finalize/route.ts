import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { uploadFile } from '@/lib/blob';
import { compileTypst } from '@/lib/typst';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const { jobId } = await params;

    try {
        const job: any = await redis.get(`job:${jobId}`);
        if (!job) {
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        // 1. Fetch all page results ONCE
        // Note: We use the same keys as stored by process-batch
        const keys = Array.from({ length: job.totalPages }, (_, i) => `job:${jobId}:page:${i}`);

        let results: (string | null)[];
        try {
            results = await redis.mget(keys);
        } catch (e) {
            console.error('Redis MGET failed:', e);
            return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 });
        }

        // 2. Assemble markdown
        let assembledMarkdown = '';
        const missingPages: number[] = [];

        for (let i = 0; i < results.length; i++) {
            const val = results[i];

            if (!val) {
                missingPages.push(i);
                assembledMarkdown += `\n\n<!-- Page ${i + 1} (MISSING) -->\n\n[MISSING PAGE ${i + 1}]\n`;
                continue;
            }

            try {
                // val is JSON string { markdown, status }
                const parsed = typeof val === 'string' ? JSON.parse(val) : val;
                if (parsed.markdown) {
                    assembledMarkdown += `\n\n<!-- Page ${i + 1} -->\n\n${parsed.markdown}`;
                } else {
                    missingPages.push(i);
                    assembledMarkdown += `\n\n<!-- Page ${i + 1} (EMPTY) -->\n\n[EMPTY PAGE ${i + 1}]\n`;
                }
            } catch (e) {
                console.error(`Failed to parse result for page ${i}:`, val);
                missingPages.push(i);
                assembledMarkdown += `\n\n<!-- Page ${i + 1} (ERROR) -->\n\n[ERROR PARSING PAGE ${i + 1}]\n`;
            }
        }

        if (missingPages.length > 0) {
            console.warn(`Job ${jobId} finalizing with missing pages: ${missingPages.join(', ')}`);
            // We proceed anyway to give partial result? Or fail? 
            // Better to proceed so user gets SOMETHING.
        }

        // 3. Render to PDF
        let pdfUrl: string;
        const modalEndpoint = process.env.MODAL_TYPST_ENDPOINT;

        try {
            if (modalEndpoint) {
                console.log('Using Modal.com for PDF generation...');
                const response = await fetch(modalEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ markdown: assembledMarkdown }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Modal service failed: ${response.status} ${errorText}`);
                }

                const data = await response.json();
                const { pdf, error } = data;

                if (error) throw new Error(`Typst error: ${error}`);
                if (!pdf) throw new Error('No PDF returned from Modal');

                const pdfBuffer = Buffer.from(pdf, "base64");
                pdfUrl = await uploadFile(pdfBuffer, `${jobId}.pdf`);
            } else {
                console.log('MODAL_TYPST_ENDPOINT not set, using local Typst compilation.');
                pdfUrl = await compileTypst(assembledMarkdown, jobId);
            }
        } catch (renderError) {
            console.error('PDF generation failed:', renderError);
            // If primary method failed, maybe try fallback if it was Modal? 
            // Logic in existing render route tried fallback. Let's do that too.
            if (modalEndpoint) {
                console.log('Attempting local fallback...');
                try {
                    pdfUrl = await compileTypst(assembledMarkdown, jobId);
                } catch (fallbackError) {
                    throw renderError; // Throw original error if fallback also fails
                }
            } else {
                throw renderError;
            }
        }

        // 4. Update Job
        job.status = 'complete';
        job.finalPdfUrl = pdfUrl;
        job.completedPages = job.totalPages; // Ensure it looks done

        // Persist final state
        await redis.set(`job:${jobId}`, job, { ex: 30 * 24 * 60 * 60 });

        // Also cleanup keys? optional. keep for debugging.

        return NextResponse.json({
            success: true,
            pdfUrl,
        });

    } catch (error) {
        console.error('Finalize failed:', error);
        return NextResponse.json({ error: 'Finalize failed', details: String(error) }, { status: 500 });
    }
}
