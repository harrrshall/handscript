
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

// Verify Config
if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
if (!process.env.B2_ENDPOINT) throw new Error("B2_ENDPOINT missing");

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT.startsWith('http') ? process.env.B2_ENDPOINT : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION,
    credentials: {
        accessKeyId: process.env.B2_KEY_ID!,
        secretAccessKey: process.env.B2_APPLICATION_KEY!,
    },
});

async function main() {
    const { generateBatchNotes } = await import('../lib/gemini');

    console.log("Listing 5 files in inputs/local/...");
    const listCmd = new ListObjectsV2Command({
        Bucket: process.env.B2_BUCKET_NAME,
        Prefix: "inputs/local/",
        MaxKeys: 5
    });

    const listRes = await s3Client.send(listCmd);
    const files = listRes.Contents || [];

    if (files.length === 0) {
        console.error("No files found.");
        return;
    }

    console.log(`Generating presigned URLs for ${files.length} files...`);
    const urls = await Promise.all(files.map(async (file) => {
        const command = new GetObjectCommand({
            Bucket: process.env.B2_BUCKET_NAME,
            Key: file.Key,
        });
        return getSignedUrl(s3Client, command, { expiresIn: 7200 });
    }));

    console.log(`Calling generateBatchNotes with ${files.length} UNIQUE URLs...`);
    try {
        const response = await generateBatchNotes(urls);
        console.log("SUCCESS! Response has pages:", response.pages.length);
    } catch (e: any) {
        console.error("FAILURE in generateBatchNotes:", e.message);
        if (e.stack) console.error(e.stack);
    }
}

main().catch(console.error);
