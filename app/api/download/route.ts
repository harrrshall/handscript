import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');
    
    if (!url) {
        return NextResponse.json({ error: 'URL parameter required' }, { status: 400 });
    }

    try {
        // Handle local files
        if (url.includes('localhost') || url.startsWith('/uploads/')) {
            const filename = url.includes('localhost') 
                ? url.replace(/^https?:\/\/localhost:\d+\/uploads\//, '')
                : url.replace('/uploads/', '');
            
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

        // Handle remote URLs (Vercel Blob, etc.)
        const response = await fetch(url);
        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 });
        }

        const blob = await response.blob();
        
        return new NextResponse(blob, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="handscript-notes.pdf"`,
            },
        });
    } catch (error) {
        console.error('Download error:', error);
        return NextResponse.json({ error: 'Download failed' }, { status: 500 });
    }
}
