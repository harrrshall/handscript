import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { uploadFile, deleteFile, getDownloadUrl } from '@/lib/s3';
import { wrapWithTemplate } from '@/lib/html-template';
import { PDFDocument } from 'pdf-lib';
import { queueEmailDelivery, queueErrorEmail } from '@/lib/queue';
import { env } from '@/lib/env';
import { withRetry, withTimeout, getBaseUrl } from '@/lib/utils';
import { logger, metrics } from '@/lib/logger';

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
    endpoint: env.B2_ENDPOINT.startsWith("http")
        ? env.B2_ENDPOINT
        : `https://${env.B2_ENDPOINT}`,
    region: env.B2_REGION,
    credentials: {
        accessKeyId: env.B2_KEY_ID,
        secretAccessKey: env.B2_APPLICATION_KEY,
    },
});

// Add helper function to download PDF from B2 key
async function downloadPdfFromB2(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
        Bucket: env.B2_BUCKET_NAME,
        Key: key,
    });

    const response = await s3Client.send(command);
    const chunks: Uint8Array[] = [];

    // @ts-ignore - Body is a readable stream
    for await (const chunk of response.Body) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const startTime = Date.now();
    const { jobId } = await params;

    logger.info('FinalizeStart', { jobId });
    await logger.logToRedis(jobId, "Starting PDF finalization...");

    try {
        const job: any = await redis.get(`job:${jobId}`);
        if (!job) {
            logger.error('FinalizeError', { jobId, error: 'Job not found in Redis' });
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        // 1. Fetch all page results ONCE
        const keys = Array.from({ length: job.totalPages }, (_, i) => `job:${jobId}:page:${i}`);

        let results: (string | null)[];
        try {
            results = await redis.mget(keys);
            await logger.logToRedis(jobId, `Retrieved ${results.length} pages from storage.`);
        } catch (e: any) {
            logger.error('RedisError', {
                jobId,
                operation: 'mget',
                error: e.message,
                stack: e.stack
            });
            await logger.logToRedis(jobId, `Finalization failed: ${e.message}`);
            return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 });
        }

        // 2. Process pages in PARALLEL (Robust Isolation)
        const modalEndpoint = env.MODAL_PDF_ENDPOINT;

        const renderPromises = results.map(async (val, i) => {
            let pageHtml = "";

            if (!val) {
                // Track missing but validly return a placeholder PDF for them
                pageHtml = "<p>[MISSING PAGE CONTENT]</p>";
            } else {
                try {
                    const parsed = typeof val === 'string' ? JSON.parse(val) : val;
                    // Support new 'html' only (legacy 'typst'/'markdown' removed)
                    pageHtml = parsed.html || "<p>[EMPTY PAGE]</p>";
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

                const response = await withRetry(
                    () => withTimeout(
                        fetch(modalEndpoint, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                html: fullHtml,
                                job_id: jobId,
                                page_index: i,
                                upload_to_b2: true, // Enable direct B2 upload
                            }),
                        }),
                        30000,
                        "Modal request timed out"
                    ),
                    {
                        maxRetries: 3,
                        baseDelayMs: 1000,
                        onRetry: (attempt, err) => logger.warn(`ModalRetry`, { jobId, pageIndex: i, attempt, error: err.message })
                    }
                );

                const duration = Date.now() - renderStart;
                await metrics.recordLatency("page_render", duration);

                if (!response.ok) {
                    const errorText = await response.text();
                    logger.error('ModalResponseError', { jobId, pageIndex: i, status: response.status, error: errorText });
                    throw new Error(`Modal status ${response.status}: ${errorText}`);
                }
                const data = await response.json();

                // DEBUG LOGGING
                logger.debug('ModalResponseDebug', {
                    jobId,
                    pageIndex: i,
                    status: response.status,
                    hasPdf: !!data.pdf,
                    hasKey: !!data.key,
                    hasError: !!data.error,
                    timestamp: new Date().toISOString()
                });

                if (data.error) throw new Error(data.error);

                if (!data.pdf && !data.key) {
                    throw new Error("Modal returned empty response (no PDF or B2 key)");
                }

                // Check if Modal uploaded directly to B2
                if (data.key) {
                    // Download from B2 for merging (internal fast transfer)
                    const pdfBuffer = await downloadPdfFromB2(data.key);

                    // Clean up temporary page PDF from B2
                    await deleteFile(data.key);

                    logger.info("RenderSuccess", {
                        jobId,
                        pageIndex: i,
                        method: "b2-direct",
                        durationMs: duration,
                    });

                    return pdfBuffer;
                }

                if (!data.pdf) throw new Error("No PDF returned");

                const pdfBuffer = Buffer.from(data.pdf, 'base64');
                logger.info('RenderSuccess', {
                    jobId,
                    pageIndex: i,
                    method: "base64-fallback",
                    durationMs: duration,
                });

                return pdfBuffer;

            } catch (renderError) {
                logger.error('RenderFailed', {
                    jobId,
                    pageIndex: i,
                    error: String(renderError),
                    endpoint: modalEndpoint,
                });

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
                            if (data.pdf) {
                                logger.warn('FallbackUsed', { jobId, pageIndex: i, type: 'simple_html_modal' });
                                return Buffer.from(data.pdf, 'base64');
                            }
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
                    logger.warn('FallbackUsed', {
                        jobId,
                        pageIndex: i,
                        type: 'blank_page_pdflib',
                    });
                    return fallbackPdf;

                } catch (pdfLibError) {
                    logger.critical('PdfLibFallbackFailed', { jobId, pageIndex: i, error: String(pdfLibError) });
                    // Return minimal empty PDF buffer if all else fails.
                    return new Uint8Array(0);
                }
            }
        });

        const pdfSettledResults = await Promise.allSettled(renderPromises);
        await logger.logToRedis(jobId, "All pages rendered. Assembling PDF...");

        const pdfResults = pdfSettledResults.map((res, idx) => {
            if (res.status === 'fulfilled') return res.value;
            logger.error(`FinalizePageError`, { jobId, pageIndex: idx, error: String(res.reason) });
            return null;
        });

        // Filter out any completely failed renders (Uint8Array(0))
        const pdfDocs = pdfResults.filter(b => b && b.length > 0) as Uint8Array[];

        // Check for completely missing pages logic
        const missingPages = results
            .map((val, idx) => val ? -1 : idx)
            .filter(idx => idx !== -1);

        if (missingPages.length > 0) {
            logger.warn('MissingPagesDetected', {
                jobId,
                missingCount: missingPages.length,
                missingIndices: missingPages,
            });
        }

        // 3. Merge PDFs
        if (pdfDocs.length === 0) {
            logger.error('NoPagesGenerated', { jobId });
            return NextResponse.json({ error: 'No pages could be generated' }, { status: 500 });
        }

        const mergedPdf = await PDFDocument.create();
        let pagesMergedCount = 0;
        for (const [idx, pdfBytes] of pdfDocs.entries()) {
            try {
                const doc = await PDFDocument.load(pdfBytes);
                const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
                copiedPages.forEach((page) => mergedPdf.addPage(page));
                pagesMergedCount++;
            } catch (mergeError) {
                logger.error('FinalizeMergeError', { jobId, metadata: { pageIndex: idx }, error: String(mergeError) });
            }
        }

        const finalPdfBytes = await mergedPdf.save();
        const pdfKey = await uploadFile(`outputs/${jobId}.pdf`, Buffer.from(finalPdfBytes), 'application/pdf');

        // Generate pre-signed URL for immediate access (Force download)
        const pdfUrl = await getDownloadUrl(pdfKey, 3600, 'handscript-notes.pdf');

        // 4. Update Job
        job.status = 'complete';
        job.finalPdfUrl = pdfUrl; // Presigned URL for frontend
        job.finalPdfKey = pdfKey; // Store key for future re-signing if needed
        job.completedPages = job.totalPages;

        // Queue email notification if email provided
        if (job.email) {
            try {
                await queueEmailDelivery({
                    jobId,
                    email: job.email,
                    pdfUrl,
                    pdfKey,
                });
                job.emailStatus = "queued";
                logger.info("EmailQueued", {
                    jobId,
                    email: job.email,
                });
            } catch (queueError) {
                // Don't fail the job - email is best-effort
                job.emailStatus = "queue_failed";
                logger.error("EmailQueueFailed", {
                    jobId,
                    error: String(queueError),
                });
            }
        }

        // Persist final state
        await redis.set(`job:${jobId}`, job, { ex: 30 * 24 * 60 * 60 });

        // CLEANUP: Immediately delete input images to save storage
        // We do this asynchronously so we don't block the response, but we catch errors to log them.
        (async () => {
            try {
                const inputFiles = job.pageManifest;
                if (inputFiles && inputFiles.length > 0) {
                    await deleteFile(inputFiles);
                    logger.info('InputCleanup', {
                        jobId,
                        count: inputFiles.length,
                    });
                }

                // Delete page cache from Redis
                const pageKeys = Array.from(
                    { length: job.totalPages },
                    (_, i) => `job:${jobId}:page:${i}`
                );
                if (pageKeys.length > 0) await redis.del(...pageKeys);
                await redis.del(`job:${jobId}:completed`);
                await redis.del(`job:${jobId}:logs`);

            } catch (cleanupError) {
                logger.error('CleanupFailed', {
                    jobId,
                    error: String(cleanupError),
                });
            }
        })();

        await logger.logToRedis(jobId, "PDF successfully generated and stored.");

        const duration = Date.now() - startTime;
        await metrics.increment("jobs_completed");
        await metrics.recordLatency("job_completion", duration);

        logger.info('FinalizeComplete', { jobId, duration });

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

        // Mark job as failed and send error email
        try {
            const job: any = await redis.get(`job:${jobId}`);
            if (job && job.email) {
                job.status = 'failed';
                job.error = String(error);
                await redis.set(`job:${jobId}`, job);

                // Queue error notification email
                await queueErrorEmail({
                    jobId,
                    email: job.email,
                    errorMessage: "PDF generation failed. This may be due to complex content or a temporary issue."
                });
            }
        } catch (emailError) {
            console.error("Failed to queue error email:", emailError);
        }

        return NextResponse.json({ error: 'Finalize failed', details: String(error) }, { status: 500 });
    }
}
