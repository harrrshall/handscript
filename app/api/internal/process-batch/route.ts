
import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/redis";
import { generateBatchNotes } from "@/lib/gemini";
import { renderToHtml } from "@/lib/formatting";
import { z } from "zod";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BatchResponse, Page } from "@/lib/schema";
import { publishToQStash, queueErrorEmail } from "@/lib/queue";
import { env } from "@/lib/env";
import { getBaseUrl } from "@/lib/utils";
import { logger, metrics } from "@/lib/logger";

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

const processBatchSchema = z.object({
    jobId: z.string(),
    batchIndex: z.number().min(0),
    manifest: z.array(z.string()).min(1),
});

// Local logToRedis removed in favor of centralized logger.logToRedis

async function handler(request: NextRequest) {
    const startTime = Date.now();
    const retryCount = parseInt(request.headers.get('Upstash-Retried') || '0');
    const maxRetries = 3;

    let body: any = null;
    try {
        body = await request.json();
        const { jobId, batchIndex, manifest } = processBatchSchema.parse(body);

        const BATCH_SIZE = 3;
        const start = batchIndex * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, manifest.length);
        const keys = manifest.slice(start, end);

        await logger.logToRedis(jobId, `Starting batch ${batchIndex + 1}/${Math.ceil(manifest.length / BATCH_SIZE)} (Pages ${start}-${end - 1})`);

        if (keys.length === 0) {
            const baseUrl = getBaseUrl();
            await publishToQStash(`${baseUrl}/api/jobs/${jobId}/finalize`, {});
            return NextResponse.json({ success: true, status: "complete" });
        }

        logger.info("BatchProcessingStart", {
            jobId,
            batchIndex,
            metadata: { keyCount: keys.length }
        });

        // Generate signed URLs
        const signedUrls = await Promise.all(
            keys.map(async (key) => {
                const command = new GetObjectCommand({
                    Bucket: env.B2_BUCKET_NAME,
                    Key: key,
                });
                return getSignedUrl(s3Client, command, { expiresIn: 7200 }); // 2 hours
            })
        );

        // Call Gemini
        let batchResponse: BatchResponse | null = null;
        try {
            batchResponse = await generateBatchNotes(signedUrls);
            await logger.logToRedis(jobId, `Gemini success for batch ${batchIndex}`);
        } catch (geminiError: any) {
            await logger.logToRedis(jobId, `Gemini error for batch ${batchIndex}: ${geminiError.message}`);
            logger.error('GeminiGenerationFailed', {
                jobId,
                batchIndex,
                error: geminiError.message,
                stack: geminiError.stack,
                metadata: { retryCount }
            });
            throw geminiError; // Let QStash retry
        }

        // Process pages
        const processedPages: string[] = new Array(keys.length).fill(
            "<p>[UNCLEAR: Page processing failed]</p>"
        );

        if (batchResponse) {
            batchResponse.pages.forEach((page: Page) => {
                if (page.pageIndex >= 0 && page.pageIndex < keys.length) {
                    const pageIR = {
                        metadata: batchResponse.metadata,
                        content: page.content,
                    };
                    processedPages[page.pageIndex] = renderToHtml(pageIR);
                }
            });
        }

        // Store in Redis
        const msetObj: Record<string, string> = {};
        processedPages.forEach((html, index) => {
            const pageIndex = start + index;
            msetObj[`job:${jobId}:page:${pageIndex}`] = JSON.stringify({
                html,
                status: "complete",
            });
        });

        await redis.mset(msetObj);
        await redis.incrby(`job:${jobId}:completed`, keys.length);
        await logger.logToRedis(jobId, `Completed batch ${batchIndex}. Progress: ${start + keys.length}/${manifest.length}`);

        // Trigger Next Batch recursively
        const nextBatchIndex = batchIndex + 1;
        const totalBatches = Math.ceil(manifest.length / BATCH_SIZE);

        const baseUrl = getBaseUrl();

        if (nextBatchIndex < totalBatches) {
            await publishToQStash(`${baseUrl}/api/internal/process-batch`, {
                jobId,
                batchIndex: nextBatchIndex,
                manifest
            });
        } else {
            await logger.logToRedis(jobId, "All batches sent to Gemini. Finalizing...");
            await publishToQStash(`${baseUrl}/api/jobs/${jobId}/finalize`, {});
        }

        const duration = Date.now() - startTime;
        await metrics.increment("batches_processed");
        await metrics.recordLatency("batch_processing", duration);
        return NextResponse.json({
            success: true,
            processed: keys.length,
            duration,
        });

    } catch (error: any) {
        logger.error('BatchProcessingFailed', {
            jobId: body?.jobId || 'unknown',
            batchIndex: body?.batchIndex,
            error: error.message,
            stack: error.stack,
            metadata: { retryCount }
        });

        if (body?.jobId) {
            await logger.logToRedis(body.jobId, `Batch ${body.batchIndex} failed: ${error.message}`);
        }

        if (retryCount >= maxRetries && body?.jobId) {
            try {
                const jobId = body.jobId;
                const job: any = await redis.get(`job:${jobId}`);

                if (job && job.email) {
                    job.status = 'failed';
                    job.error = `Processing failed after ${maxRetries} retries: ${error.message}`;
                    await redis.set(`job:${jobId}`, job);

                    await queueErrorEmail({
                        jobId,
                        email: job.email,
                        errorMessage: "We couldn't process your notes after multiple attempts."
                    });
                }
            } catch (notifyError) {
                console.error("Failed to notify user of error:", notifyError);
            }
        }

        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}

let POST_HANDLER: any = handler;
if (process.env.NODE_ENV === 'production' && process.env.QSTASH_CURRENT_SIGNING_KEY) {
    POST_HANDLER = verifySignatureAppRouter(handler);
}

export const POST = POST_HANDLER;
