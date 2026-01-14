import fs from 'fs';
import path from 'path';
import { generateBatchNotes } from '../lib/gemini';
import { renderToHtml } from '../lib/formatting';
import { wrapWithTemplate } from '../lib/html-template';
import { exec } from 'child_process';
import util from 'util';
import { chromium } from 'playwright';

const execPromise = util.promisify(exec);

// Path to test PDF
const PDF_PATH = path.join(process.cwd(), 'mdnotes.pdf');
const OUT_DIR = path.join(process.cwd(), 'test-output');
const CHECKPOINT_DIR = path.join(OUT_DIR, 'checkpoints');

async function main() {
    console.log("Starting E2E Workflow Test (HTML Pipeline)...");

    if (!fs.existsSync(PDF_PATH)) {
        console.error("Error: mdnotes.pdf not found at " + PDF_PATH);
        process.exit(1);
    }

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    if (!fs.existsSync(CHECKPOINT_DIR)) fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });

    // Step 1: Check if we have a cached Gemini response
    const checkpointPath = path.join(CHECKPOINT_DIR, 'gemini-response.json');
    let batchResponse;

    if (fs.existsSync(checkpointPath)) {
        console.log("Loading cached Gemini response from checkpoint...");
        batchResponse = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    } else {
        // Step 1.1: Convert PDF to images
        console.log("Step 1: Converting PDF to images...");
        const imgPrefix = path.join(OUT_DIR, 'page');

        try {
            await execPromise(`pdftoppm -png -r 150 -f 1 -l 3 "${PDF_PATH}" "${imgPrefix}"`);
        } catch (e) {
            console.error("Failed to convert PDF. Ensure poppler-utils is installed.");
            console.error(e);
            process.exit(1);
        }

        const imageFiles = fs.readdirSync(OUT_DIR)
            .filter(f => f.endsWith('.png') && f.startsWith('page'))
            .sort()
            .map(f => path.join(OUT_DIR, f));

        console.log(`Found ${imageFiles.length} images.`);
        const imagesB64 = imageFiles.map(f => fs.readFileSync(f).toString('base64'));

        // Step 1.2: Call Gemini
        console.log("Step 2: Generating structured notes with Gemini...");
        batchResponse = await generateBatchNotes(imagesB64);

        // Persist Checkpoint
        fs.writeFileSync(checkpointPath, JSON.stringify(batchResponse, null, 2));
        console.log("Saved Gemini response checkpoint.");
    }

    console.log("Gemini Response Metadata:", batchResponse.metadata);

    // Step 3: Render and Compile each page
    console.log("Step 3: Rendering and Compiling (HTML -> PDF)...");

    const browser = await chromium.launch();

    try {
        for (const page of batchResponse.pages) {
            console.log(`Processing Page ${page.pageIndex}...`);

            // Construct IR
            const pageIR = {
                metadata: batchResponse.metadata,
                content: page.content
            };

            // Render to HTML
            const innerHtml = renderToHtml(pageIR);
            const fullHtml = wrapWithTemplate(innerHtml);

            const htmlPath = path.join(CHECKPOINT_DIR, `page-${page.pageIndex}.html`);
            fs.writeFileSync(htmlPath, fullHtml);

            // Render to PDF using local Playwright (Simulating Modal)
            const browserPage = await browser.newPage();
            await browserPage.setContent(fullHtml, { waitUntil: 'networkidle' });

            const pdfBuffer = await browserPage.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '0', bottom: '0', left: '0', right: '0' }
            });

            const pdfPath = path.join(OUT_DIR, `page-${page.pageIndex}.pdf`);
            fs.writeFileSync(pdfPath, pdfBuffer);

            console.log(`✔ Page ${page.pageIndex} compiled. Saved to ${pdfPath}`);

            await browserPage.close();
        }
    } finally {
        await browser.close();
    }

    console.log("E2E Test Complete. Check " + OUT_DIR);
}

main().catch(err => {
    console.error("Unhandled Error:", err);
    process.exit(1);
});

