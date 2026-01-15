
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

async function handler(request: NextRequest) {
    const startTime = Date.now();
    const retryCount = parseInt(request.headers.get('Upstash-Retried') || '0');
    const maxRetries = 3;

    try {
        const body = await request.json();
        const { jobId, batchIndex, manifest } = processBatchSchema.parse(body);

        const BATCH_SIZE = 20;
        const start = batchIndex * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, manifest.length);
        const keys = manifest.slice(start, end);

        if (keys.length === 0) {
            // No more keys, processing complete for batches
            // Trigger Finalize
            const baseUrl = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : "http://localhost:3000";

            await publishToQStash(`${baseUrl}/api/jobs/${jobId}/finalize`, {});

            console.log(
                JSON.stringify({
                    event: "BatchProcessingFinished",
                    jobId,
                    timestamp: new Date().toISOString(),
                })
            );
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
        } catch (geminiError) {
            console.error(`Gemini failed for batch ${batchIndex}`, geminiError);
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

        // Trigger Next Batch recursively
        const nextBatchIndex = batchIndex + 1;
        const totalBatches = Math.ceil(manifest.length / BATCH_SIZE);

        if (nextBatchIndex < totalBatches) {
            const baseUrl = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : "http://localhost:3000";

            await publishToQStash(`${baseUrl}/api/internal/process-batch`, {
                jobId,
                batchIndex: nextBatchIndex,
                manifest
            });
        } else {
            // This was the last batch. Trigger finalize.
            const baseUrl = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : "http://localhost:3000";

            await publishToQStash(`${baseUrl}/api/jobs/${jobId}/finalize`, {});
        }

        const duration = Date.now() - startTime;
        return NextResponse.json({
            success: true,
            processed: keys.length,
            duration,
        });

    } catch (error: any) {
        console.error("Batch processing error", error);

        // If this is the last retry, mark job as failed and notify user
        if (retryCount >= maxRetries) {
            try {
                const body = await request.clone().json();
                const { jobId } = body;
                const job: any = await redis.get(`job:${jobId}`);

                if (job && job.email) {
                    job.status = 'failed';
                    job.error = `Processing failed after ${maxRetries} retries: ${error.message}`;
                    await redis.set(`job:${jobId}`, job);

                    await queueErrorEmail({
                        jobId,
                        email: job.email,
                        errorMessage: "We couldn't process your notes after multiple attempts. Please try again with a clearer scan."
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

// Wrap with QStash signature verification for security
// Only apply if key is present to avoid build failures
let POST_HANDLER: any = handler;
if (process.env.QSTASH_CURRENT_SIGNING_KEY) {
    POST_HANDLER = verifySignatureAppRouter(handler);
} else {
    if (process.env.NODE_ENV === 'production') {
        console.warn("WARNING: QSTASH_CURRENT_SIGNING_KEY missing in internal route.");
    }
}

export const POST = POST_HANDLER;
