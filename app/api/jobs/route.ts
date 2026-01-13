import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const createJobSchema = z.object({
    pageCount: z.number().min(1).max(200),
    pageManifest: z.array(z.string()).min(1),
});

export type JobStatus = 'pending' | 'processing' | 'assembling' | 'complete' | 'failed';

export interface Job {
    id: string;
    status: JobStatus;
    createdAt: number;
    updatedAt: number;
    totalPages: number;
    completedPages: number;
    failedPages: number[];
    pageManifest: string[];
    blobPrefix: string;
    finalPdfUrl?: string;
    error?: string;
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { pageCount, pageManifest } = createJobSchema.parse(body);

        if (pageManifest.length !== pageCount) {
            return NextResponse.json(
                { error: 'Page count does not match manifest length' },
                { status: 400 }
            );
        }

        const jobId = nanoid();
        const timestamp = Date.now();

        const job: Job = {
            id: jobId,
            status: 'content_processing' as any, // Using 'content_processing' to match state, or just 'processing'
            // Plan said 'pending' then 'processing'. Let's stick to plan.
            // But typically creation is instant.
            createdAt: timestamp,
            updatedAt: timestamp,
            totalPages: pageCount,
            completedPages: 0,
            failedPages: [],
            pageManifest,
            blobPrefix: `jobs/${jobId}`,
        };

        // Override status to 'processing' immediately as client will start polling/processing
        job.status = 'processing';

        await redis.set(`job:${jobId}`, job);
        // Set 30 day expiry
        await redis.expire(`job:${jobId}`, 30 * 24 * 60 * 60);

        return NextResponse.json({
            jobId,
            status: 'processing',
            estimatedTime: pageCount * 2, // Rough estimate
        });
    } catch (error) {
        console.error('Job creation failed:', error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: (error as z.ZodError).errors }, { status: 400 });
        }
        return NextResponse.json(
            { error: 'Failed to create job' },
            { status: 500 }
        );
    }
}
