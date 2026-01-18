import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { generateBatchNotes } from '@/lib/gemini';
import { renderToHtml } from '@/lib/formatting';
import { z } from 'zod';
import { BatchResponse, Page } from '@/lib/schema';
import { getDownloadUrl } from '@/lib/s3';

const processBatchSchema = z.object({
    jobId: z.string(),
    startPageIndex: z.number().min(0),
    keys: z.array(z.string()).min(1), // Changed from images to keys
});

export async function POST(request: Request) {
    const startTime = Date.now();
    let jobIdDebug = 'unknown';

    try {
        const body = await request.json();
        const { jobId, startPageIndex, keys } = processBatchSchema.parse(body);
        jobIdDebug = jobId;

        console.log(JSON.stringify({
            event: 'BatchProcessingStart',
            jobId,
            startPageIndex,
            batchSize: keys.length,
            timestamp: new Date().toISOString(),
            envCheck: {
                B2_ENDPOINT: process.env.B2_ENDPOINT ? 'set' : 'missing',
                B2_BUCKET_NAME: process.env.B2_BUCKET_NAME ? 'set' : 'missing',
                GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'set' : 'missing',
            }
        }));

        // Generate signed URLs for Gemini using the shared s3 module
        // Increased expiry to 2 hours (7200s) to ensure valid during Gemini processing queue time
        const signedUrls = await Promise.all(
            keys.map(async (key) => getDownloadUrl(key, 7200))
        );

        // Call Gemini with signed URLs

        // CHECKPOINTING LOGIC (Local Development Only)
        // Vercel filesystem is read-only, so we must skip this in production.
        const isDev = process.env.NODE_ENV === 'development';

        let batchResponse: BatchResponse | null = null;

        if (isDev) {
            const fs = await import('fs');
            const path = await import('path');
            const crypto = await import('crypto');

            // Hash based on keys (reliable identifier)
            const inputHash = crypto.createHash('md5').update(JSON.stringify(keys)).digest('hex');
            const checkpointDir = path.join(process.cwd(), 'debug', 'checkpoints');
            const checkpointFile = path.join(checkpointDir, `${jobId}_${startPageIndex}_${inputHash}.json`);

            try {
                if (fs.existsSync(checkpointFile)) {
                    console.log(`[Checkpoint] Loading Gemini response from ${checkpointFile}`);
                    const cachedData = fs.readFileSync(checkpointFile, 'utf-8');
                    batchResponse = JSON.parse(cachedData) as BatchResponse;
                }
            } catch (e) {
                console.warn("[Checkpoint] Read failed", e);
            }

            if (!batchResponse) {
                console.log(`[Checkpoint] No cache found or not in dev, calling Gemini...`);
                batchResponse = await generateBatchNotes(signedUrls);

                try {
                    if (!fs.existsSync(checkpointDir)) {
                        fs.mkdirSync(checkpointDir, { recursive: true });
                    }
                    fs.writeFileSync(checkpointFile, JSON.stringify(batchResponse, null, 2));
                } catch (e) {
                    console.warn("[Checkpoint] Write failed", e);
                }
            }
        } else {
            // Production: Direct Call
            batchResponse = await generateBatchNotes(signedUrls);
        }

        // Process the structured response into HTML
        const processedPages: string[] = new Array(keys.length).fill(
            "<p>[UNCLEAR: Page processing failed or index out of bounds]</p>"
        );

        if (!batchResponse) throw new Error("Failed to generate batch response");

        batchResponse.pages.forEach((page: Page) => {
            if (page.pageIndex >= 0 && page.pageIndex < keys.length) {
                const pageIR = {
                    metadata: batchResponse.metadata,
                    content: page.content
                };
                processedPages[page.pageIndex] = renderToHtml(pageIR);
            }
        });

        // Store results in Redis
        const msetObj: Record<string, string> = {};
        processedPages.forEach((html, index) => {
            const pageIndex = startPageIndex + index;
            msetObj[`job:${jobId}:page:${pageIndex}`] = JSON.stringify({
                html,
                status: 'complete'
            });
        });

        await redis.mset(msetObj);
        await redis.incrby(`job:${jobId}:completed`, keys.length);

        const duration = Date.now() - startTime;
        console.log(JSON.stringify({
            event: 'BatchProcessingComplete',
            jobId,
            startPageIndex,
            processedCount: keys.length,
            durationMs: duration,
            timestamp: new Date().toISOString()
        }));

        return NextResponse.json({
            success: true,
            processedCount: keys.length
        });


    } catch (error: any) {
        console.error(JSON.stringify({
            event: 'BatchProcessingError',
            jobId: jobIdDebug,
            error: error.message || String(error),
            stack: error.stack,
            type: error.constructor.name,
            env: {
                hasB2Endpoint: !!process.env.B2_ENDPOINT,
                hasB2Bucket: !!process.env.B2_BUCKET_NAME,
                hasGeminiKey: !!process.env.GEMINI_API_KEY,
                nodeEnv: process.env.NODE_ENV,
            },
            timestamp: new Date().toISOString()
        }));

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: (error as any).errors }, { status: 400 });
        }

        // Return more specific error details to the client for debugging (remove in strict production if needed, but helpful now)
        return NextResponse.json({
            error: 'Internal server error',
            details: error.message,
            debugId: jobIdDebug
        }, { status: 500 });
    }
}

