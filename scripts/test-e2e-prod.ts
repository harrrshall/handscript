
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://handscriptnotes.vercel.app';
const IMG_PATH = path.join(process.cwd(), 'scripts', 'temp_test_5', 'image-01.png');

async function main() {
    console.log('Starting PROD E2E test...');
    console.log('User Email: harshalsingh1223@gmail.com');

    if (!fs.existsSync(IMG_PATH)) {
        if (!fs.existsSync(path.dirname(IMG_PATH))) {
            fs.mkdirSync(path.dirname(IMG_PATH), { recursive: true });
        }
        // Create 1x1 png
        fs.writeFileSync(IMG_PATH, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==', 'base64'));
    }

    // 1. Get Presigned URL (tests server config)
    const key = `uploads/prod-e2e/${Date.now()}-test.png`;
    console.log('Getting upload URL for:', key);

    const uploadUrlRes = await fetch(`${BASE_URL}/api/get-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, contentType: 'image/png' })
    });

    if (!uploadUrlRes.ok) throw new Error(`Get upload URL failed: ${await uploadUrlRes.text()}`);
    const { uploadUrl } = await uploadUrlRes.json();

    // 2. Upload to B2 (Tests B2 connectivity, but not CORS browser enforcement)
    console.log('Uploading to B2...');
    const buffer = fs.readFileSync(IMG_PATH);
    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: buffer,
        headers: { 'Content-Type': 'image/png' }
    });

    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
    console.log('Upload successful.');

    // 3. Create Job (Tests database and QStash trigger implicitly)
    console.log('Creating job...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: 1,
            pageManifest: [key], // Using the key we just uploaded
            email: 'harshalsingh1223@gmail.com'
        })
    });

    if (!jobRes.ok) throw new Error(`Job creation failed: ${await jobRes.text()}`);
    const { jobId } = await jobRes.json();
    console.log(`Job created: ${jobId}`);
    console.log(`Tracking URL: ${BASE_URL}/status/${jobId}`);

    // 4. Poll for completion
    console.log('Polling for completion...');
    const maxRetries = 60; // 5 mins
    for (let i = 0; i < maxRetries; i++) {
        await new Promise(r => setTimeout(r, 5000));

        const statusRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/status`);
        if (!statusRes.ok) {
            console.log(`Status check failed: ${statusRes.status}`);
            continue;
        }

        const data = await statusRes.json();
        console.log(`[${i + 1}/${maxRetries}] Status: ${data.status}, Progress: ${data.progress?.completed}/${data.progress?.total}`);

        if (data.status === 'complete') {
            console.log('--------------------------------------------------');
            console.log('SUCCESS! Job completed.');
            console.log('Final PDF URL:', data.finalPdfUrl);
            console.log('Email should have been sent to: harshalsingh1223@gmail.com');
            console.log('--------------------------------------------------');
            return;
        }

        if (data.status === 'failed') {
            console.error('Job FAILED:', data);
            throw new Error('Remote job reported failure');
        }
    }

    throw new Error('Test timed out waiting for completion');
}

main().catch(e => {
    console.error('TEST FAILED:', e);
    process.exit(1);
});
