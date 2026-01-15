import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { logger, metrics } from '@/lib/logger';
import { env } from '@/lib/env';

export async function GET(request: Request) {
    if (request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
        logger.warn('UnauthorizedRecoveryTry');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // In a real app, we might use a separate index for "active" jobs.
        // For this implementation, we can scan recent keys if they are few, 
        // or just rely on the fact that stalled jobs will eventually hit this.
        // Since we don't have a list of all jobs, we can't easily iterate all jobs in Redis without SCAN.

        // Better: We'll rely on the user reporting bugs OR we can implement a "to_be_finalized" set.
        // However, for UX P4, the goal is "recovery logic".
        // Let's implement a SCAN based recovery for jobs starting with 'job:'

        let cursor = '0';
        let recoveredCount = 0;
        const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
        const now = Date.now();

        do {
            const [nextCursor, keys] = await redis.scan(cursor, { match: 'job:*', count: 100 });
            cursor = nextCursor;

            for (const key of keys) {
                // Skip logs or pages keys
                if (key.includes(':logs') || key.includes(':page:')) continue;

                const job: any = await redis.get(key);
                if (!job || typeof job !== 'object') continue;

                const isStale = (job.status === 'processing' || job.status === 'assembling') &&
                    (now - job.updatedAt > STALE_THRESHOLD_MS);

                if (isStale) {
                    job.status = 'failed';
                    job.error = 'Job timed out after 2 hours of inactivity.';
                    job.updatedAt = now;
                    await redis.set(key, job);

                    logger.info('JobRecovered', { jobId: job.id, metadata: { lastStatus: job.status } });
                    recoveredCount++;
                }
            }
        } while (cursor !== '0');

        await metrics.increment('jobs_recovered', recoveredCount);

        return NextResponse.json({
            success: true,
            recoveredCount
        });

    } catch (error: any) {
        logger.error('RecoveryCronFailed', { error: error.message, stack: error.stack });
        return NextResponse.json({ error: 'Recovery failed', details: error.message }, { status: 500 });
    }
}
