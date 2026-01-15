
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const BASE_URL = 'http://localhost:3000'; // TARGET LOCALHOST
const PDF_PATH = path.join(process.cwd(), 'mdnotes.pdf');
const TEMP_IMG_DIR = path.join(process.cwd(), 'scripts', 'temp_images_local_test');

async function main() {
    console.log('Starting Local E2E Test...');
    console.log(`Target: ${BASE_URL}`);

    if (!fs.existsSync(PDF_PATH)) {
        throw new Error(`PDF not found at ${PDF_PATH}. Please ensure mdnotes.pdf is in the project root.`);
    }

    // 0. Cleanup and Prepare
    if (fs.existsSync(TEMP_IMG_DIR)) {
        fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_IMG_DIR, { recursive: true });

    // 1. Convert PDF to Images
    console.log('Converting PDF to images...');
    await execPromise(`pdftoppm -png -r 110 "${PDF_PATH}" image`, { cwd: TEMP_IMG_DIR });

    const files = fs.readdirSync(TEMP_IMG_DIR).filter(f => f.endsWith('.png')).sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
        return numA - numB;
    });
    console.log(`Generated ${files.length} images.`);

    // 2. Upload Images
    const pageManifest: string[] = [];
    console.log('Uploading images...');

    for (const file of files) {
        const filePath = path.join(TEMP_IMG_DIR, file);
        const fileBuffer = fs.readFileSync(filePath);

        const key = `inputs/local/${Date.now()}-${Math.random().toString(36).substring(7)}-${file}`;

        // Get Upload URL
        const uploadRes = await fetch(`${BASE_URL}/api/get-upload-url`, {
            method: 'POST',
            body: JSON.stringify({ key, contentType: 'image/png' }),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!uploadRes.ok) throw new Error(`Failed to get upload URL: ${uploadRes.status}`);
        const { uploadUrl } = await uploadRes.json();

        // Upload to B2/S3
        const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: fileBuffer,
            headers: { 'Content-Type': 'image/png' }
        });

        if (!putRes.ok) throw new Error(`Failed to upload to blob: ${putRes.status}`);
        pageManifest.push(key);
    }
    console.log(`Uploaded ${pageManifest.length} pages.`);

    // 3. Create Job
    console.log('Creating Job...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: pageManifest.length,
            pageManifest,
            email: 'test-user-local@example.com'
        })
    });

    if (!jobRes.ok) {
        throw new Error(`Job creation failed: ${jobRes.status} ${await jobRes.text()}`);
    }

    const { jobId } = await jobRes.json();
    console.log(`Job Created: ${jobId}`);

    // 4. Poll Status
    console.log('Polling for status...');
    const startTime = Date.now();

    while (true) {
        const statusRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/status`);
        if (!statusRes.ok) {
            console.error(`Status check failed: ${statusRes.status}`);
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        const statusData = await statusRes.json();
        console.log(`Status: ${statusData.status} | Completed: ${statusData.progress?.completed ?? statusData.completedPages}/${statusData.progress?.total ?? statusData.totalPages}`);

        if (statusData.status === 'complete') {
            const timeTaken = (Date.now() - startTime) / 1000;
            console.log('Job Complete!');
            console.log(`PDF URL: ${statusData.finalPdfUrl}`);
            console.log(`Time Taken: ${timeTaken.toFixed(2)}s`);
            break;
        }

        if (statusData.status === 'failed') {
            throw new Error(`Job Failed: ${statusData.error}`);
        }

        if (Date.now() - startTime > 600000) { // 10 mins timeout
            throw new Error('Test timed out (> 300s)');
        }

        await new Promise(r => setTimeout(r, 3000));
    }

    // Cleanup
    fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });
}

main().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
