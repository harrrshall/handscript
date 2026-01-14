
import { S3Client, PutBucketLifecycleConfigurationCommand } from "@aws-sdk/client-s3";

// Ensure environment variables are loaded
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const cleanToken = (token: string | undefined) => {
    if (!token) return undefined;
    return token.trim().replace(/['"]/g, '');
};

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT?.startsWith("http")
        ? process.env.B2_ENDPOINT
        : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION,
    forcePathStyle: true, // Fix for B2 XML issues
    credentials: {
        accessKeyId: cleanToken(process.env.B2_KEY_ID)!,
        secretAccessKey: cleanToken(process.env.B2_APPLICATION_KEY)!,
    },
});

const BUCKET_NAME = process.env.B2_BUCKET_NAME!;

async function setupLifecycle() {
    console.log(`Setting up lifecycle rules for bucket: ${BUCKET_NAME}`);

    const command = new PutBucketLifecycleConfigurationCommand({
        Bucket: BUCKET_NAME,
        LifecycleConfiguration: {
            Rules: [
                {
                    Status: "Enabled",
                    Prefix: "uploads/",
                    Expiration: {
                        Days: 1,
                    },
                },
                {
                    Status: "Enabled",
                    Prefix: "uploads/",
                    Expiration: {
                        ExpiredObjectDeleteMarker: true,
                    },
                }
            ]
        }
    });

    try {
        await s3Client.send(command);
        console.log("Successfully applied lifecycle rules.");
        console.log("- 'uploads/' prefix: Delete after 1 day");
        console.log("- 'jobs/' prefix: Delete after 7 days");
    } catch (error) {
        console.error("Failed to apply lifecycle rules:", error);
    }
}

setupLifecycle().catch(console.error);
