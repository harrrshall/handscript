import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { generateBatchNotes } from '@/lib/gemini';
import { renderToHtml } from '@/lib/formatting';
import { z } from 'zod';

const processBatchSchema = z.object({
    jobId: z.string(),
    startPageIndex: z.number().min(0),
    images: z.array(z.string()).min(1).max(10), // Limit reasonable batch size
});

export async function POST(request: Request) {
    const startTime = Date.now();
    let jobIdDebug = 'unknown';

    try {
        const body = await request.json();
        const { jobId, startPageIndex, images } = processBatchSchema.parse(body);
        jobIdDebug = jobId;

        console.log(JSON.stringify({
            event: 'BatchProcessingStart',
            jobId,
            startPageIndex,
            batchSize: images.length,
            timestamp: new Date().toISOString()
        }));

        // Call Gemini with batch of images
        let batchResponse;

        // CHECKPOINTING LOGIC (For debugging/cost-saving)
        const fs = await import('fs');
        const path = await import('path');
        const crypto = await import('crypto');

        // Generate a simple hash of the input images to serve as a cache key
        const inputHash = crypto.createHash('md5').update(JSON.stringify(images)).digest('hex');
        const checkpointDir = path.join(process.cwd(), 'debug', 'checkpoints');
        const checkpointFile = path.join(checkpointDir, `${jobId}_${startPageIndex}_${inputHash}.json`);

        try {
            // Check if checkpoint exists
            if (fs.existsSync(checkpointFile)) {
                console.log(`[Checkpoint] Loading Gemini response from ${checkpointFile}`);
                const cachedData = fs.readFileSync(checkpointFile, 'utf-8');
                batchResponse = JSON.parse(cachedData);
            } else {
                console.log(`[Checkpoint] No cache found, calling Gemini...`);
                batchResponse = await generateBatchNotes(images);

                // Save checkpoint
                if (!fs.existsSync(checkpointDir)) {
                    fs.mkdirSync(checkpointDir, { recursive: true });
                }
                fs.writeFileSync(checkpointFile, JSON.stringify(batchResponse, null, 2));
                console.log(`[Checkpoint] Saved response to ${checkpointFile}`);
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
            const failedIndices = images.map((_, i) => startPageIndex + i);
            await redis.lpush(`job:${jobId}:failed`, ...failedIndices);
            return NextResponse.json({ error: 'Gemini generation failed' }, { status: 500 });
        }

        // Process the structured response into HTML pages
        // Initialize with error placeholders to ensure strict 1:1 mapping
        const processedPages: string[] = new Array(images.length).fill(
            "<p>[UNCLEAR: Page processing failed or index out of bounds]</p>"
        );

        // Map responses to their verified slots
        // We rely on the model correctly using 'pageIndex' 0..N-1
        batchResponse.pages.forEach((page) => {
            if (page.pageIndex >= 0 && page.pageIndex < images.length) {
                // Construct IR for this page
                const pageIR = {
                    metadata: batchResponse.metadata,
                    content: page.content
                };
                // Render to HTML using the formatting layer
                processedPages[page.pageIndex] = renderToHtml(pageIR);
            } else {
                console.warn(`Gemini returned invalid pageIndex: ${page.pageIndex}`);
            }
        });

        // Validate count (implied by array length, but check for filled slots)
        const filledCount = processedPages.filter(p => !p.includes("[UNCLEAR")).length;
        if (filledCount !== images.length) {
            console.warn(JSON.stringify({
                event: 'PageCountMismatch',
                jobId,
                startPageIndex,
                expected: images.length,
                received: filledCount,
                timestamp: new Date().toISOString()
            }));
        }

        // Prepare MSET object for Redis
        const msetObj: Record<string, string> = {};
        processedPages.forEach((html, index) => {
            const pageIndex = startPageIndex + index;
            msetObj[`job:${jobId}:page:${pageIndex}`] = JSON.stringify({
                html,
                status: 'complete'
            });
        });

        // Store results and increment progress
        await redis.mset(msetObj);
        await redis.incrby(`job:${jobId}:completed`, images.length);

        const duration = Date.now() - startTime;
        console.log(JSON.stringify({
            event: 'BatchProcessingComplete',
            jobId,
            startPageIndex,
            processedCount: images.length,
            durationMs: duration,
            timestamp: new Date().toISOString()
        }));

        return NextResponse.json({
            success: true,
            processedCount: images.length
        });

    } catch (error) {
        console.error(JSON.stringify({
            event: 'BatchProcessingError',
            jobId: jobIdDebug,
            error: String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        }));

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: (error as any).errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
