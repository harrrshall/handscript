
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { uploadFile, deleteFile } from '../lib/s3';
import { env } from '../lib/env';

const execPromise = util.promisify(exec);
const BASE_URL = 'http://localhost:3000';
const PDF_PATH = path.join(process.cwd(), 'mdnotes.pdf');
const TEMP_IMG_DIR = path.join(process.cwd(), 'scripts', 'temp_images_workflow');

async function main() {
    const startTime = Date.now();
    console.log('Starting End-to-End Workflow Verification...');

    // 0. Prepare temp dir
    if (fs.existsSync(TEMP_IMG_DIR)) {
        fs.rmSync(TEMP_IMG_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_IMG_DIR, { recursive: true });

    // 1. Prepare Images
    let files: string[] = [];
    const SOURCE_DIR = path.join(process.cwd(), 'scripts', 'temp_images_batch');

    if (fs.existsSync(SOURCE_DIR) && fs.readdirSync(SOURCE_DIR).length > 0) {
        console.log(`Using existing images from ${SOURCE_DIR}...`);
        const sourceFiles = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));

        for (const file of sourceFiles) {
            fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(TEMP_IMG_DIR, file));
            files.push(file);
        }
    }

    if (files.length === 0 && fs.existsSync(PDF_PATH)) {
        console.log('Converting PDF to images...');
        try {
            await execPromise('pdftoppm -v');
            await execPromise(`pdftoppm -png -r 72 "${PDF_PATH}" image`, { cwd: TEMP_IMG_DIR });

            files = fs.readdirSync(TEMP_IMG_DIR).filter(f => f.endsWith('.png')).sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)?.[0] || '0');
                const numB = parseInt(b.match(/\d+/)?.[0] || '0');
                return numA - numB;
            });
        } catch (e) {
            console.warn("pdftoppm not found or failed.");
        }
    }

    if (files.length === 0) {
        console.log("Using dummy images (Fallback)...");
        for (let i = 0; i < 3; i++) {
            const filename = `dummy-${i + 1}.png`;
            const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==', 'base64');
            fs.writeFileSync(path.join(TEMP_IMG_DIR, filename), buffer);
            files.push(filename);
        }
    }

    console.log(`Prepared ${files.length} images.`);

    // 2. Upload Images to B2 (Simulate User Upload)
    console.log('Uploading images to B2...');
    const b2Keys: string[] = [];
    for (const file of files) {
        const filePath = path.join(TEMP_IMG_DIR, file);
        const buffer = fs.readFileSync(filePath);
        const key = `uploads/workflow-test/${Date.now()}-${file}`;
        await uploadFile(key, buffer, 'image/png');
        b2Keys.push(key);
    }
    console.log(`Uploaded ${b2Keys.length} images.`);

    // 3. Create Job
    console.log('Creating Job via API...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: b2Keys.length,
            pageManifest: b2Keys
        })
    });

    if (!jobRes.ok) {
        const txt = await jobRes.text();
        throw new Error(`Job creation failed: ${jobRes.status} ${txt}`);
    }

    const jobData: any = await jobRes.json();
    const jobId = jobData.jobId;
    console.log(`Job Created: ${jobId}`);

    // 4. Poll for Completion (Simulating Client)
    console.log('Polling for completion...');
    let attempts = 0;
    const maxAttempts = 600; // 600 * 2s = 20 minutes timeout
    let finalPdfUrl: string | undefined;

    while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));

        // GET /api/jobs/{jobId}/status
        const statusRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/status`);
        if (statusRes.ok) {
            const statusData: any = await statusRes.json();
            const status = statusData.status;
            // Handle potentially undefined progress initially
            const progress = statusData.progress || { completed: 0, total: statusData.totalPages || 0 };

            console.log(`Attempt ${attempts + 1}: Status = ${status}, Completed = ${progress.completed}/${progress.total}`);

            if (status === 'complete') {
                finalPdfUrl = statusData.finalPdfUrl;
                break;
            }
            if (status === 'failed') {
                throw new Error(`Job failed: ${statusData.error}`);
            }
        } else {
            console.warn(`Status check failed: ${statusRes.status}`);
        }

        attempts++;
    }

    if (!finalPdfUrl) {
        throw new Error("Timeout waiting for job completion.");
    }

    console.log(`Job Complete! URL: ${finalPdfUrl}`);

    // 5. Verify PDF
    console.log("Verifying PDF accessibility...");
    const pdfRes = await fetch(finalPdfUrl);
    if (!pdfRes.ok) throw new Error(`Failed to fetch final PDF: ${pdfRes.status}`);

    const pdfBlob = await pdfRes.arrayBuffer();
    console.log(`PDF Downloaded: ${pdfBlob.byteLength} bytes.`);

    if (pdfBlob.byteLength < 100) {
        throw new Error("PDF seems too small/invalid.");
    }

    // 6. Cleanup
    console.log("Cleaning up B2 inputs...");
    try {
        await deleteFile(b2Keys);
    } catch (e) {
        console.warn("Cleanup warning (might have been done by server):", e);
    }

    console.log("Test Passed Successfully.");
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`Total duration: ${totalTime.toFixed(2)}s`);
}

main().catch(e => {
    console.error("Test Failed", e);
    process.exit(1);
});
