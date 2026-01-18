/**
 * E2E Test Script for Handscript
 * 
 * Tests the complete workflow from PDF upload to processing.
 * Renders actual PDF pages using canvas for realistic testing.
 * 
 * Usage:
 *   npx tsx tests/e2e-workflow.ts [--mode local|production] [--pdf path/to/file.pdf]
 */

import * as fs from 'fs';
import * as path from 'path';
import { createCanvas } from 'canvas';

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'test@gmail.com';
const DEFAULT_PDF = path.join(process.cwd(), 'mdnotes.pdf');

// Parse command line arguments
const args = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith('--mode='))?.split('=')[1] || 'local';
const pdfArg = args.find(a => a.startsWith('--pdf='))?.split('=')[1] || DEFAULT_PDF;

interface JobResponse {
    jobId: string;
    status: string;
    totalPages?: number;
    error?: string;
}

interface StatusResponse {
    status: string;
    progress: {
        total: number;
        completed: number;
        failed: number;
    };
    logs: string[];
    finalPdfUrl?: string;
    error?: string;
}

// Helper to log with timestamp
function log(message: string) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// Helper to wait
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Render PDF pages to actual JPEG images using canvas
async function extractPdfPages(pdfPath: string): Promise<{ pageCount: number; images: Buffer[] }> {
    log(`Reading PDF: ${pdfPath}`);

    const pdfjs = await import('pdfjs-dist');
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfData = new Uint8Array(pdfBuffer);
    const pdfDoc = await pdfjs.getDocument({ data: pdfData }).promise;
    const pageCount = pdfDoc.numPages;

    log(`PDF has ${pageCount} pages. Rendering pages to images...`);

    const images: Buffer[] = [];
    const SCALE = 2.0; // Higher quality rendering

    for (let i = 1; i <= pageCount; i++) {
        try {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: SCALE });

            // Create canvas for rendering
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext('2d');

            // Render PDF page to canvas
            await page.render({
                canvasContext: context as any,
                viewport: viewport,
            }).promise;

            // Convert to JPEG buffer
            const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
            images.push(jpegBuffer);

            log(`  Page ${i}/${pageCount} rendered (${Math.round(jpegBuffer.length / 1024)}KB)`);
        } catch (err: any) {
            log(`  ⚠️ Page ${i} render failed: ${err.message}`);
            // Create a placeholder for failed pages
            const canvas = createCanvas(800, 1000);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, 800, 1000);
            ctx.fillStyle = 'red';
            ctx.font = '24px sans-serif';
            ctx.fillText(`Page ${i} - Render Failed`, 50, 100);
            images.push(canvas.toBuffer('image/jpeg'));
        }
    }

    return { pageCount, images };
}

// Upload a single image
async function uploadImage(key: string, imageBuffer: Buffer, contentType: string): Promise<string> {
    // Step 1: Get presigned/upload URL
    const urlResponse = await fetch(`${BASE_URL}/api/get-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, contentType }),
    });

    if (!urlResponse.ok) {
        throw new Error(`Failed to get upload URL: ${urlResponse.status} ${await urlResponse.text()}`);
    }

    const { uploadUrl } = await urlResponse.json();

    // Handle relative URLs (local dev mode returns /api/upload?...)
    const fullUploadUrl = uploadUrl.startsWith('/') ? `${BASE_URL}${uploadUrl}` : uploadUrl;

    // Step 2: Upload to the URL (PUT for S3/local)
    const uploadResponse = await fetch(fullUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(imageBuffer),
    });

    if (!uploadResponse.ok) {
        throw new Error(`Failed to upload: ${uploadResponse.status} ${await uploadResponse.text()}`);
    }

    return key;
}

// Create a new job
async function createJob(email: string, pageKeys: string[]): Promise<JobResponse> {
    const response = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            pageManifest: pageKeys,
            pageCount: pageKeys.length,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create job: ${response.status} ${error}`);
    }

    const data = await response.json();
    log(`Created job: ${data.jobId}`);
    return data;
}

// Check job status
async function getJobStatus(jobId: string): Promise<StatusResponse> {
    const response = await fetch(`${BASE_URL}/api/jobs/${jobId}/status`);

    if (!response.ok) {
        throw new Error(`Failed to get status: ${response.status}`);
    }

    return response.json();
}

// Wait for job completion with timeout
async function waitForCompletion(jobId: string, timeoutMs: number = 300000): Promise<StatusResponse> {
    const startTime = Date.now();
    let lastStatus = '';
    let lastProgress = '';

    while (Date.now() - startTime < timeoutMs) {
        const status = await getJobStatus(jobId);
        const progress = `${status.progress.completed}/${status.progress.total}`;

        // Only log when status or progress changes
        if (status.status !== lastStatus || progress !== lastProgress) {
            log(`Status: ${status.status} | Progress: ${progress} | Failed: ${status.progress.failed}`);
            lastStatus = status.status;
            lastProgress = progress;
        }

        if (status.status === 'complete') {
            log(`✅ Job completed successfully!`);
            return status;
        }

        if (status.status === 'failed') {
            log(`❌ Job failed: ${status.error}`);
            return status;
        }

        await sleep(3000); // Poll every 3 seconds
    }

    throw new Error(`Timeout waiting for job ${jobId} after ${timeoutMs}ms`);
}

// Main E2E test
async function runE2ETest() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 HANDSCRIPT E2E TEST');
    console.log('='.repeat(60));
    log(`Mode: ${modeArg}`);
    log(`Base URL: ${BASE_URL}`);
    log(`PDF File: ${pdfArg}`);
    log(`Test Email: ${TEST_EMAIL}`);
    console.log('='.repeat(60) + '\n');

    try {
        // Step 1: Verify server is running
        log('Step 1: Checking server health...');
        try {
            const healthCheck = await fetch(BASE_URL);
            if (!healthCheck.ok) {
                throw new Error(`Server returned ${healthCheck.status}`);
            }
            log('✅ Server is running');
        } catch (e: any) {
            log(`❌ Server not reachable at ${BASE_URL}: ${e.message}`);
            log('Please start the server with: npm run dev');
            process.exit(1);
        }

        // Step 2: Check if PDF exists
        log('\nStep 2: Checking PDF file...');
        if (!fs.existsSync(pdfArg)) {
            log(`❌ PDF not found: ${pdfArg}`);
            process.exit(1);
        }
        log(`✅ PDF found: ${pdfArg}`);

        // Step 3: Extract and render PDF pages to actual images
        log('\nStep 3: Rendering PDF pages to images...');
        const { pageCount, images } = await extractPdfPages(pdfArg);
        log(`✅ Rendered ${pageCount} pages`);

        // Step 4: Upload images
        log('\nStep 4: Uploading page images...');
        const timestamp = Date.now();
        const pageKeys: string[] = [];

        for (let i = 0; i < images.length; i++) {
            const key = `inputs/${timestamp}-page-${i + 1}.jpg`;
            await uploadImage(key, images[i], 'image/jpeg');
            log(`  Uploaded page ${i + 1}/${images.length}`);
            pageKeys.push(key);
        }
        log(`✅ Uploaded ${pageKeys.length} images`);

        // Step 5: Create job
        log('\nStep 5: Creating transcription job...');
        const job = await createJob(TEST_EMAIL, pageKeys);
        log(`✅ Job created: ${job.jobId}`);

        // Step 6: Wait for processing
        log('\nStep 6: Waiting for processing (may take a few minutes)...');
        const finalStatus = await waitForCompletion(job.jobId, 600000); // 10 min timeout

        // Step 7: Report results
        console.log('\n' + '='.repeat(60));
        console.log('📊 TEST RESULTS');
        console.log('='.repeat(60));

        if (finalStatus.status === 'complete') {
            console.log('✅ E2E TEST PASSED');
            console.log(`   - Total Pages: ${finalStatus.progress.total}`);
            console.log(`   - Completed: ${finalStatus.progress.completed}`);
            console.log(`   - Failed: ${finalStatus.progress.failed}`);
            if (finalStatus.finalPdfUrl) {
                console.log(`   - PDF URL: ${finalStatus.finalPdfUrl}`);
            }
        } else {
            console.log('❌ E2E TEST FAILED');
            console.log(`   - Status: ${finalStatus.status}`);
            console.log(`   - Error: ${finalStatus.error || 'Unknown'}`);
            process.exit(1);
        }

        // Print last 10 logs
        if (finalStatus.logs && finalStatus.logs.length > 0) {
            console.log('\n📝 Processing Logs (last 10):');
            finalStatus.logs.slice(-10).forEach(l => console.log(`   ${l}`));
        }

        console.log('='.repeat(60) + '\n');

    } catch (error: any) {
        console.error('\n❌ E2E TEST ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
runE2ETest();
