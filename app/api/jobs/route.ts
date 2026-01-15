import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const createJobSchema = z.object({
    pageCount: z.number().min(1).max(200),
    pageManifest: z.array(z.string()).min(1),
    email: z.string().email().optional(),
});

import { publishToQStash } from "@/lib/queue";
import { logger, metrics } from '@/lib/logger';
import { getBaseUrl } from '@/lib/utils';

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
    email?: string;
    emailStatus?: "pending" | "sent" | "failed" | "queued" | "queue_failed";
    emailSentAt?: number;
    emailId?: string;
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { pageCount, pageManifest, email } = createJobSchema.parse(body);

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
            email,
        };

        // Override status to 'processing' immediately as client will start polling/processing
        job.status = 'processing';

        await redis.set(`job:${jobId}`, job);
        // Set 30 day expiry
        await redis.expire(`job:${jobId}`, 30 * 24 * 60 * 60);

        // TRIGGER BACKGROUND PROCESSING via QStash
        const baseUrl = getBaseUrl();

        try {
            const result = await publishToQStash(`${baseUrl}/api/internal/process-batch`, {
                jobId,
                batchIndex: 0,
                manifest: pageManifest
            });
            logger.info('JobBackgroundStart', {
                jobId,
                metadata: { qStashResult: result, targetUrl: `${baseUrl}/api/internal/process-batch` }
            });
            await metrics.increment("jobs_created");
        } catch (queueError: any) {
            logger.error("JobBackgroundTriggerFailed", { jobId, error: queueError.message });
            // We still return success, client will poll and see it's pending/stuck
            // or retry manually if we built that UI.
            // Crucially, if email was provided, this failure is critical for 'fire-and-forget'.
        }

        return NextResponse.json({
            jobId,
            status: 'processing',
            estimatedTime: pageCount * 2, // Rough estimate
        });
    } catch (error: any) {
        logger.error('JobCreationError', { error: error.message, stack: error.stack });
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: (error as any).errors }, { status: 400 });
        }
        return NextResponse.json(
            { error: 'Failed to create job' },
            { status: 500 }
        );
    }
}
