import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { uploadFile } from '@/lib/blob';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const { jobId } = await params;

    try {
        const job: any = await redis.get(`job:${jobId}`);
        if (!job) {
            return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        // Update status
        job.status = 'assembling';
        await redis.set(`job:${jobId}`, job);

        // Fetch all pages
        const keys = Array.from({ length: job.totalPages }, (_, i) => `job:${jobId}:page:${i}`);
        const results = await redis.mget(keys);

        let assembledMarkdown = '';
        const validResults: string[] = [];

        // Sort and concat logic
        // results is array of (PageResult | null)
        // We rely on index order of keys, mget returns in order? Yes.

        for (let i = 0; i < results.length; i++) {
            const res = results[i] as any;
            if (res && res.markdown) {
                assembledMarkdown += `\n\n<!-- Page ${i + 1} -->\n\n`;
                assembledMarkdown += res.markdown;
            } else {
                console.warn(`Missing result for page ${i}`);
                assembledMarkdown += `\n\n<!-- Page ${i + 1} MISSING -->\n\n[MISSING PAGE CONTENT]`;
            }
        }

        // Store assembled markdown
        const bucketUrl = await uploadFile(assembledMarkdown, `${jobId}-assembled.md`);

        // Also store in Redis merely for quick access if needed, or just link
        // Storing large text in Redis might simply be inefficient, but for assembly step we have it in memory.

        // Ready for render
        // Actually, we can trigger render here or let client call render.
        // Design says: Client calls /assemble, then /render.
        // assemble returns markdown Url.

        return NextResponse.json({
            success: true,
            markdownUrl: bucketUrl,
            markdownContent: assembledMarkdown // Sending back content optionally if client wants to preview
        });
    } catch (error) {
        console.error('Assembly failed:', error);
        return NextResponse.json({ error: 'Assembly failed' }, { status: 500 });
    }
}
