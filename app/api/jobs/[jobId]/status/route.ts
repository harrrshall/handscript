import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> } // In Next.js 15+ params should be awaited
) {
    const { jobId } = await params;

    try {
        const job: any = await redis.get(`job:${jobId}`);
        if (!job) {
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        // Get real-time progress
        const completedCount = await redis.get(`job:${jobId}:completed`) as number || 0;
        const failedList = await redis.lrange(`job:${jobId}:failed`, 0, -1) || [];

        // Update job object in memory for response (we don't persist this back to avoid race conditions yet)
        job.completedPages = typeof completedCount === 'string' ? parseInt(completedCount) : completedCount;
        job.failedPages = failedList.map(Number);

        // Determine overall status
        // If we have a finalized status in DB (like 'assembling' or 'complete'), use it.
        // Otherwise calculate based on progress.
        if (job.status === 'processing') {
            if (job.completedPages + job.failedPages.length === job.totalPages) {
                // All pages accounted for
                // We don't auto-transition here, client/orchestrator triggers assembly
                // But we can report it as 'ready_to_assemble' or just let client finish
            }
        }

        const logs = await redis.lrange(`job:${jobId}:logs`, 0, -1) || [];

        return NextResponse.json({
            status: job.status,
            progress: {
                total: job.totalPages,
                completed: job.completedPages,
                failed: job.failedPages.length,
            },
            logs: logs.reverse(), // Show oldest to newest
            finalPdfUrl: job.finalPdfUrl,
            error: job.error,
        }, {
            headers: {
                'Cache-Control': 's-maxage=1, stale-while-revalidate=2'
            }
        });
    } catch (error) {
        console.error('Status check failed:', error);
        return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
    }
}
