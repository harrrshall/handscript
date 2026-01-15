Implementation Guide: Converting to Atomic Task Pattern (Hack 1)

This guide outlines the steps to convert your current batch-of-3 system into an Atomic Task Pattern, where each image is processed by a dedicated Vercel function call. This maximizes parallelism and eliminates timeout issues.

1. Architectural Shift: From Sequential to Fan-Out

Feature
Current System (Batch of 3)
New System (Atomic)
Work Unit
3 images per request
1 image per request
Parallelism
Sequential batches
Full parallel fan-out
Retry Granularity
Retries all 3 images
Retries only the failed image
Vercel Runtime
High risk of >60s
Extremely low (<15s typical)




2. Step-by-Step Implementation

Step 1: Update the Job Dispatcher (/api/jobs)

Instead of grouping images into batches of 3, you will now "fan out" every image as a separate QStash message.

Old Logic:

TypeScript


const batches = chunk(images, 3);
for (const batch of batches) {
  await qstash.publishJSON({ url: "/api/internal/process-batch", body: { batch } });
}


New Logic (using QStash Batch API):
To avoid making $N$ separate HTTP calls to QStash, use the QStash Batch Endpoint 
. This allows you to send all $N$ tasks in a single request to Upstash.

TypeScript


import { Client } from "@upstash/qstash";
const qstash = new Client({ token: process.env.QSTASH_TOKEN });

const messages = images.map((image, index) => ({
  destination: `${process.env.APP_URL}/api/internal/process-image`,
  body: JSON.stringify({ jobId, image, index }),
  headers: { "Content-Type": "application/json" }
}));

await qstash.batch(messages); // Single call to fan out everything


Step 2: Refactor the Worker (/api/internal/process-image)

Rename your process-batch route to process-image and simplify it to handle exactly one image.

TypeScript


export async function POST(req: Request) {
  const { jobId, image, index } = await req.json();
  
  // 1. Call Gemini for a single image
  const result = await generateNotesForSingleImage(image);
  
  // 2. Store result in Redis using the index as a key
  await redis.hset(`job:${jobId}:results`, { [index]: JSON.stringify(result) });
  
  // 3. Check if this was the last image to trigger finalization
  const completedCount = await redis.hincrby(`job:${jobId}`, "completed_images", 1);
  const totalImages = await redis.hget(`job:${jobId}`, "total_images");
  
  if (completedCount === Number(totalImages)) {
    await qstash.publishJSON({ url: `/api/jobs/${jobId}/finalize` });
  }
  
  return NextResponse.json({ success: true });
}


Step 3: Update Gemini Logic (lib/gemini.ts)

Remove the internal retry logic and set a strict timeout.

TypeScript


// lib/gemini.ts
export async function generateNotesForSingleImage(image: string) {
  return await withTimeout(
    geminiModel.generateContent([SYSTEM_PROMPT, image]),
    40000, // 40s timeout
    "Gemini timed out"
  );
}


3. Handling Parallel Results in Redis

Since images are processed in parallel, they will finish in a random order. Using a Redis Hash (HSET) with the image index as the field ensures that the results are stored correctly and can be reconstructed in the original order during the finalize step.

4. Documentation Requirements

•
Upstash QStash Batching: Use the /v2/batch endpoint to reduce overhead during fan-out 
.

•
Redis Atomic Increments: Use HINCRBY to safely track completion count across parallel functions 
.

