
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);
const BASE_URL = 'https://handscriptnotes.vercel.app';
const PDF_PATH = '/home/cybernovas/Desktop/2026/handscript/mdnotes.pdf';
const TEMP_IMG_DIR = path.join(process.cwd(), 'scripts', 'temp_images_prod_test');

async function main() {
    const startTime = Date.now();
    console.log('Starting Vercel Production E2E Test...');
    console.log(`Target: ${BASE_URL}`);
    console.log(`PDF: ${PDF_PATH}`);

    // 0. Prepare temp dir
    if (fs.existsSync(TEMP_IMG_DIR)) {
        fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_IMG_DIR, { recursive: true });

    // 1. Convert PDF to PNGs using pdftoppm (Simulating client side cleanup/processing)
    // Scale 1.5 logic: -r 110 (approx)
    console.log('Converting PDF to images (Simulating client extraction)...');
    try {
        await execPromise(`pdftoppm -png -r 110 "${PDF_PATH}" image`, { cwd: TEMP_IMG_DIR });
    } catch (e) {
        console.error("PDF conversion failed. Ensure poppler-utils is installed.");
        throw e;
    }

    const files = fs.readdirSync(TEMP_IMG_DIR).filter(f => f.endsWith('.png')).sort((a, b) => {
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
    console.log('Creating Job on Production...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: images.length,
            pageManifest: new Array(images.length).fill('pending-upload')
        })
    });

    if (!jobRes.ok) {
        const txt = await jobRes.text();
        throw new Error(`Job creation failed: ${jobRes.status} ${txt}`);
    }
    const jobData: any = await jobRes.json();
    const jobId = jobData.jobId;
    console.log('Job created ID:', jobId);

    // 3. Process Batches (Simulating Status.tsx logic)
    console.log('Processing batches...');

    // Production allows higher concurrency than local dev
    const BATCH_SIZE = 1; // Keeping 1 for granular progress
    const CONCURRENCY_LIMIT = 20; // Aggressive parallelism for Vercel

    const batches = [];
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
        batches.push({
            start: i,
            imgs: images.slice(i, i + BATCH_SIZE)
        });
    }

    const results = [];
    const executing = new Set();
    let completedCount = 0;

    for (const batch of batches) {
        const p = (async () => {
            const start = Date.now();
            console.log(`[${batch.start + 1}/${images.length}] Sending batch...`);

            try {
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
                    // Don't throw immediately, let other batches finish? 
                    // Ideally we retry, but for this test we throw to catch issues.
                    throw new Error(`Batch at ${batch.start} failed: ${res.status} ${txt}`);
                }

                const data = await res.json();
                const duration = (Date.now() - start) / 1000;
                completedCount += batch.imgs.length;
                console.log(`[${batch.start + 1}] Complete in ${duration.toFixed(2)}s`);
                return data;
            } catch (err) {
                console.error(`Error in batch ${batch.start}:`, err);
                throw err;
            }
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
    console.log('Finalizing (Unified Assembly + Render)...');
    const finalizeStart = Date.now();
    let finalizeData: any;

    // Retry finalize a few times as sometimes Vercel/Redis propagation has slight delay logic? No, should be instant.
    // But Render might take time.

    // We only call finalize ONCE as it triggers the render. It is not poll based.
    const finalizeRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/finalize`, {
        method: 'POST'
    });

    if (!finalizeRes.ok) {
        const txt = await finalizeRes.text();
        throw new Error(`Finalize failed: ${finalizeRes.status} ${txt}`);
    }

    finalizeData = await finalizeRes.json();
    const finalizeDuration = (Date.now() - finalizeStart) / 1000;

    console.log(`Finalize complete in ${finalizeDuration.toFixed(2)}s`);

    if (finalizeData.pdfUrl) {
        console.log('SUCCESS! Final PDF URL:', finalizeData.pdfUrl);
    } else {
        console.error('Finalize returned success but no PDF URL:', finalizeData);
    }

    // 5. Cleanup temp
    fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });

    const totalDuration = (Date.now() - startTime) / 1000;
    console.log('--------------------------------------------------');
    console.log('Production Test Summary');
    console.log('--------------------------------------------------');
    console.log(`Total Pages: ${images.length}`);
    console.log(`Total Time : ${totalDuration.toFixed(2)}s`);
    console.log(`Speed      : ${(totalDuration / images.length).toFixed(2)}s per page`);
    console.log('--------------------------------------------------');
}

main().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
