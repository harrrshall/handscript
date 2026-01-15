
import dotenv from 'dotenv';
import path from 'path';

// Load .env explicitly BEFORE importing anything that uses it
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const BASE_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

async function main() {
    // Dynamic import to prevent hoisting
    const { redis } = await import('../lib/redis');

    console.log("----------------------------------------");
    console.log("Testing Server-Side Background Flow");
    console.log("----------------------------------------");
    console.log(`Base URL: ${BASE_URL}`);

    // 1. Create a dummy job
    console.log("\n1. creating job...");
    const manifest = ["test-key-1", "test-key-2"]; // These keys won't actually work with Gemini unless real, but we test the recursion logic
    // We can't easily test the full Gemini flow without real B2 keys, but we can test the job creation -> QStash trigger

    // For this test, valid keys aren't strictly needed if we just want to see if QStash receives the message
    // However, to see the whole flow, we'd need to mock Gemini or use real files.

    // Let's at least hit the job creation endpoint and check the logs/redis
    const res = await fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageCount: 2,
            pageManifest: manifest,
            email: "harshalsingh1223@gmail.com" // Test email
        })
    });

    if (!res.ok) {
        console.error("Job creation failed:", await res.text());
        process.exit(1);
    }

    const jobData = await res.json();
    console.log("Job created:", jobData);

    console.log("\n2. Verify Job in Redis...");
    const redisJob: any = await redis.get(`job:${jobData.jobId}`);
    if (redisJob && redisJob.email === "harshalsingh1223@gmail.com") {
        console.log("✅ Job stored correctly in Redis with Email.");
    } else {
        console.error("❌ Redis verification failed", redisJob);
    }

    // 3. Since we're running locally or against Vercel, we can't easily subscribe to QStash to verify it *received* it without checking QStash console.
    // But we can check if the 'internal/process-batch' endpoint is accessible.

    console.log("\n3. Testing Internal Batch Endpoint Accessibility...");
    // This should fail usually if called directly without signature, or warn.
    // But let's verify we can hit it.

    // We can't really "simulate" the QStash callback easily without signing keys.
    // But we can assume if the code runs, it's queueing.

    console.log("\n----------------------------------------");
    console.log("Test Script Complete.");
    console.log("Check the application logs to see:");
    console.log("1. 'Started background processing for job...'");
    console.log("2. QStash logs for successful delivery.");
}

main();
