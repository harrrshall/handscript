import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/redis";
import { generateNotesForSingleImage } from "@/lib/gemini";
import { renderToHtml } from "@/lib/formatting";
import { z } from "zod";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SinglePageResponse } from "@/lib/schema";
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

const processImageSchema = z.object({
    jobId: z.string(),
    imageKey: z.string(),
    index: z.number().min(0),
});

/**
 * Atomic single-image processor.
 * Processes exactly 1 image per call for maximum parallelism and reliability.
 * 
 * Flow:
 * 1. Generate signed URL for the image
 * 2. Call Gemini for single image transcription
 * 3. Convert to HTML and store in Redis hash
 * 4. Atomically increment completed count
 * 5. If this was the last image, trigger finalization
 */
async function handler(request: NextRequest) {
    const startTime = Date.now();
    const retryCount = parseInt(request.headers.get('Upstash-Retried') || '0');
    const maxRetries = 3;

    let body: any = null;
    try {
        body = await request.json();
        const { jobId, imageKey, index } = processImageSchema.parse(body);

        logger.info("ProcessImageStart", {
            jobId,
            metadata: { index, retryCount }
        });

        await logger.logToRedis(jobId, `Processing page ${index + 1}...`);

        // 1. Generate signed URL for this image
        const command = new GetObjectCommand({
            Bucket: env.B2_BUCKET_NAME,
            Key: imageKey,
        });
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 7200 });

        // 2. Call Gemini for single image
        let pageResponse: SinglePageResponse | null = null;
        try {
            pageResponse = await generateNotesForSingleImage(signedUrl);
            await logger.logToRedis(jobId, `Gemini success for page ${index + 1}`);
        } catch (geminiError: any) {
            await logger.logToRedis(jobId, `Gemini error for page ${index + 1}: ${geminiError.message}`);
            logger.error('GeminiSingleFailed', {
                jobId,
                metadata: { index },
                error: geminiError.message,
                stack: geminiError.stack,
            });
            throw geminiError; // Let QStash retry
        }

        // 3. Convert to HTML and store in Redis hash
        let pageHtml = "<p>[UNCLEAR: Page processing failed]</p>";
        if (pageResponse) {
            const pageIR = {
                metadata: pageResponse.metadata,
                content: pageResponse.content,
            };
            pageHtml = renderToHtml(pageIR);
        }

        // Store result in Redis hash (keyed by index for proper ordering)
        await redis.hset(`job:${jobId}:results`, {
            [index]: JSON.stringify({ html: pageHtml, status: "complete" })
        });

        // 4. Atomically increment completed count (using get/set since job is stored as JSON, not a hash)
        const jobData: any = await redis.get(`job:${jobId}`);
        if (!jobData) {
            throw new Error(`Job ${jobId} not found in Redis`);
        }
        jobData.completedPages = (jobData.completedPages || 0) + 1;
        jobData.updatedAt = Date.now();
        await redis.set(`job:${jobId}`, jobData);

        const completedCount = jobData.completedPages;
        const totalImages = jobData.totalPages || 0;

        await logger.logToRedis(jobId, `Page ${index + 1} complete. Progress: ${completedCount}/${totalImages}`);

        // 5. Check if this was the last image
        if (completedCount >= totalImages) {
            await logger.logToRedis(jobId, "All pages processed. Triggering finalization...");
            const baseUrl = getBaseUrl();
            await publishToQStash(`${baseUrl}/api/jobs/${jobId}/finalize`, {});
        }

        const duration = Date.now() - startTime;
        await metrics.increment("images_processed");
        await metrics.recordLatency("image_processing", duration);

        logger.info("ProcessImageComplete", {
            jobId,
            metadata: { index, duration, completedCount, totalImages }
        });

        return NextResponse.json({
            success: true,
            index,
            duration,
        });

    } catch (error: any) {
        logger.error('ProcessImageFailed', {
            jobId: body?.jobId || 'unknown',
            metadata: { index: body?.index, retryCount },
            error: error.message,
            stack: error.stack,
        });

        if (body?.jobId) {
            await logger.logToRedis(body.jobId, `Page ${body.index + 1} failed: ${error.message}`);
        }

        // Handle max retries exceeded
        if (retryCount >= maxRetries && body?.jobId) {
            try {
                const jobId = body.jobId;
                const job: any = await redis.get(`job:${jobId}`);

                if (job) {
                    // Mark this specific page as failed
                    const failedPages = job.failedPages || [];
                    if (!failedPages.includes(body.index)) {
                        failedPages.push(body.index);
                    }
                    job.failedPages = failedPages;

                    // Still increment completed count so we can finalize with partial results
                    job.completedPages = (job.completedPages || 0) + 1;
                    job.updatedAt = Date.now();
                    await redis.set(`job:${jobId}`, job);

                    const completedCount = job.completedPages;
                    const totalImages = job.totalPages || 0;

                    // Store a placeholder for this failed page
                    await redis.hset(`job:${jobId}:results`, {
                        [body.index]: JSON.stringify({
                            html: `<p>[Page ${body.index + 1} failed to process after ${maxRetries} attempts]</p>`,
                            status: "failed"
                        })
                    });

                    // Check if this was the last image (even though it failed)
                    if (completedCount >= totalImages) {
                        await logger.logToRedis(jobId, "All pages processed (some failed). Triggering finalization...");
                        const baseUrl = getBaseUrl();
                        await publishToQStash(`${baseUrl}/api/jobs/${jobId}/finalize`, {});
                    }

                    // Send error email if configured
                    if (job.email && failedPages.length === 1) {
                        // Only send one error email per job (on first failure)
                        await queueErrorEmail({
                            jobId,
                            email: job.email,
                            errorMessage: `Some pages couldn't be processed. We'll still generate the PDF with available content.`
                        });
                    }
                }
            } catch (notifyError) {
                console.error("Failed to handle max retries:", notifyError);
            }
        }

        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}

// Apply QStash signature verification in production
let POST_HANDLER: any = handler;
if (process.env.NODE_ENV === 'production' && process.env.QSTASH_CURRENT_SIGNING_KEY) {
    POST_HANDLER = verifySignatureAppRouter(handler);
}

export const POST = POST_HANDLER;
