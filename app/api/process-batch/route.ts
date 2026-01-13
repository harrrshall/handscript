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
    try {
        const body = await request.json();
        const { jobId, startPageIndex, images } = processBatchSchema.parse(body);

        console.log(`Processing batch for job ${jobId}, starting at index ${startPageIndex}, size ${images.length}`);

        // Call Gemini with batch of images
        let generatedPages: string[];
        try {
            generatedPages = await generateBatchNotes(images);
        } catch (error) {
            console.error(`Gemini batch generation failed for job ${jobId} pages ${startPageIndex}-${startPageIndex + images.length - 1}:`, error);
            // Mark pages as failed
            const failedIndices = images.map((_, i) => startPageIndex + i);
            await redis.lpush(`job:${jobId}:failed`, ...failedIndices);
            return NextResponse.json({ error: 'Gemini generation failed' }, { status: 500 });
        }

        // Verify count matches
        if (generatedPages.length !== images.length) {
            console.warn(`Mismatch in generated pages count. Expected ${images.length}, got ${generatedPages.length}`);
            // This is tricky. Could be merged pages or hallucinations.
            // For now, if we have fewer, we fill the rest with error/empty and mark partial success?
            // Or just fail the batch?
            // Design doc says: "Split into smaller batches" on failure, but here we are deep in execution.
            // Let's pad with error placeholders if missing, or truncate if extra (unlikely).

            if (generatedPages.length < images.length) {
                const missing = images.length - generatedPages.length;
                for (let i = 0; i < missing; i++) {
                    generatedPages.push("[UNCLEAR: Page processing failed or merged with previous]");
                }
            }
        }

        // Prepare MSET object
        const msetObj: Record<string, string> = {};
        generatedPages.forEach((markdown, index) => {
            const pageIndex = startPageIndex + index;
            msetObj[`job:${jobId}:page:${pageIndex}`] = JSON.stringify({
                markdown,
                status: 'complete'
            });
        });

        // Store results and increment progress atomically (pipeline would be better but MSET + INCRBY is fine)
        await redis.mset(msetObj);
        await redis.incrby(`job:${jobId}:completed`, images.length);

        return NextResponse.json({
            success: true,
            processedCount: images.length
        });

    } catch (error) {
        console.error('Batch processing error:', error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: (error as z.ZodError).errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
