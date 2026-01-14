import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { uploadFile } from '@/lib/blob';
import { wrapWithTemplate } from '@/lib/html-template';
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

        // 2. Process pages in PARALLEL (Robust Isolation)
        const modalEndpoint = process.env.MODAL_PDF_ENDPOINT;

        const renderPromises = results.map(async (val, i) => {
            let pageHtml = "";

            if (!val) {
                // Track missing but validly return a placeholder PDF for them
                pageHtml = "<p>[MISSING PAGE CONTENT]</p>";
            } else {
                try {
                    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
                    // Support new 'html' or legacy 'typst'/'markdown' (fallback to text)
                    pageHtml = parsed.html || parsed.typst || parsed.markdown || "<p>[EMPTY PAGE]</p>";
                } catch (e) {
                    pageHtml = "<p>[ERROR PARSING PAGE CACHE]</p>";
                }
            }

            // Wrap in template
            const fullHtml = wrapWithTemplate(pageHtml);

            try {
                // Attempt Render
                const renderStart = Date.now();
                if (!modalEndpoint) throw new Error("No rendering endpoint configured");

                const response = await fetch(modalEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ html: fullHtml }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Modal status ${response.status}: ${errorText}`);
                }
                const data = await response.json();
                if (data.error) throw new Error(data.error);
                if (!data.pdf) throw new Error("No PDF returned");

                const pdfBuffer = Buffer.from(data.pdf, 'base64');
                console.log(JSON.stringify({
                    event: 'RenderSuccess',
                    jobId,
                    pageIndex: i,
                    durationMs: Date.now() - renderStart,
                    timestamp: new Date().toISOString()
                }));

                return pdfBuffer;

            } catch (renderError) {
                console.error(JSON.stringify({
                    event: 'RenderFailed',
                    jobId,
                    pageIndex: i,
                    error: String(renderError),
                    timestamp: new Date().toISOString()
                }));

                // Fallback Strategy

                // 1. Recover with Simple HTML (Modal) using stripped down content
                try {
                    if (modalEndpoint) {
                        const simpleHtml = wrapWithTemplate(`<h1>Page ${i + 1} (Recovery)</h1><p>Rendering failed due to complexity.</p><hr/><p>Original content was too complex.</p>`);

                        const response = await fetch(modalEndpoint, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ html: simpleHtml }),
                        });

                        if (response.ok) {
                            const data = await response.json();
                            if (data.pdf) return Buffer.from(data.pdf, 'base64');
                        }
                    }
                } catch (fallbackError) {
                    // ignore
                }

                // 2. Ultimate Fallback: Blank PDF with Error Message
                try {
                    const doc = await PDFDocument.create();
                    const page = doc.addPage();
                    const { height } = page.getSize();
                    const font = await doc.embedFont('Helvetica');

                    page.drawText(`Page ${i + 1} Rendering Failed`, { x: 50, y: height - 50, size: 24, font });
                    page.drawText(`We apologize, but this page could not be rendered.`, { x: 50, y: height - 100, size: 12, font });

                    const fallbackPdf = await doc.save();
                    console.log(JSON.stringify({
                        event: 'FallbackUsed',
                        jobId,
                        pageIndex: i,
                        type: 'blank_page_pdflib',
                        timestamp: new Date().toISOString()
                    }));
                    return fallbackPdf;

                } catch (pdfLibError) {
                    console.error("Critical: Failed to generate even blank PDF page", pdfLibError);
                    // Return minimal empty PDF buffer if all else fails.
                    return new Uint8Array(0);
                }
            }
        });

        // Await all parallel requests
        const pdfResults = await Promise.all(renderPromises);

        // Filter out any completely failed renders (Uint8Array(0))
        const pdfDocs = pdfResults.filter(b => b && b.length > 0) as Uint8Array[];

        // Check for completely missing pages logic
        const missingPages = results
            .map((val, idx) => val ? -1 : idx)
            .filter(idx => idx !== -1);

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
