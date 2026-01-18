import { NextRequest, NextResponse } from 'next/server';
import { uploadFile, getDownloadUrl } from '@/lib/s3';

// POST: Traditional form-based upload
export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const filename = file.name;
        const buffer = Buffer.from(await file.arrayBuffer());

        // Enforce inputs/ directory for organization and easier cleanup
        const key = await uploadFile(`inputs/${filename}`, buffer, file.type || 'application/pdf');

        // Generate a pre-signed URL for immediate access
        const url = await getDownloadUrl(key);

        return NextResponse.json({ url });
    } catch (error) {
        console.error('Upload failed:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}

// PUT: Direct binary upload for local dev mode (mimics S3 presigned URL upload)
export async function PUT(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const key = url.searchParams.get('key');
        const contentType = url.searchParams.get('contentType') || 'application/octet-stream';

        if (!key) {
            return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
        }

        // Read raw body as binary
        const buffer = Buffer.from(await request.arrayBuffer());

        if (buffer.length === 0) {
            return NextResponse.json({ error: 'Empty file body' }, { status: 400 });
        }

        // Upload the file using the shared s3 module (will use local filesystem in dev mode)
        await uploadFile(key, buffer, contentType);

        console.log(`[Local Upload] Saved file: ${key} (${buffer.length} bytes)`);

        // Return success (S3 presigned URL returns 200 on success)
        return new NextResponse(null, { status: 200 });
    } catch (error) {
        console.error('PUT upload failed:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
