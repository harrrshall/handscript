

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { uploadFile, deleteFile } from '../lib/s3';

const execPromise = util.promisify(exec);
const BASE_URL = 'http://localhost:3000';
const PDF_PATH = path.join(process.cwd(), 'mdnotes.pdf');
const TEMP_IMG_DIR = path.join(process.cwd(), 'scripts', 'temp_images_batch');

async function main() {
    const startTime = Date.now();
    console.log('Starting Batch Flow E2E Test (B2 Integration)...');

    // 0. Prepare temp dir
    if (fs.existsSync(TEMP_IMG_DIR)) {
        fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_IMG_DIR, { recursive: true });

    // 1. Convert PDF to PNGs or Create Dummy (Simulating client side cleanup/processing)
    let files: string[] = [];

    if (fs.existsSync(PDF_PATH)) {
        console.log('Converting PDF to images (Simulating client extraction)...');
        // Check for pdftoppm
        try {
            await execPromise('pdftoppm -v');
            await execPromise(`pdftoppm -png -r 110 "${PDF_PATH}" image`, { cwd: TEMP_IMG_DIR });

            files = fs.readdirSync(TEMP_IMG_DIR).filter(f => f.endsWith('.png')).sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)?.[0] || '0');
                const numB = parseInt(b.match(/\d+/)?.[0] || '0');
                return numA - numB;
            });
        } catch (e) {
            console.warn("pdftoppm not found or failed, using dummy images.");
        }
    }

    if (files.length === 0) {
        console.log("Using dummy images...");
        // Create 3 dummy images
        for (let i = 0; i < 3; i++) {
            const filename = `dummy-${i + 1}.png`;
            // 5x5 red pixel
            const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==', 'base64');
            fs.writeFileSync(path.join(TEMP_IMG_DIR, filename), buffer);
            files.push(filename);
        }
    }

    console.log(`Prepared ${files.length} images.`);

    // 2. Upload Images to B2
    console.log('presigned URL upload simulation (Direct B2 Upload via test script)...');
    const b2Keys: string[] = [];

    for (const file of files) {
        const filePath = path.join(TEMP_IMG_DIR, file);
        const buffer = fs.readFileSync(filePath);
        const key = `uploads/test-batch/${Date.now()}-${file}`;
        console.log(`Uploading ${file} to ${key}...`);
        await uploadFile(key, buffer, 'image/png');
        b2Keys.push(key);
    }
    console.log('All images uploaded to B2.');


    // 3. Create Job
    console.log('Creating Job...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: b2Keys.length,
            pageManifest: b2Keys
        })
    });

    if (!jobRes.ok) throw new Error(`Job creation failed: ${jobRes.statusText}`);
    const jobData: any = await jobRes.json();
    const jobId = jobData.jobId;
    console.log('Job created:', jobId);

    // 4. Process Batches
    console.log('Processing batches...');

    const BATCH_SIZE = 5; // Increased batch size as we send keys
    const batches = [];
    for (let i = 0; i < b2Keys.length; i += BATCH_SIZE) {
        batches.push({
            start: i,
            keys: b2Keys.slice(i, i + BATCH_SIZE)
        });
    }

    const CONCURRENCY_LIMIT = 5;
    const results = [];
    const executing = new Set();

    for (const batch of batches) {
        const p = (async () => {
            const start = Date.now();
            console.log(`Sending batch at index ${batch.start}...`);

            const res = await fetch(`${BASE_URL}/api/process-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId,
                    startPageIndex: batch.start,
                    keys: batch.keys
                })
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Batch at ${batch.start} failed: ${res.status} ${txt}`);
            }

            const data = await res.json();
            const duration = (Date.now() - start) / 1000;
            console.log(`Batch at ${batch.start} complete in ${duration.toFixed(2)}s`);
            return data;
        })();

        results.push(p);
        executing.add(p);

        const clean = () => executing.delete(p);
        p.then(clean).catch(clean);

        if (executing.size >= CONCURRENCY_LIMIT) {
            await Promise.race(executing);
        }
    }

    await Promise.all(results);
    console.log('All batches processed.');

    // 5. Finalize
    console.log('Finalizing (Assembly + Render)...');
    const finalizeStart = Date.now();
    const finalizeRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/finalize`, {
        method: 'POST'
    });

    if (!finalizeRes.ok) {
        const txt = await finalizeRes.text();
        throw new Error(`Finalize failed: ${finalizeRes.status} ${txt}`);
    }

    const finalizeData: any = await finalizeRes.json();
    const finalizeDuration = (Date.now() - finalizeStart) / 1000;
    console.log(`Finalize complete in ${finalizeDuration.toFixed(2)}s`);
    console.log('Final PDF URL:', finalizeData.pdfUrl);

    // 6. Cleanup B2 Uploads
    console.log("Cleaning up B2 inputs...");
    try {
        await deleteFile(b2Keys);
        console.log("Input images deleted from B2.");
    } catch (e) {
        console.error("Failed to cleanup B2 inputs:", e);
    }

    const totalDuration = (Date.now() - startTime) / 1000;
    console.log('Batch Flow Test PASSED!');
    console.log(`Total Time Taken: ${totalDuration.toFixed(2)} seconds`);
}

main().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
