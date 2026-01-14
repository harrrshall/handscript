import { NextResponse } from 'next/server';
import { uploadFile } from '@/lib/blob';

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const filename = file.name;
        const url = await uploadFile(file, filename);

        return NextResponse.json({ url });
    } catch (error) {
        console.error('Upload failed:', error);
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
