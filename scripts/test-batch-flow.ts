

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
// fetch is global in Node 18+

const execPromise = util.promisify(exec);
const BASE_URL = 'http://localhost:3000';
const PDF_PATH = '/home/cybernovas/Desktop/2026/handscript/mdnotes.pdf';
const TEMP_IMG_DIR = path.join(process.cwd(), 'scripts', 'temp_images_batch');

async function main() {
    const startTime = Date.now();
    console.log('Starting Batch Flow E2E Test...');

    // 0. Prepare temp dir
    if (fs.existsSync(TEMP_IMG_DIR)) {
        fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_IMG_DIR, { recursive: true });

    // 1. Convert PDF to PNGs using pdftoppm (Simulating client side cleanup/processing)
    // Scale 1.5 logic: -r 150 = 1.5 * 72dpi? Standard PDF is 72dpi. 
    // -r 150 is approx scale 2.0 (150/72 = 2.08). 
    // Scale 1.5 would be -r 108. Let's use -r 110 for approx scale 1.5.
    console.log('Converting PDF to images (Simulating client extraction)...');
    await execPromise(`pdftoppm -png -r 110 "${PDF_PATH}" image`, { cwd: TEMP_IMG_DIR });

    const files = fs.readdirSync(TEMP_IMG_DIR).filter(f => f.endsWith('.png')).sort((a, b) => {
        // Sort numerically: image-1.png, image-2.png etc.
        const numA = parseInt(a.match(/\d+/)?.[0] || '0');
        const numB = parseInt(b.match(/\d+/)?.[0] || '0');
        return numA - numB;
    });
    console.log(`Converted ${files.length} pages.`);

    const images: string[] = [];
    for (const file of files) {
        const filePath = path.join(TEMP_IMG_DIR, file);
        const buffer = fs.readFileSync(filePath);
        images.push(buffer.toString('base64'));
    }

    // 2. Create Job
    console.log('Creating Job...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: images.length,
            // Placeholder manifest
            pageManifest: new Array(images.length).fill('pending-upload')
        })
    });

    if (!jobRes.ok) throw new Error(`Job creation failed: ${jobRes.statusText}`);
    const jobData: any = await jobRes.json();
    const jobId = jobData.jobId;
    console.log('Job created:', jobId);

    // 3. Process Batches (Simulating Status.tsx logic)
    console.log('Processing batches...');

    const BATCH_SIZE = 1;
    const batches = [];
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
        batches.push({
            start: i,
            imgs: images.slice(i, i + BATCH_SIZE)
        });
    }

    // Process batches with limited concurrency to avoid overwhelming local dev server
    const CONCURRENCY_LIMIT = 10;
    const results = [];
    const executing = new Set();

    for (const batch of batches) {
        const p = (async () => {
            const batchIdx = batch.start / BATCH_SIZE; // Approx index
            const start = Date.now();
            console.log(`Sending batch at index ${batch.start}...`);

            const res = await fetch(`${BASE_URL}/api/process-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId,
                    startPageIndex: batch.start,
                    images: batch.imgs
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

    // 4. Finalize
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

    // 5. Cleanup temp
    // fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });

    const totalDuration = (Date.now() - startTime) / 1000;
    console.log('Batch Flow Test PASSED!');
    console.log(`Total Time Taken: ${totalDuration.toFixed(2)} seconds`);
}

main().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
