
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { uploadFile } from '../lib/s3';

const BASE_URL = 'https://handscriptnotes.vercel.app';
// Use one of the existing test images
const IMG_PATH = path.join(process.cwd(), 'scripts', 'temp_test_5', 'image-01.png');

async function main() {
    console.log('Starting PROD E2E test...');

    if (!fs.existsSync(IMG_PATH)) {
        // Create a dummy image if not exists
        if (!fs.existsSync(path.dirname(IMG_PATH))) {
            fs.mkdirSync(path.dirname(IMG_PATH), { recursive: true });
        }
        fs.writeFileSync(IMG_PATH, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==', 'base64'));
    }

    // Upload to B2
    const buffer = fs.readFileSync(IMG_PATH);
    const key = 'uploads/prod-test/' + Date.now() + '-image-01.png';
    await uploadFile(key, buffer, 'image/png');
    console.log('Uploaded:', key);

    // Create job on PROD
    console.log('Creating job on PROD...');
    const jobRes = await fetch(BASE_URL + '/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageCount: 1, pageManifest: [key] })
    });

    if (!jobRes.ok) throw new Error('Job creation failed: ' + await jobRes.text());

    const { jobId } = await jobRes.json();
    console.log('Job created:', jobId);
    console.log('Tracking URL:', BASE_URL + '/status?jobId=' + jobId);

    // Poll
    for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const res = await fetch(BASE_URL + '/api/jobs/' + jobId + '/status');
        const data = await res.json();
        const success = data.progress?.completed;
        const total = data.progress?.total;
        console.log('Status:', data.status, 'Progress:', success + '/' + total);

        if (data.status === 'complete') {
            console.log('SUCCESS! PDF URL:', data.finalPdfUrl);
            return;
        }
        if (data.status === 'failed') {
            console.log('Failed Logs:', JSON.stringify(data.logs, null, 2));
            throw new Error('Job failed: ' + data.error);
        }
    }
    throw new Error('Timeout after 3 minutes');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
