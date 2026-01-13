import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { uploadFile } from '@/lib/blob';
import { compileTypst } from '@/lib/typst';
import { sanitizeLatex } from '@/lib/latex-sanitizer';
import { PDFDocument } from 'pdf-lib';

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

        // 2. Process pages individually (Page-Level Isolation)
        const pdfDocs: Uint8Array[] = [];
        const missingPages: number[] = [];
        const modalEndpoint = process.env.MODAL_TYPST_ENDPOINT;

        for (let i = 0; i < results.length; i++) {
            const val = results[i];
            let pageMarkdown = "";

            if (!val) {
                missingPages.push(i);
                pageMarkdown = "[MISSING PAGE CONTENT]";
            } else {
                try {
                    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
                    pageMarkdown = parsed.markdown || "[EMPTY PAGE]";
                } catch (e) {
                    pageMarkdown = "[ERROR PARSING PAGE CACHE]";
                }
            }

            // Sanitize
            const sanitized = sanitizeLatex(pageMarkdown);

            // Render Page
            try {
                let pagePdf: Uint8Array;

                if (modalEndpoint) {
                    const response = await fetch(modalEndpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ markdown: sanitized }),
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Modal status ${response.status}: ${errorText}`);
                    }
                    const data = await response.json();
                    if (data.error) throw new Error(data.error);
                    if (!data.pdf) throw new Error("No PDF returned");

                    pagePdf = Buffer.from(data.pdf, 'base64');
                } else {
                    throw new Error("No rendering endpoint configured");
                }

                pdfDocs.push(pagePdf);

            } catch (renderError) {
                console.error(JSON.stringify({
                    event: 'PageRenderFailed',
                    jobId,
                    pageIndex: i,
                    error: String(renderError)
                }));

                // Fallback Strategy
                // 1. Try rendering with text only (strip math)
                // 2. If that fails, create blank PDF page with error message

                try {
                    if (modalEndpoint) {
                        // Aggressive sanitize: strip known math delimiters
                        const textOnly = sanitized
                            .replace(/\$\$[\s\S]*?\$\$/g, '[COMPLEX MATH REMOVED]')
                            .replace(/\$[^$]+\$/g, '[MATH REMOVED]');

                        const fallbackMd = `# Page ${i + 1} (Recovered)\n\n> **Note:** The original content could not be fully rendered due to complex mathematical notation. The raw text is preserved below.\n\n---\n\n${textOnly}`;

                        const response = await fetch(modalEndpoint, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ markdown: fallbackMd }),
                        });

                        if (response.ok) {
                            const data = await response.json();
                            if (data.pdf) {
                                pdfDocs.push(Buffer.from(data.pdf, 'base64'));
                                console.log(`Page ${i} recovered via text-only fallback`);
                                continue;
                            }
                        }
                    }
                } catch (fallbackError) {
                    console.error("Fallback render also failed", fallbackError);
                }

                // Ultimate fallback: Use pdf-lib to create a blank page with error text
                try {
                    const doc = await PDFDocument.create();
                    const page = doc.addPage();
                    const { height } = page.getSize();

                    page.drawText(`Page ${i + 1} Rendering Failed`, { x: 50, y: height - 50, size: 24 });
                    page.drawText(`We apologize, but this page could not be rendered.`, { x: 50, y: height - 100, size: 12 });
                    page.drawText(`Please check the original notes.`, { x: 50, y: height - 120, size: 12 });

                    const fallbackPdf = await doc.save();
                    pdfDocs.push(fallbackPdf);
                } catch (pdfLibError) {
                    console.error("Critical: Failed to generate even blank PDF page", pdfLibError);
                    // If even this fails, we are in trouble. We might skip the page or fail job.
                    // Skipping is safer than crashing.
                }
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

        // 3. Merge PDFs
        if (pdfDocs.length === 0) {
            console.error(JSON.stringify({ event: 'NoPagesGenerated', jobId }));
            return NextResponse.json({ error: 'No pages could be generated' }, { status: 500 });
        }

        const mergedPdf = await PDFDocument.create();
        for (const pdfBytes of pdfDocs) {
            const doc = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }

        const finalPdfBytes = await mergedPdf.save();
        const pdfUrl = await uploadFile(Buffer.from(finalPdfBytes), `${jobId}.pdf`);

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
