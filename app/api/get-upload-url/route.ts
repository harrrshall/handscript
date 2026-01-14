import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextRequest, NextResponse } from 'next/server';

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT?.startsWith('http') ? process.env.B2_ENDPOINT : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION,
    credentials: {
        accessKeyId: process.env.B2_KEY_ID!,
        secretAccessKey: process.env.B2_APPLICATION_KEY!,
    },
});

export async function POST(req: NextRequest) {
    try {
        const { key, contentType } = await req.json();

        // Validate key
        if (!key || typeof key !== 'string') {
            return NextResponse.json({ error: 'Invalid key' }, { status: 400 });
        }

        // Generate presigned URL for client upload
        const command = new PutObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: key,
            ContentType: contentType,
            // ACL: 'private', // B2 might not support ACLs the same way or it might be default? Feasibility guide had it.
            // Leaving ACL out if B2 defaults to private based on bucket settings, but feasibility guide included it.
            // However feasibility guide says "Files in Bucket: Private", so ACL might not be needed if bucket is private?
            // Re-reading feasibility guide:
            // "ACL: 'private'" is in "Security Considerations".
            // Let's try without ACL first to avoid permissions issues if the key doesn't have PutACL capability.
            // But I'll add ServerSideEncryption if B2 supports it?
            // Feasibility guide used it. I'll stick to basic first.
        });

        const uploadUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 3600, // 1 hour
        });

        return NextResponse.json({ uploadUrl });
    } catch (error) {
        console.error('Presigned URL generation failed:', error);
        return NextResponse.json(
            { error: 'Failed to generate upload URL' },
            { status: 500 }
        );
    }
}
