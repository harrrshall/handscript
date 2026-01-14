import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDownloadUrl } from '@/lib/s3';

export async function GET(request: NextRequest) {
    const urlParam = request.nextUrl.searchParams.get('url');
    const keyParam = request.nextUrl.searchParams.get('key');

    // Support both ?url=KEY and ?key=KEY
    const identifier = keyParam || urlParam;

    if (!identifier) {
        return NextResponse.json({ error: 'URL or Key parameter required' }, { status: 400 });
    }

    try {
        // 1. Handle B2 Keys (Private Bucket)
        // If it looks like a key (doesn't start with http/https/slash), treat as B2 Key
        if (!identifier.startsWith('http') && !identifier.startsWith('/')) {
            const presignedUrl = await getDownloadUrl(identifier);
            return NextResponse.redirect(presignedUrl);
        }

        // 2. Handle local files (Dev environment)
        if (identifier.includes('localhost') || identifier.startsWith('/uploads/')) {
            const filename = identifier.includes('localhost')
                ? identifier.replace(/^https?:\/\/localhost:\d+\/uploads\//, '')
                : identifier.replace('/uploads/', '');

            const filePath = path.join(process.cwd(), 'public/uploads', filename);

            if (!fs.existsSync(filePath)) {
                return NextResponse.json({ error: 'File not found' }, { status: 404 });
            }

            const fileBuffer = fs.readFileSync(filePath);

            return new NextResponse(fileBuffer, {
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="handscript-notes.pdf"`,
                    'Content-Length': fileBuffer.length.toString(),
                },
            });
        }

        // 3. Fallback: Handle full URLs (Proxying - strictly for legacy or external)
        // Note: For B2 Private URLs, we should redirect, not proxy, to save bandwidth.
        // But if we receive a full pre-signed URL here, we can just redirect to it too?
        // Actually, better to just redirect if it is a remote URL.
        if (identifier.startsWith('http')) {
            return NextResponse.redirect(identifier);
        }

        return NextResponse.json({ error: 'Invalid identifier' }, { status: 400 });

    } catch (error) {
        console.error('Download error:', error);
        return NextResponse.json({ error: 'Download failed' }, { status: 500 });
    }
}
