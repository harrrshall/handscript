import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { uploadFile } from '@/lib/blob';
import { compileTypst } from '@/lib/typst';
import { sanitizeLatex } from '@/lib/latex-sanitizer';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const startTime = Date.now();
    const { jobId } = await params;

    console.log(JSON.stringify({
        event: 'FinalizeStart',
        jobId,
        timestamp: new Date().toISOString()
    }));

    try {
        const job: any = await redis.get(`job:${jobId}`);
        if (!job) {
            console.error(JSON.stringify({
                event: 'FinalizeError',
                jobId,
                error: 'Job not found in Redis',
                timestamp: new Date().toISOString()
            }));
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        // 1. Fetch all page results ONCE
        const keys = Array.from({ length: job.totalPages }, (_, i) => `job:${jobId}:page:${i}`);

        let results: (string | null)[];
        try {
            results = await redis.mget(keys);
        } catch (e) {
            console.error(JSON.stringify({
                event: 'RedisError',
                jobId,
                operation: 'mget',
                error: String(e),
                timestamp: new Date().toISOString()
            }));
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
            console.warn(JSON.stringify({
                event: 'MissingPagesDetected',
                jobId,
                missingCount: missingPages.length,
                missingIndices: missingPages,
                timestamp: new Date().toISOString()
            }));
        }

        // 3. Render to PDF
        // Sanitize LaTeX before rendering
        const sanitizedMarkdown = sanitizeLatex(assembledMarkdown);

        let pdfUrl: string;
        const modalEndpoint = process.env.MODAL_TYPST_ENDPOINT;

        try {
            if (modalEndpoint) {
                console.log(JSON.stringify({ event: 'RenderingMode', mode: 'Modal', jobId }));
                const response = await fetch(modalEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ markdown: sanitizedMarkdown }),
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
                // On Vercel, this branch should effectively be unreachable if configured correctly,
                // or we return an error because local fallback is not supported.
                // However, for local dev, we might still want it.
                // But the solution says "Remove dead fallback code". 
                // If we are strictly fixing Vercel, we should assume MODAL_TYPST_ENDPOINT is set.
                // If it's NOT set, and we are on Vercel, we fail.
                // If we are local, we can keep it? 
                // The instruction was "Remove broken local local fallback".
                // "The local fallback was designed for development environments... dead code in production."
                // "Option A: Remove local typst call entirely"

                // However, I see `compileTypst` being imported.
                // Let's rely on the environment check.
                // If NO modal endpoint, we *could* try local if we are sure we are not on Vercel,
                // but checking for Vercel env is better.
                // For now, I will remove the logic that *tries* to fallback if Modal fails.
                // And if no Modal endpoint is provided, I will throw an error or use local ONLY if explicit.

                // Current logic: if (modalEndpoint) try modal, else local.
                // New logic: Same, BUT remove the CATCH block that falls back.

                console.log(JSON.stringify({ event: 'RenderingMode', mode: 'LocalTypst', jobId }));
                pdfUrl = await compileTypst(sanitizedMarkdown, jobId);
            }
        } catch (renderError) {
            console.error(JSON.stringify({
                event: 'RenderError',
                jobId,
                error: String(renderError),
                timestamp: new Date().toISOString()
            }));
            throw renderError; // Fail immediately, do not try fallback
        }

        // 4. Update Job
        job.status = 'complete';
        job.finalPdfUrl = pdfUrl;
        job.completedPages = job.totalPages;

        // Persist final state
        await redis.set(`job:${jobId}`, job, { ex: 30 * 24 * 60 * 60 });

        const totalDuration = Date.now() - startTime;

        console.log(JSON.stringify({
            event: 'JobComplete',
            jobId,
            pages: job.totalPages,
            missingPages: missingPages.length,
            durationMs: totalDuration,
            pdfUrl,
            timestamp: new Date().toISOString()
        }));

        return NextResponse.json({
            success: true,
            pdfUrl,
        });

    } catch (error) {
        console.error(JSON.stringify({
            event: 'FinalizeFailed',
            jobId,
            error: String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        }));
        return NextResponse.json({ error: 'Finalize failed', details: String(error) }, { status: 500 });
    }
}
