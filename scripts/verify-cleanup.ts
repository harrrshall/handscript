
// Using global fetch (available in Node 18+)
// This script verifies that the Explicit Cleanup strategy works:
// 1. Uploads a file
// 2. run job
// 3. confirms file is DELETED after job completion

import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback

// 1x1 Transparent PNG
const PNG_BUFFER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

const BASE_URL = 'http://localhost:3000';
const BUCKET_NAME = process.env.B2_BUCKET_NAME!;

const cleanToken = (token: string | undefined) => {
    if (!token) return undefined;
    return token.trim().replace(/['"]/g, '');
};

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT?.startsWith("http")
        ? process.env.B2_ENDPOINT
        : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION,
    credentials: {
        accessKeyId: cleanToken(process.env.B2_KEY_ID)!,
        secretAccessKey: cleanToken(process.env.B2_APPLICATION_KEY)!,
    },
});

async function fileExists(key: string): Promise<boolean> {
    try {
        await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
        return true;
    } catch (error: any) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw error;
    }
}

async function verify() {
    console.log('Starting CLEANUP verification...');

    // 1. Get Presigned URL
    const key = `uploads/cleanup-test-${Date.now()}.png`;
    console.log(`Step 1: Requesting upload URL for ${key}...`);

    const presignRes = await fetch(`${BASE_URL}/api/get-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, contentType: 'image/png' })
    });

    if (!presignRes.ok) throw new Error(`Failed to get upload URL: ${presignRes.status} ${await presignRes.text()}`);
    const { uploadUrl } = await presignRes.json();
    console.log('Got upload URL.');

    // 2. Upload to B2
    console.log('Step 2: Uploading image to B2...');
    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: PNG_BUFFER,
        headers: { 'Content-Type': 'image/png' }
    });

    if (!uploadRes.ok) throw new Error(`Failed to upload to B2: ${uploadRes.status}`);
    console.log('Upload successful.');

    // 3. Verify file exists in B2
    console.log('Step 3: Verifying file exists in B2...');
    if (!(await fileExists(key))) {
        throw new Error('File should exist in B2 after upload but does not.');
    }
    console.log('File exists in B2.');

    // 4. Create Job
    console.log('Step 4: Creating Job...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: 1,
            // IMPORTANT: We must send the KEY in the pageManifest for the cleanup to work!
            // The previous code sent 'pending-processing' placeholders, but the new logic expects valid keys?
            // Wait, looking at Upload.tsx (user said): "Updated to send the actual S3 Keys ... in pageManifest"
            // So we must put the key here.
            pageManifest: [key]
        })
    });

    if (!jobRes.ok) throw new Error(`Failed to create job: ${jobRes.status}`);
    const { jobId } = await jobRes.json();
    console.log(`Job Created: ${jobId}`);

    // 5. Process Batch
    console.log('Step 5: Processing Batch...');
    const processRes = await fetch(`${BASE_URL}/api/process-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jobId,
            startPageIndex: 0,
            keys: [key]
        })
    });

    if (!processRes.ok) {
        const text = await processRes.text();
        console.error('Process response:', text);
        throw new Error(`Failed to process batch: ${processRes.status} ${text}`);
    }
    const processData = await processRes.json();
    console.log('Process Batch Response:', processData);

    // 6. Poll Status
    console.log('Step 6: Polling Status...');
    let completed = false;
    for (let i = 0; i < 20; i++) {
        const statusRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/status`);
        const statusData = await statusRes.json();
        console.log(`Status: ${statusData.status}`, statusData.progress);

        if (statusData.progress.completed === 1) {
            console.log('Job Completed successfully!');
            completed = true;
            break;
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!completed) throw new Error('Verification timed out waiting for job completion');

    // 6.5 Call Finalize (Client usually does this)
    console.log('Step 6.5: Calling Finalize...');
    const finalizeRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/finalize`, {
        method: 'POST',
    });
    if (!finalizeRes.ok) {
        throw new Error(`Finalize failed: ${finalizeRes.status} ${await finalizeRes.text()}`);
    }
    console.log('Finalize successful:', await finalizeRes.json());

    // 7. Verify file is DELETED
    console.log('Step 7: Verifying file is DELETED from B2...');
    // Give a small grace period as the deletion is async in the background of the finalize route
    await new Promise(r => setTimeout(r, 2000));

    const stillExists = await fileExists(key);
    if (stillExists) {
        throw new Error('FAILURE: File still exists in B2 after job completion! Cleanup did not work.');
    } else {
        console.log('SUCCESS: File was deleted from B2!');
    }
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
