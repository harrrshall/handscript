import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { generateBatchNotes } from '@/lib/gemini';
import { renderToTypst } from '@/lib/formatting';
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
        try {
            batchResponse = await generateBatchNotes(images);
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

        // Process the structured response into Markdown pages
        // Initialize with error placeholders to ensure strict 1:1 mapping
        const processedPages: string[] = new Array(images.length).fill(
            "[UNCLEAR: Page processing failed or index out of bounds]"
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
                // Render to Typst code using the formatting layer
                processedPages[page.pageIndex] = renderToTypst(pageIR);
            } else {
                console.warn(`Gemini returned invalid pageIndex: ${page.pageIndex}`);
            }
        });

        // Validate count (implied by array length, but check for filled slots)
        const filledCount = processedPages.filter(p => !p.startsWith("[UNCLEAR")).length;
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
        processedPages.forEach((typst, index) => {
            const pageIndex = startPageIndex + index;
            msetObj[`job:${jobId}:page:${pageIndex}`] = JSON.stringify({
                typst,
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
