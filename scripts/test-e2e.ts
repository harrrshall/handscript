
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';

async function main() {
    console.log('Starting E2E Test...');

    // 1. Create a dummy image file
    const imagePath = path.join(process.cwd(), 'scripts', 'test-page.png');
    // Create a 5x5 red pixel PNG
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(imagePath, pngBuffer);

    // 2. Upload Image
    console.log('Uploading image...');
    const formData = new FormData();
    formData.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'test-page.png');

    const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData
    });

    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.statusText}`);
    const uploadData = await uploadRes.json();
    const imageUrl = uploadData.url;
    console.log('Image uploaded:', imageUrl);

    // 3. Create Job
    console.log('Creating Job...');
    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: 1,
            // pageManifest: [imageUrl]
            // Use Data URI to avoid localhost fetch deadlock during test
            pageManifest: [`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==`]
        })
    });

    if (!jobRes.ok) throw new Error(`Job creation failed: ${jobRes.statusText}`);
    const jobData = await jobRes.json();
    const jobId = jobData.jobId;
    console.log('Job created:', jobId);

    // 4. Process Page
    console.log('Processing page 0...');
    const processRes = await fetch(`${BASE_URL}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jobId,
            pageIndex: 0
        })
    });

    if (!processRes.ok) throw new Error(`Page processing failed: ${processRes.statusText}`);
    const processData = await processRes.json();
    console.log('Page processed:', processData.success ? 'Success' : 'Failed');
    if (processData.markdown) console.log('Markdown length:', processData.markdown.length);

    // 5. Assemble
    console.log('Assembling...');
    const assembleRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/assemble`, {
        method: 'POST'
    });

    if (!assembleRes.ok) throw new Error(`Assembly failed: ${assembleRes.statusText}`);
    const assembleData = await assembleRes.json();
    console.log('Assembly URL:', assembleData.markdownUrl);

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
    console.log('PDF URL:', renderData.pdfUrl);

    if (renderData.success && renderData.pdfUrl) {
        console.log('E2E Test PASSED!');
    } else {
        console.log('E2E Test FAILED!');
    }
}

main().catch(err => {
    console.error('Test Failed:', err);
    process.exit(1);
});
