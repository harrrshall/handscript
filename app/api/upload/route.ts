import { NextResponse } from 'next/server';
import { uploadFile, getDownloadUrl } from '@/lib/s3';

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
        // uploadFile now returns the KEY, not the URL.
        const key = await uploadFile(`inputs/${filename}`, buffer, file.type || 'application/pdf');

        // Generate a pre-signed URL for immediate access (e.g. for preview)
        const url = await getDownloadUrl(key);

        return NextResponse.json({ url });
    } catch (error) {
        console.error('Upload failed:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
