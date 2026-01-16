import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { nanoid } from 'nanoid';
import { z } from 'zod';

const createJobSchema = z.object({
    pageCount: z.number().min(1).max(200),
    pageManifest: z.array(z.string()).min(1),
    email: z.string().email().optional(),
});

import { batchPublishToQStash } from "@/lib/queue";
import { logger, metrics } from '@/lib/logger';
import { getBaseUrl } from '@/lib/utils';

// Opportunistic recovery for stale jobs (replaces cron)
async function opportunisticRecovery() {
    try {
        // Only run 10% of the time to avoid overhead
        if (Math.random() > 0.1) return;

        const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
        const now = Date.now();

        // Scan for a small batch of potentially stale jobs
        const [_, keys] = await redis.scan('0', { match: 'job:*', count: 20 });

        for (const key of keys) {
            // Skip non-job data keys
            if (key.includes(':logs') || key.includes(':page:') || key.includes(':completed') || key.includes(':results')) continue;

            const job: any = await redis.get(key);
            if (!job || typeof job !== 'object') continue;

            const isStale = (job.status === 'processing' || job.status === 'assembling') &&
                (now - job.updatedAt > STALE_THRESHOLD_MS);

            if (isStale) {
                job.status = 'failed';
                job.error = 'Job timed out after 2 hours of inactivity.';
                job.updatedAt = now;
                await redis.set(key, job);
                logger.info('OpportunisticRecovery', { jobId: job.id, metadata: { lastStatus: job.status } });
            }
        }
    } catch (e: any) {
        // Silent fail - this is opportunistic
        logger.error('OpportunisticRecoveryFailed', { error: e.message });
    }
}

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
    // Opportunistic cleanup (non-blocking)
    opportunisticRecovery().catch(() => { });

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
            status: 'processing',
            createdAt: timestamp,
            updatedAt: timestamp,
            totalPages: pageCount,
            completedPages: 0,
            failedPages: [],
            pageManifest,
            blobPrefix: `jobs/${jobId}`,
            email,
        };

        await redis.set(`job:${jobId}`, job);
        // Set 30 day expiry
        await redis.expire(`job:${jobId}`, 30 * 24 * 60 * 60);

        // Collect email for leads/marketing (Set ensures uniqueness)
        if (email) {
            try {
                await redis.sadd('collected_emails', email);
            } catch (err) {
                // Non-blocking error
                console.warn('Failed to collect email', err);
            }
        }

        // ATOMIC FAN-OUT: Trigger N parallel function calls (1 per image)
        const baseUrl = getBaseUrl();

        try {
            // Build batch of messages for QStash - 1 message per page
            const messages = pageManifest.map((imageKey, index) => ({
                destination: `${baseUrl}/api/internal/process-image`,
                body: { jobId, imageKey, index }
            }));

            const result = await batchPublishToQStash(messages);

            logger.info('JobFanOutStart', {
                jobId,
                metadata: {
                    messageCount: messages.length,
                    targetUrl: `${baseUrl}/api/internal/process-image`,
                    resultCount: result.results?.length || 0
                }
            });
            await metrics.increment("jobs_created");
        } catch (queueError: any) {
            logger.error("JobFanOutTriggerFailed", { jobId, error: queueError.message });
            // Mark job as failed if we couldn't queue any messages
            job.status = 'failed';
            job.error = `Failed to queue processing: ${queueError.message}`;
            await redis.set(`job:${jobId}`, job);

            return NextResponse.json({
                jobId,
                status: 'failed',
                error: 'Failed to start processing'
            }, { status: 500 });
        }

        return NextResponse.json({
            jobId,
            status: 'processing',
            estimatedTime: Math.max(10, pageCount * 1), // Faster with parallel processing
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

