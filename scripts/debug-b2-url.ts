
import { config } from 'dotenv';
config();
import { S3Client, ListObjectsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../lib/env";

async function main() {
    console.log("Checking B2 Configuration...");
    console.log("Endpoint:", env.B2_ENDPOINT);
    console.log("Region:", env.B2_REGION);
    console.log("Bucket:", env.B2_BUCKET_NAME);
    console.log("KeyID Length:", env.B2_KEY_ID?.length);
    console.log("KeySecret Length:", env.B2_APPLICATION_KEY?.length);

    const s3Client = new S3Client({
        endpoint: env.B2_ENDPOINT.startsWith("http")
            ? env.B2_ENDPOINT
            : `https://${env.B2_ENDPOINT}`,
        region: env.B2_REGION,
        credentials: {
            accessKeyId: env.B2_KEY_ID,
            secretAccessKey: env.B2_APPLICATION_KEY,
        },
    });

    try {
        console.log("\n1. Listing objects...");
        const listCmd = new ListObjectsCommand({
            Bucket: env.B2_BUCKET_NAME,
            MaxKeys: 1
        });
        const listRes = await s3Client.send(listCmd);
        console.log("List success. Contents:", listRes.Contents?.map(c => c.Key));

        if (!listRes.Contents || listRes.Contents.length === 0) {
            console.log("Bucket is empty, cannot test GetObject.");
            return;
        }

        const testKey = listRes.Contents[0].Key!;
        console.log(`\n2. Generating Signed URL for key: ${testKey}`);

        const getCmd = new GetObjectCommand({
            Bucket: env.B2_BUCKET_NAME,
            Key: testKey,
        });

        const signedUrl = await getSignedUrl(s3Client, getCmd, { expiresIn: 3600 });
        console.log("Signed URL:", signedUrl);

        console.log("\n3. Fetching from Signed URL...");
        const res = await fetch(signedUrl);
        console.log("Status:", res.status, res.statusText);
        const text = await res.text();
        console.log("Body length:", text.length);
        if (res.status !== 200) {
            console.log("Body preview:", text.substring(0, 500));
            console.log("Headers:", Object.fromEntries(res.headers.entries()));
        } else {
            console.log("Fetch success!");
        }

    } catch (err: any) {
        console.error("Error:", err);
    }
}

main();
