import fs from 'fs';
import path from 'path';
import { generateBatchNotes } from '../lib/gemini';
import { renderToTypst } from '../lib/formatting';
import { compileTypst } from '../lib/typst';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// Path to test PDF
const PDF_PATH = path.join(process.cwd(), 'mdnotes.pdf');
const OUT_DIR = path.join(process.cwd(), 'test-output');

async function main() {
    console.log("Starting E2E Workflow Test...");

    if (!fs.existsSync(PDF_PATH)) {
        console.error("Error: mdnotes.pdf not found at " + PDF_PATH);
        process.exit(1);
    }

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    // Step 1: Convert PDF to images using a system command (pdftoppm)
    // We assume the user has poppler-utils or similar. If not, we might fail.
    // Let's rely on standard linux tools.
    console.log("Step 1: Converting PDF to images...");
    const imgPrefix = path.join(OUT_DIR, 'page');

    // Using pdftoppm (Generic linux tool)
    // -png: output png
    // -r 150: 150 dpi (simulating reasonable quality)
    // -f 1 -l 3: limit to first 3 pages to save tokens/time for test
    try {
        await execPromise(`pdftoppm -png -r 150 -f 1 -l 3 "${PDF_PATH}" "${imgPrefix}"`);
    } catch (e) {
        console.error("Failed to convert PDF. Ensure poppler-utils is installed. Falling back to mock or failing.");
        console.error(e);
        // Try Python fallback if pdftoppm fails?
        process.exit(1);
    }

    const imageFiles = fs.readdirSync(OUT_DIR)
        .filter(f => f.endsWith('.png') && f.startsWith('page'))
        .sort()
        .map(f => path.join(OUT_DIR, f));

    console.log(`Found ${imageFiles.length} images.`);

    // Read images as base64
    const imagesB64 = imageFiles.map(f => fs.readFileSync(f).toString('base64'));

    // Step 2: Call Gemini (Structured)
    console.log("Step 2: Generating structured notes with Gemini...");
    const batchResponse = await generateBatchNotes(imagesB64);

    console.log("Gemini Response Metadata:", batchResponse.metadata);

    // Step 3: Render and Compile each page
    console.log("Step 3: Rendering and Compiling...");

    for (const page of batchResponse.pages) {
        console.log(`Processing Page ${page.pageIndex}...`);

        // Construct IR
        const pageIR = {
            metadata: batchResponse.metadata,
            content: page.content
        };

        // Convert to Typst
        const typstCode = renderToTypst(pageIR);
        const typstPath = path.join(OUT_DIR, `page-${page.pageIndex}.typ`);
        fs.writeFileSync(typstPath, typstCode);

        // Compile using our local library (which connects to Modal in prod, but local exec in dev lib/typst.ts)
        // Wait, lib/typst.ts uses local `typst compile`. This is perfect for this test.
        // It does NOT use Modal. The API route uses Modal. 
        // We are testing the core library logic here.

        // We need to ensure we pass the correct content.
        // compileTypst writes to a temp dir and copies template.
        try {
            const pdfUrl = await compileTypst(typstCode, `test-job-page-${page.pageIndex}`);
            console.log(`✔ Page ${page.pageIndex} compiled. URL/Path: ${pdfUrl}`);
        } catch (e) {
            console.error(`✘ Page ${page.pageIndex} failed to compile.`);
            console.error(e);
        }
    }

    console.log("E2E Test Complete. Check " + OUT_DIR);
}

main().catch(err => {
    console.error("Unhandled Error:", err);
    process.exit(1);
});
