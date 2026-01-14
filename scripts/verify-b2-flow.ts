// Using global fetch (available in Node 18+)// If using ts-node, we might need types. 
// Actually, next.js environment has fetch. Run with ts-node might not.
// I'll try using global fetch.

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

async function verify() {
    console.log('Starting verification...');

    // 1. Get Presigned URL
    const key = `uploads/test-${Date.now()}.png`;
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

    // 3. Create Job
    console.log('Step 3: Creating Job...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: 1,
            pageManifest: ['pending-processing']
        })
    });

    if (!jobRes.ok) throw new Error(`Failed to create job: ${jobRes.status}`);
    const { jobId } = await jobRes.json();
    console.log(`Job Created: ${jobId}`);

    // 4. Process Batch
    console.log('Step 4: Processing Batch...');
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

    // 5. Poll Status
    console.log('Step 5: Polling Status...');
    for (let i = 0; i < 10; i++) {
        const statusRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/status`);
        const statusData = await statusRes.json();
        console.log(`Status: ${statusData.status}`, statusData.progress);

        if (statusData.progress.completed === 1) {
            console.log('Job Completed successfully!');
            return;
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error('Verification timed out');
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
