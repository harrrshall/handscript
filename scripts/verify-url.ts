
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT?.startsWith('http')
        ? process.env.B2_ENDPOINT
        : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION!,
    credentials: {
        accessKeyId: process.env.B2_KEY_ID!,
        secretAccessKey: process.env.B2_APPLICATION_KEY!,
    },
});

async function main() {
    console.log("Listing 1 file...");
    const listCmd = new ListObjectsV2Command({
        Bucket: process.env.B2_BUCKET_NAME,
        Prefix: "inputs/local/",
        MaxKeys: 1
    });

    const listRes = await s3Client.send(listCmd);
    const files = listRes.Contents || [];

    if (files.length === 0) {
        console.error("No files found.");
        return;
    }

    const file = files[0];
    console.log(`Generating presigned URL for ${file.Key}...`);

    const command = new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME,
        Key: file.Key,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 7200 });

    console.log("URL:", url);

    console.log("Testing fetch...");
    try {
        const res = await fetch(url);
        console.log("Fetch Status:", res.status);
        console.log("Content-Type:", res.headers.get("content-type"));
        console.log("Content-Length:", res.headers.get("content-length"));
        if (!res.ok) {
            console.error("Fetch failed:", await res.text());
        }
    } catch (e) {
        console.error("Fetch error:", e);
    }

    console.log("Testing Gemini with single URL...");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

    try {
        const result = await model.generateContent([
            "Describe this image.",
            {
                fileData: {
                    fileUri: url,
                    mimeType: "image/png"
                }
            }
        ]);
        console.log("Gemini Response:", result.response.text());
    } catch (e: any) {
        console.error("Gemini Error:", e.message);
    }
}

main().catch(console.error);
