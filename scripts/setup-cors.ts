
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback

const cleanToken = (token: string | undefined) => {
    if (!token) return undefined;
    return token.trim().replace(/['"]/g, '');
};

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT?.startsWith("http")
        ? process.env.B2_ENDPOINT
        : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION,
    forcePathStyle: true,
    credentials: {
        accessKeyId: cleanToken(process.env.B2_KEY_ID)!,
        secretAccessKey: cleanToken(process.env.B2_APPLICATION_KEY)!,
    },
});

const BUCKET_NAME = process.env.B2_BUCKET_NAME!;

async function setupCors() {
    console.log(`Setting up CORS rules for bucket: ${BUCKET_NAME}`);

    const command = new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: {
            CORSRules: [
                {
                    AllowedHeaders: ["*"],
                    AllowedMethods: ["GET", "PUT", "POST", "HEAD"], // Added POST just in case, PUT is critical
                    AllowedOrigins: ["*"], // Allow all origins (safe since presigned URLs provide auth)
                    ExposeHeaders: ["ETag"],
                    MaxAgeSeconds: 3600
                }
            ]
        }
    });

    try {
        await s3Client.send(command);
        console.log("Successfully applied CORS rules.");
        console.log("Allowed Origins:", [
            "https://handscriptnotes.vercel.app",
            "http://localhost:3000",
            "https://*.vercel.app"
        ]);
        console.log("Allowed Methods: GET, PUT, POST, HEAD");
    } catch (error) {
        console.error("Failed to apply CORS rules:", error);
        process.exit(1);
    }
}

setupCors();
