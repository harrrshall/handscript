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

        // Fetch assembled content
        const keys = Array.from({ length: job.totalPages }, (_, i) => `job:${jobId}:page:${i}`);
        const results = await redis.mget(keys);
        let assembledMarkdown = '';
        for (let i = 0; i < results.length; i++) {
            const res = results[i] as any;
            if (res && res.markdown) {
                assembledMarkdown += `\n\n<!-- Page ${i + 1} -->\n\n`;
                assembledMarkdown += res.markdown;
            }
        }

        let pdfUrl: string;

        // Call Modal.com endpoint if configured
        const modalEndpoint = process.env.MODAL_TYPST_ENDPOINT;

        if (modalEndpoint) {
            try {
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

                if (error) {
                    throw new Error(`Typst error: ${error}`);
                }

                if (!pdf) {
                    throw new Error('No PDF returned from Modal');
                }

                // Upload to Vercel Blob
                const pdfBuffer = Buffer.from(pdf, "base64");
                pdfUrl = await uploadFile(pdfBuffer, `${jobId}.pdf`);
            } catch (modalError) {
                console.error('Modal generation failed, falling back to local:', modalError);
                // Fallback to local
                pdfUrl = await compileTypst(assembledMarkdown, jobId);
            }
        } else {
            console.log('MODAL_TYPST_ENDPOINT not set, using local Typst compilation.');
            // Fallback to local
            pdfUrl = await compileTypst(assembledMarkdown, jobId);
        }

        // Update Job
        job.status = 'complete';
        job.finalPdfUrl = pdfUrl;
        await redis.set(`job:${jobId}`, job, { ex: 30 * 24 * 60 * 60 });

        return NextResponse.json({
            success: true,
            pdfUrl,
        });

    } catch (error) {
        console.error('Render failed:', error);
        return NextResponse.json({ error: 'Render failed', details: String(error) }, { status: 500 });
    }
}
