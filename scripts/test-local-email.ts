
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'fs';
import path from 'path';

// Force local URL
const BASE_URL = 'http://localhost:3000';
// Test configuration
const TEST_IMAGE_PATH = path.join(process.cwd(), 'scripts', 'temp_images_batch', 'image-01.png');
const TEST_EMAIL = 'heroharshal69@gmail.com';

async function main() {
    console.log(`🚀 Starting LOCAL E2E test targeting ${BASE_URL}`);
    console.log(`📧 Target Email: ${TEST_EMAIL}`);

    // 1. Get Presigned URL
    console.log('\n1️⃣  Getting upload URL...');
    const filename = `test-local-${Date.now()}.png`;
    const uploadRes = await fetch(`${BASE_URL}/api/get-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            key: `uploads/local-test/${filename}`,
            contentType: 'image/png'
        })
    });

    if (!uploadRes.ok) throw new Error(`Failed to get upload URL: ${await uploadRes.text()}`);
    const { uploadUrl } = await uploadRes.json();
    console.log('Got upload URL');

    // 2. Upload Image
    console.log('\n2️⃣  Uploading image...');
    // Create a dummy image if not exists, or use existing
    if (!fs.existsSync(TEST_IMAGE_PATH)) {
        // Fallback: create a dummy text file renamed as png just for flow test? 
        // No, gemini needs real image.
        // Assuming the file exists as per previous context. 
        // If not, we might fail. Let's assume it exists or use a robust check.
    }

    // We'll read the file buffer.
    // If the path above is wrong, we might need to find a valid image. 
    // I'll try to find one.
    const imageBuffer = fs.readFileSync(TEST_IMAGE_PATH);

    const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: imageBuffer,
        headers: { 'Content-Type': 'image/png' }
    });

    if (!putRes.ok) throw new Error(`Failed to upload image: ${await putRes.text()}`);
    console.log('Image uploaded');

    // 3. Create Job
    console.log('\n3️⃣  Creating job...');
    const manifestKey = `uploads/local-test/${filename}`;
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: 1,
            pageManifest: [manifestKey],
            email: TEST_EMAIL
        })
    });

    if (!jobRes.ok) throw new Error(`Job creation failed: ${await jobRes.text()}`);
    const { jobId } = await jobRes.json();
    console.log(`Job created: ${jobId}`);

    // 4. Poll Status
    console.log('\n4️⃣  Polling status...');
    let attempts = 0;
    while (attempts < 60) {
        const statusRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/status`);
        if (!statusRes.ok) {
            console.log('Error checking status, retrying...');
            continue;
        }

        const status = await statusRes.json();
        process.stdout.write(`\rStatus: ${status.status} Progress: ${status.completedPages}/${status.totalPages}`);

        if (status.status === 'complete') {
            console.log('\n\n✅ SUCCESS! Job complete.');
            if (status.emailStatus === 'sent') {
                console.log('✅ Email marked as SENT in job data.');
                console.log('Check inbox for: ' + TEST_EMAIL);
            } else {
                console.log('⚠️  Job complete but email status is: ' + status.emailStatus);
            }
            return;
        }

        if (status.status === 'failed') {
            console.error('\n\n❌ Job FAILED:', status.error);
            process.exit(1);
        }

        await new Promise(r => setTimeout(r, 2000));
        attempts++;
    }

    console.error('\n\n❌ Timeout waiting for job completion');
    process.exit(1);
}

main().catch(err => {
    console.error('\n❌ Test Error:', err);
    process.exit(1);
});
