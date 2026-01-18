import { NextRequest, NextResponse } from 'next/server';
import { getUploadPresignedUrl } from '@/lib/s3';

export async function POST(req: NextRequest) {
    try {
        const { key, contentType } = await req.json();

        // Validate key
        if (!key || typeof key !== 'string') {
            return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
        }

        // Generate presigned URL for client upload
        const uploadUrl = await getUploadPresignedUrl(key, contentType || 'application/octet-stream', 3600);

        return NextResponse.json({ uploadUrl });
    } catch (error) {
        console.error('Presigned URL generation failed:', error);
        return NextResponse.json(
            { error: 'Failed to generate upload URL' },
            { status: 500 }
        );
    }
}
