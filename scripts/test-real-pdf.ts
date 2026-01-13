
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import pLimit from 'p-limit';

const execPromise = util.promisify(exec);
const BASE_URL = 'http://localhost:3000';
const PDF_PATH = '/home/cybernovas/Desktop/2026/handscript/mdnotes.pdf';
const TEMP_IMG_DIR = path.join(process.cwd(), 'scripts', 'temp_images');

async function main() {
    const startTime = Date.now();
    console.log('Starting Real PDF E2E Test...');

    // 0. Prepare temp dir
    if (fs.existsSync(TEMP_IMG_DIR)) {
        fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_IMG_DIR, { recursive: true });

    // 1. Convert PDF to PNGs using pdftoppm
    console.log('Converting PDF to images...');
    await execPromise(`pdftoppm -png -r 150 "${PDF_PATH}" image`, { cwd: TEMP_IMG_DIR });

    const files = fs.readdirSync(TEMP_IMG_DIR).filter(f => f.endsWith('.png')).sort();
    console.log(`Converted ${files.length} pages.`);

    const imageUrls: string[] = [];

    // 2. Upload images
    for (const file of files) {
        console.log(`Uploading ${file}...`);
        const filePath = path.join(TEMP_IMG_DIR, file);
        const buffer = fs.readFileSync(filePath);
        const blob = new Blob([buffer], { type: 'image/png' });

        const formData = new FormData();
        formData.append('file', blob, file);

        try {
            const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
                method: 'POST',
                body: formData
            });

            if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.statusText}`);
            const uploadData = await uploadRes.json();
            imageUrls.push(uploadData.url);
        } catch (e) {
            console.error(`Failed to upload ${file}`, e);
            throw e;
        }
    }

    // 3. Create Job
    console.log('Creating Job...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: imageUrls.length,
            pageManifest: imageUrls
        })
    });

    if (!jobRes.ok) throw new Error(`Job creation failed: ${jobRes.statusText}`);
    const jobData = await jobRes.json();
    const jobId = jobData.jobId;
    console.log('Job created:', jobId);

    // 4. Process Pages
    console.log('Processing pages...');
    const limit = pLimit(50); // Limit to 50 concurrent requests to Gemini
    const pagePromises = imageUrls.map((_, index) => {
        return limit(async () => {
            console.log(`Triggering page ${index}...`);
            const res = await fetch(`${BASE_URL}/api/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId, pageIndex: index })
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Page ${index} failed: ${txt}`);
            }
            const data = await res.json();
            console.log(`Page ${index} complete. Markdown length: ${data.markdown?.length}`);
        });
    });

    await Promise.all(pagePromises);

    // 5. Assemble
    console.log('Assembling...');
    const assembleRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/assemble`, {
        method: 'POST'
    });

    if (!assembleRes.ok) throw new Error(`Assembly failed: ${assembleRes.statusText}`);

    // 6. Render
    console.log('Rendering PDF...');
    const renderRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/render`, {
        method: 'POST'
    });

    if (!renderRes.ok) {
        const txt = await renderRes.text();
        throw new Error(`Render failed: ${renderRes.status} - ${txt}`);
    }
    const renderData = await renderRes.json();
    console.log('Final PDF URL:', renderData.pdfUrl);

    // 7. Download result
    if (renderData.pdfUrl.startsWith('http://localhost:3000/uploads/')) {
        const filename = renderData.pdfUrl.replace('http://localhost:3000/uploads/', '');
        const localPath = path.join(process.cwd(), 'public', 'uploads', filename);
        if (fs.existsSync(localPath)) {
            console.log(`PDF verified at: ${localPath}`);
            console.log(`Size: ${fs.statSync(localPath).size} bytes`);
        } else {
            console.error('PDF file missing on disk!');
            process.exit(1);
        }
    }

    console.log('Real PDF Test PASSED!');
    const duration = (Date.now() - startTime) / 1000;
    console.log(`Total Time Taken: ${duration.toFixed(2)} seconds`);
}

main().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
