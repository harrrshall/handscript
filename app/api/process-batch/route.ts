import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { generateBatchNotes } from '@/lib/gemini';
import { renderToHtml } from '@/lib/formatting';
import { z } from 'zod';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BatchResponse, Page } from '@/lib/schema';

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT?.startsWith('http') ? process.env.B2_ENDPOINT : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION,
    credentials: {
        accessKeyId: process.env.B2_KEY_ID!,
        secretAccessKey: process.env.B2_APPLICATION_KEY!,
    },
});

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
            timestamp: new Date().toISOString()
        }));

        // Generate signed URLs for Gemini
        const signedUrls = await Promise.all(keys.map(async (key) => {
            const command = new GetObjectCommand({
                Bucket: process.env.B2_BUCKET_NAME,
                Key: key,
            });
            return getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }));

        // Call Gemini with signed URLs
        let batchResponse: BatchResponse;

        // CHECKPOINTING LOGIC
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
            } else {
                console.log(`[Checkpoint] No cache found, calling Gemini...`);
                batchResponse = await generateBatchNotes(signedUrls);

                if (!fs.existsSync(checkpointDir)) {
                    fs.mkdirSync(checkpointDir, { recursive: true });
                }
                fs.writeFileSync(checkpointFile, JSON.stringify(batchResponse, null, 2));
            }

        } catch (error) {
            console.error(JSON.stringify({
                event: 'GeminiGenerationFailed',
                jobId,
                startPageIndex,
                error: String(error),
                timestamp: new Date().toISOString()
            }));

            // Mark pages as failed
            const failedIndices = keys.map((_, i) => startPageIndex + i);
            await redis.lpush(`job:${jobId}:failed`, ...failedIndices);
            return NextResponse.json({ error: 'Gemini generation failed' }, { status: 500 });
        }

        // Process the structured response into HTML
        const processedPages: string[] = new Array(keys.length).fill(
            "<p>[UNCLEAR: Page processing failed or index out of bounds]</p>"
        );

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

    } catch (error) {
        console.error(JSON.stringify({
            event: 'BatchProcessingError',
            jobId: jobIdDebug,
            error: String(error),
            timestamp: new Date().toISOString()
        }));

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: (error as any).errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
