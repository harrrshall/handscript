import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { generateBatchNotes } from '@/lib/gemini';
import { z } from 'zod';

const processBatchSchema = z.object({
    jobId: z.string(),
    startPageIndex: z.number().min(0),
    images: z.array(z.string()).min(1).max(10), // Limit reasonable batch size
});

export async function POST(request: Request) {
    const startTime = Date.now();
    let body;
    let jobIdDebug = 'unknown';

    try {
        body = await request.json();
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
        let generatedPages: string[];
        try {
            generatedPages = await generateBatchNotes(images);
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

        let processedPages = generatedPages;
        const mismatchThreshold = 2; // User defined threshold (or 3)

        // Verify count matches
        if (generatedPages.length !== images.length) {
            const diff = generatedPages.length - images.length;
            const absDiff = Math.abs(diff);

            console.warn(JSON.stringify({
                event: 'PageCountMismatch',
                jobId,
                startPageIndex,
                expected: images.length,
                generated: generatedPages.length,
                diff,
                timestamp: new Date().toISOString()
            }));

            if (absDiff > mismatchThreshold) {
                // Discard and mark as error
                console.error(JSON.stringify({
                    event: 'BatchDiscarded',
                    reason: 'DeviationExceedsThreshold',
                    jobId,
                    startPageIndex,
                    threshold: mismatchThreshold,
                    diff,
                    timestamp: new Date().toISOString()
                }));

                processedPages = images.map((_, i) =>
                    `\n\n# Error Processing Page ${startPageIndex + i + 1}\n\n[CONVERSION ERROR: Page count mismatch (Expected ${images.length}, Got ${generatedPages.length}). High deviation detected.]\n\n`
                );
            } else {
                // Handle small mismatches
                if (generatedPages.length < images.length) {
                    // Under-generation: Pad with error placeholders
                    const missing = images.length - generatedPages.length;
                    for (let i = 0; i < missing; i++) {
                        processedPages.push("[UNCLEAR: Page processing failed or merged with previous]");
                    }
                } else {
                    // Over-generation (e.g. 1 image -> 2 pages): Merge them?
                    // Strategy: If 1 image -> N pages, join them.
                    // If M images -> N pages, it's harder.
                    // Simple heuristic: Join all generated content and try to split? No, complex.
                    // Fallback: Just take the first N and append the rest to the last one? 
                    // Better: Join all and assign to first page if batch size is 1.
                    if (images.length === 1) {
                        const combined = generatedPages.join('\n\n---CONTINUED---\n\n');
                        processedPages = [combined];
                    } else {
                        // Batch > 1 and Over-generation. Rare but tricky.
                        // Just truncation for now to fit slots.
                        processedPages = generatedPages.slice(0, images.length);
                        // Append remainder to last page?
                        const remainder = generatedPages.slice(images.length).join('\n\n');
                        processedPages[processedPages.length - 1] += `\n\n[EXTRA CONTENT]:\n${remainder}`;
                    }
                }
            }
        }

        // Prepare MSET object
        const msetObj: Record<string, string> = {};
        processedPages.forEach((markdown, index) => {
            const pageIndex = startPageIndex + index;
            msetObj[`job:${jobId}:page:${pageIndex}`] = JSON.stringify({
                markdown,
                status: 'complete'
            });
        });

        // Store results and increment progress atomically
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
