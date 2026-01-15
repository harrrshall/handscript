
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

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT?.startsWith("http")
        ? process.env.B2_ENDPOINT
        : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION,
    credentials: {
        accessKeyId: process.env.B2_KEY_ID!,
        secretAccessKey: process.env.B2_APPLICATION_KEY!,
    },
});

const processBatchSchema = z.object({
    jobId: z.string(),
    batchIndex: z.number().min(0),
    manifest: z.array(z.string()).min(1),
});

async function logToRedis(jobId: string, msg: string) {
    try {
        const logMsg = `${new Date().toISOString()} ${msg}`;
        await redis.lpush(`job:${jobId}:logs`, logMsg);
        await redis.ltrim(`job:${jobId}:logs`, 0, 49); // Keep last 50 logs
        await redis.expire(`job:${jobId}:logs`, 24 * 60 * 60); // 24h expiry
    } catch (e) { console.error("Redis log failed", e); }
}

async function handler(request: NextRequest) {
    const startTime = Date.now();
    const retryCount = parseInt(request.headers.get('Upstash-Retried') || '0');
    const maxRetries = 3;

    let body: any = null;
    try {
        body = await request.json();
        const { jobId, batchIndex, manifest } = processBatchSchema.parse(body);

        const BATCH_SIZE = 1; // Critical fix for Vercel 10s timeout
        const start = batchIndex * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, manifest.length);
        const keys = manifest.slice(start, end);

        await logToRedis(jobId, `Starting batch ${batchIndex + 1}/${Math.ceil(manifest.length / BATCH_SIZE)} (Pages ${start}-${end - 1})`);

        if (keys.length === 0) {
            const baseUrl = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : "http://localhost:3000";

            await publishToQStash(`${baseUrl}/api/jobs/${jobId}/finalize`, {});
            return NextResponse.json({ success: true, status: "complete" });
        }

        console.log(
            JSON.stringify({
                event: "BatchProcessingStart",
                jobId,
                batchIndex,
                keyCount: keys.length,
                timestamp: new Date().toISOString(),
            })
        );

        // Generate signed URLs
        const signedUrls = await Promise.all(
            keys.map(async (key) => {
                const command = new GetObjectCommand({
                    Bucket: process.env.B2_BUCKET_NAME,
                    Key: key,
                });
                return getSignedUrl(s3Client, command, { expiresIn: 7200 }); // 2 hours
            })
        );

        // Call Gemini
        let batchResponse: BatchResponse | null = null;
        try {
            batchResponse = await generateBatchNotes(signedUrls);
            await logToRedis(jobId, `Gemini success for batch ${batchIndex}`);
        } catch (geminiError: any) {
            await logToRedis(jobId, `Gemini error for batch ${batchIndex}: ${geminiError.message}`);
            console.error(JSON.stringify({
                event: 'GeminiGenerationFailed',
                jobId,
                batchIndex,
                error: geminiError.message,
                stack: geminiError.stack,
                retryCount,
                timestamp: new Date().toISOString()
            }));
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
        await logToRedis(jobId, `Completed batch ${batchIndex}. Progress: ${start + keys.length}/${manifest.length}`);

        // Trigger Next Batch recursively
        const nextBatchIndex = batchIndex + 1;
        const totalBatches = Math.ceil(manifest.length / BATCH_SIZE);

        const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000";

        if (nextBatchIndex < totalBatches) {
            await publishToQStash(`${baseUrl}/api/internal/process-batch`, {
                jobId,
                batchIndex: nextBatchIndex,
                manifest
            });
        } else {
            await logToRedis(jobId, "All batches sent to Gemini. Finalizing...");
            await publishToQStash(`${baseUrl}/api/jobs/${jobId}/finalize`, {});
        }

        const duration = Date.now() - startTime;
        return NextResponse.json({
            success: true,
            processed: keys.length,
            duration,
        });

    } catch (error: any) {
        console.error(JSON.stringify({
            event: 'BatchProcessingFailed',
            jobId: body?.jobId || 'unknown',
            batchIndex: body?.batchIndex,
            error: error.message,
            stack: error.stack,
            retryCount,
            timestamp: new Date().toISOString()
        }));

        if (body?.jobId) {
            await logToRedis(body.jobId, `Batch ${body.batchIndex} failed: ${error.message}`);
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
