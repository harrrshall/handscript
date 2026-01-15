import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getDownloadUrl } from '@/lib/s3';

// OPTIMIZED: Always redirect, never proxy
export async function GET(request: NextRequest) {
    const key = request.nextUrl.searchParams.get("key");

    if (!key) {
        // Fallback for legacy 'url' param if passed (treat as key if valid)
        const urlParam = request.nextUrl.searchParams.get("url");
        if (urlParam && !urlParam.startsWith("http")) {
            const presignedUrl = await getDownloadUrl(urlParam, 3600, "handscript-notes.pdf");
            return NextResponse.redirect(presignedUrl, 302);
        }
        return NextResponse.json({ error: "Key required" }, { status: 400 });
    }

    // Generate fresh presigned URL and redirect
    // This ensures zero bandwidth usage on Vercel for downloads
    const presignedUrl = await getDownloadUrl(key, 3600, "handscript-notes.pdf");
    return NextResponse.redirect(presignedUrl, 302);
}
