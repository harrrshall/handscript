import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { geminiModel, SYSTEM_PROMPT } from '@/lib/gemini';
import { z } from 'zod';

const processPageSchema = z.object({
    jobId: z.string(),
    pageIndex: z.number().min(0),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { jobId, pageIndex } = processPageSchema.parse(body);

        // Fetch job data
        const job: any = await redis.get(`job:${jobId}`);
        if (!job) {
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        if (pageIndex >= job.pageManifest.length) {
            return NextResponse.json({ error: 'Page index out of bounds' }, { status: 400 });
        }

        // Check if page already processed
        // We removed the lock as per system design to reduce Redis ops.
        // Parallel requests might process the same page twice but Gemini capacity is high.

        const pageKey = `job:${jobId}:page:${pageIndex}`;
        const existingResult = await redis.get(pageKey);
        if (existingResult) {
            return NextResponse.json({
                success: true,
                pageIndex,
                markdown: (existingResult as any).markdown,
                cached: true
            });
        }

        try {
            const imageUrl = job.pageManifest[pageIndex];

            // Fetch image
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
                throw new Error(`Failed to fetch image: ${imageResponse.statusText}`);
            }
            const arrayBuffer = await imageResponse.arrayBuffer();
            const base64Image = Buffer.from(arrayBuffer).toString('base64');

            // Call Gemini
            const result = await geminiModel.generateContent([
                SYSTEM_PROMPT,
                {
                    inlineData: {
                        data: base64Image,
                        mimeType: 'image/png',
                    },
                },
            ]);

            const response = await result.response;
            let markdown = response.text();

            // Basic cleanup
            markdown = markdown.replace(/^```markdown\s*/i, '').replace(/\s*```$/, '');

            // Store result
            const pageResult = {
                jobId,
                pageIndex,
                status: 'complete',
                markdown,
                processedAt: Date.now(),
            };

            await redis.set(pageKey, pageResult);

            // Increment completed pages count
            await redis.incr(`job:${jobId}:completed`);

            return NextResponse.json({
                success: true,
                pageIndex,
                markdown,
            });

        } catch (error) {
            console.error(`Processing page ${pageIndex} failed:`, error);
            await redis.rpush(`job:${jobId}:failed`, pageIndex);
            return NextResponse.json({ error: 'Processing failed', details: String(error) }, { status: 500 });
        }

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
