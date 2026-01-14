import { NextResponse } from 'next/server';
import { listFiles, deleteFile } from '@/lib/s3';

export async function GET(request: Request) {
    if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { blobs } = await listFiles({ limit: 1000 }); // Batch size appropriate for frequent runs
        const now = Date.now();
        const RETENTION_MS = 60 * 60 * 1000; // 1 Hour

        const toDelete: string[] = [];

        for (const blob of blobs) {
            // Check folders
            const isInput = blob.pathname.startsWith('inputs/');
            const isOutput = blob.pathname.startsWith('outputs/');

            if (isInput || isOutput) {
                const age = now - new Date(blob.uploadedAt).getTime();
                if (age > RETENTION_MS) {
                    toDelete.push(blob.pathname);
                }
            }
        }

        if (toDelete.length > 0) {
            await deleteFile(toDelete);
        }

        return NextResponse.json({
            success: true,
            deletedCount: toDelete.length,
            deletedfiles: toDelete
        });

    } catch (error) {
        console.error('Cron cleanup failed:', error);
        return NextResponse.json({ error: 'Cleanup failed', details: String(error) }, { status: 500 });
    }
}
