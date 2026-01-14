
import { redis } from '../lib/redis';
import { nanoid } from 'nanoid';

async function main() {
    console.log("Starting Parallel Rendering Verification...");
    const PAGE_COUNT = 50;
    const jobId = nanoid();

    console.log(`Seeding Job ${jobId} with ${PAGE_COUNT} pages...`);

    // 1. Create Job State
    const job = {
        id: jobId,
        status: 'processing',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        totalPages: PAGE_COUNT,
        completedPages: PAGE_COUNT, // Simulate all done
        failedPages: [],
        pageManifest: new Array(PAGE_COUNT).fill('dummy-url'),
        blobPrefix: `jobs/${jobId}`
    };

    await redis.set(`job:${jobId}`, job);

    // 2. Seed Pages
    const msetObj: Record<string, string> = {};
    for (let i = 0; i < PAGE_COUNT; i++) {
        // Mix of simple and "complex" pages
        const isMath = i % 5 === 0;
        const markdown = isMath
            ? `# Page ${i + 1}\n\nHere is some math: $E=mc^2$\n\n$$ \\int_0^\\infty x^2 dx $$`
            : `# Page ${i + 1}\n\nThis is a standard text page to test throughput.`;

        msetObj[`job:${jobId}:page:${i}`] = JSON.stringify({
            markdown,
            status: 'complete'
        });
    }
    await redis.mset(msetObj);

    console.log("Seeding complete. Triggering Finalize...");

    // 3. Call Finalize
    const start = Date.now();
    const res = await fetch(`http://localhost:3000/api/jobs/${jobId}/finalize`, {
        method: 'POST'
    });

    const duration = (Date.now() - start) / 1000;

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Finalize failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    console.log(`Finalize Success!`);
    console.log(`Duration: ${duration.toFixed(2)}s for ${PAGE_COUNT} pages.`);
    console.log(`PDF URL: ${data.pdfUrl}`);

    if (duration > 30) {
        console.warn("WARNING: Duration exceeded 30s target!");
    } else {
        console.log("SUCCESS: Duration within target.");
    }

    // Cleanup? Maybe keep for manual inspection
}

main().catch(console.error);
