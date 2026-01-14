import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { uploadFile, getDownloadUrl } from '@/lib/s3';

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
        const markdownKey = await uploadFile(`${jobId}-assembled.md`, assembledMarkdown, 'text/markdown');

        // Generate presigned URL
        const markdownUrl = await getDownloadUrl(markdownKey);

        return NextResponse.json({
            success: true,
            markdownUrl,
            markdownContent: assembledMarkdown // Sending back content optionally if client wants to preview
        });
    } catch (error) {
        console.error('Assembly failed:', error);
        return NextResponse.json({ error: 'Assembly failed' }, { status: 500 });
    }
}
