# Cron Jobs Solution for Vercel Hobby Plan

## Problem

Your current `vercel.json` defines 2 cron jobs:
```json
"crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 * * * *" },      // Hourly
    { "path": "/api/cron/recovery", "schedule": "*/30 * * * *" }   // Every 30 min
]
```

**Vercel Hobby Plan Limitations:**
- Maximum 2 cron jobs per account
- Crons can only trigger **once per day** (not hourly/30-min)
- Execution time is imprecise (can be delayed up to 59 minutes)

This causes deployment to fail or crons to not work as expected.

---

## Solution: Remove Crons, Use Event-Driven Cleanup

Instead of relying on scheduled crons, integrate cleanup into the existing workflow using:
1. **Inline cleanup after job completion** (in finalize route)
2. **QStash scheduled cleanup** (uses QStash free tier, not Vercel crons)
3. **B2 Lifecycle Rules** (automatic S3-level cleanup - zero code)

---

## Implementation Details

### Option 1: Remove Crons Entirely (Recommended for Free Tier)

#### Step 1: Update vercel.json

Remove or comment out the crons section:

```json
{
    "functions": {
        "app/api/internal/process-batch/route.ts": {
            "maxDuration": 60
        },
        "app/api/jobs/[jobId]/finalize/route.ts": {
            "maxDuration": 60
        }
    }
}
```

#### Step 2: Enhanced Inline Cleanup in Finalize Route

The finalize route already deletes input images after success. Extend this to be more robust:

**File: `app/api/jobs/[jobId]/finalize/route.ts`**

Add this cleanup logic (currently partially exists):

```typescript
// After successful PDF upload and job completion
// Cleanup input images immediately
async function cleanupJobFiles(jobId: string, pageManifest: string[]) {
    try {
        // Delete all input images
        if (pageManifest && pageManifest.length > 0) {
            await deleteFile(pageManifest);
            console.log(JSON.stringify({
                event: 'InputCleanup',
                jobId,
                count: pageManifest.length,
                timestamp: new Date().toISOString()
            }));
        }
        
        // Delete page cache from Redis
        const pageKeys = Array.from(
            { length: pageManifest.length }, 
            (_, i) => `job:${jobId}:page:${i}`
        );
        await redis.del(...pageKeys);
        await redis.del(`job:${jobId}:completed`);
        await redis.del(`job:${jobId}:logs`);
        
    } catch (cleanupError) {
        // Log but don't fail the job
        console.error(JSON.stringify({
            event: 'CleanupError',
            jobId,
            error: String(cleanupError),
            timestamp: new Date().toISOString()
        }));
    }
}
```

Call this at the end of the finalize route:
```typescript
// Before returning success
await cleanupJobFiles(jobId, job.pageManifest);
```

#### Step 3: Inline Stale Job Recovery

Instead of a cron for recovery, check for stale jobs when creating new ones:

**File: `app/api/jobs/route.ts`**

Add opportunistic recovery:

```typescript
// At the start of POST handler, before creating new job
async function opportunisticRecovery() {
    try {
        // Only run 10% of the time to avoid overhead
        if (Math.random() > 0.1) return;
        
        const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
        const now = Date.now();
        
        // Scan for a small batch of potentially stale jobs
        const [, keys] = await redis.scan('0', { match: 'job:*', count: 20 });
        
        for (const key of keys) {
            if (key.includes(':logs') || key.includes(':page:') || key.includes(':completed')) continue;
            
            const job: any = await redis.get(key);
            if (!job || typeof job !== 'object') continue;
            
            const isStale = (job.status === 'processing' || job.status === 'assembling') &&
                (now - job.updatedAt > STALE_THRESHOLD_MS);
            
            if (isStale) {
                job.status = 'failed';
                job.error = 'Job timed out after 2 hours of inactivity.';
                job.updatedAt = now;
                await redis.set(key, job);
            }
        }
    } catch (e) {
        // Silent fail - this is opportunistic
        console.error('Opportunistic recovery failed:', e);
    }
}
```

Call at the start of job creation:
```typescript
export async function POST(request: Request) {
    // Opportunistic cleanup (non-blocking)
    opportunisticRecovery().catch(() => {});
    
    // ... rest of job creation
}
```

---

### Option 2: Use QStash Scheduled Messages (Free Tier Compatible)

QStash has a free tier with 500 messages/day. Use it for scheduled cleanup:

#### Step 1: Create QStash-Triggered Cleanup Endpoint

Keep the cleanup route but make it QStash-triggered instead of Vercel cron:

**File: `app/api/internal/scheduled-cleanup/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { listFiles, deleteFile } from "@/lib/s3";
import { redis } from "@/lib/redis";
import { publishToQStash } from "@/lib/queue";

async function handler(request: NextRequest) {
    try {
        // Cleanup old B2 files
        const { blobs } = await listFiles({ limit: 500 });
        const now = Date.now();
        const RETENTION_MS = 60 * 60 * 1000; // 1 hour

        const toDelete: string[] = [];
        for (const blob of blobs) {
            const isInput = blob.pathname.startsWith('inputs/') || blob.pathname.startsWith('uploads/');
            const isOutput = blob.pathname.startsWith('outputs/');

            if (isInput || isOutput) {
                const age = now - new Date(blob.uploadedAt).getTime();
                if (age > RETENTION_MS) {
                    toDelete.push(blob.pathname);
                }
            }
        }

        if (toDelete.length > 0) {
            await deleteFile(toDelete);
        }

        // Recover stale jobs
        let recoveredCount = 0;
        const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
        let cursor = '0';

        do {
            const [nextCursor, keys] = await redis.scan(cursor, { match: 'job:*', count: 100 });
            cursor = nextCursor;

            for (const key of keys) {
                if (key.includes(':logs') || key.includes(':page:') || key.includes(':completed')) continue;

                const job: any = await redis.get(key);
                if (!job || typeof job !== 'object') continue;

                const isStale = (job.status === 'processing' || job.status === 'assembling') &&
                    (now - job.updatedAt > STALE_THRESHOLD_MS);

                if (isStale) {
                    job.status = 'failed';
                    job.error = 'Job timed out after 2 hours.';
                    job.updatedAt = now;
                    await redis.set(key, job);
                    recoveredCount++;
                }
            }
        } while (cursor !== '0');

        // Schedule next run (self-scheduling)
        const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000";

        await publishToQStash(`${baseUrl}/api/internal/scheduled-cleanup`, {
            scheduledAt: Date.now()
        }, {
            delay: 3600 // 1 hour delay
        });

        return NextResponse.json({
            success: true,
            deletedCount: toDelete.length,
            recoveredCount
        });

    } catch (error: any) {
        console.error('Scheduled cleanup failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

let POST_HANDLER: any = handler;
if (process.env.NODE_ENV === 'production' && process.env.QSTASH_CURRENT_SIGNING_KEY) {
    POST_HANDLER = verifySignatureAppRouter(handler);
}

export const POST = POST_HANDLER;
```

#### Step 2: Update lib/queue.ts to Support Delay

```typescript
export async function publishToQStash(url: string, body: any, options?: { delay?: number }) {
    const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1") || url.includes("::1");

    if (isLocalhost) {
        console.log(`[Queue] Localhost detected, bypassing QStash for: ${url}`);
        fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }).catch(err => console.error(`[Queue] Local dispatch failed for ${url}:`, err));

        return { messageId: "local-dev-mock-id" };
    }

    if (!process.env.QSTASH_TOKEN) {
        console.warn("[Queue] QSTASH_TOKEN missing, skipping publish.");
        return { messageId: "skipped-no-token" };
    }

    const result = await qstash.publishJSON({
        url,
        body,
        retries: 3,
        delay: options?.delay, // Add delay support
    });
    
    return result;
}
```

#### Step 3: Bootstrap the Scheduled Cleanup

On first deployment, manually trigger the chain by calling the endpoint once. It will self-schedule after that.

Add a bootstrap endpoint:

**File: `app/api/internal/bootstrap-cleanup/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { publishToQStash } from "@/lib/queue";

export async function POST(request: NextRequest) {
    // Simple auth check
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

    try {
        const result = await publishToQStash(`${baseUrl}/api/internal/scheduled-cleanup`, {
            bootstrapped: true,
            startedAt: Date.now()
        });

        return NextResponse.json({
            success: true,
            messageId: result.messageId,
            message: 'Cleanup chain started'
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
```

---

### Option 3: Use B2 Lifecycle Rules (Zero Code - Recommended)

Backblaze B2 supports lifecycle rules that automatically delete old files. This requires no code changes.

#### Step 1: Configure B2 Lifecycle Rule

In Backblaze B2 console:

1. Go to your bucket settings
2. Navigate to "Lifecycle Settings"
3. Add rules:

```
Rule 1: Delete files in inputs/ after 1 day
- Prefix: inputs/
- Days after upload: 1
- Action: Delete

Rule 2: Delete files in uploads/ after 1 day
- Prefix: uploads/
- Days after upload: 1
- Action: Delete

Rule 3: Delete files in outputs/ after 7 days
- Prefix: outputs/
- Days after upload: 7
- Action: Delete
```

#### Step 2: Remove Cron from vercel.json

```json
{
    "functions": {
        "app/api/internal/process-batch/route.ts": {
            "maxDuration": 60
        },
        "app/api/jobs/[jobId]/finalize/route.ts": {
            "maxDuration": 60
        }
    }
}
```

#### Step 3: Optional - Keep Manual Cleanup Endpoint

Keep the cleanup route for manual invocation if needed, but remove from crons:

```typescript
// Can be triggered manually via:
// curl -X GET https://yourapp.vercel.app/api/cron/cleanup \
//   -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## Recommended Implementation Order

### For Immediate Deployment (Minimal Changes)

1. **Remove crons from vercel.json** (required to deploy)
2. **Configure B2 lifecycle rules** (handles file cleanup automatically)
3. **Add inline cleanup to finalize route** (immediate cleanup after job)

### Files to Modify

**1. vercel.json** - Remove crons section:
```json
{
    "functions": {
        "app/api/internal/process-batch/route.ts": {
            "maxDuration": 60
        },
        "app/api/jobs/[jobId]/finalize/route.ts": {
            "maxDuration": 60
        }
    }
}
```

**2. app/api/jobs/[jobId]/finalize/route.ts** - Already has cleanup, ensure it runs:
```typescript
// Line ~318-338 already has async cleanup
// Make it synchronous before response:

// Replace the async IIFE with:
try {
    const inputFiles = job.pageManifest;
    if (inputFiles && inputFiles.length > 0) {
        await deleteFile(inputFiles);
        console.log(JSON.stringify({
            event: 'InputCleanup',
            jobId,
            count: inputFiles.length,
            timestamp: new Date().toISOString()
        }));
    }
} catch (cleanupError) {
    console.error(JSON.stringify({
        event: 'InputCleanupFailed',
        jobId,
        error: String(cleanupError),
        timestamp: new Date().toISOString()
    }));
}
```

**3. Optionally delete or keep cron routes** - They can stay for manual use:
- `app/api/cron/cleanup/route.ts` - Keep for manual cleanup
- `app/api/cron/recovery/route.ts` - Keep for manual recovery

---

## Comparison Table

| Approach | Cost | Frequency | Reliability | Complexity |
|----------|------|-----------|-------------|------------|
| **Vercel Crons (Hobby)** | Free | Once/day only | Low | Low |
| **Inline Cleanup** | Free | On every job | High | Low |
| **QStash Scheduled** | Free (500/day) | Any interval | High | Medium |
| **B2 Lifecycle Rules** | Free | Daily | Very High | Zero |
| **Opportunistic Recovery** | Free | Probabilistic | Medium | Low |

---

## Final Recommendation

**For Vercel Hobby + Free Tier:**

1. ✅ Remove crons from `vercel.json`
2. ✅ Configure B2 lifecycle rules (1 day for inputs, 7 days for outputs)
3. ✅ Keep inline cleanup in finalize route (already exists)
4. ✅ Add opportunistic recovery in job creation route
5. ✅ Keep cron endpoints for manual invocation when needed

This approach:
- Costs $0
- Works on Vercel Hobby
- Handles cleanup automatically via B2
- Recovers stale jobs opportunistically
- Requires minimal code changes

---

## Quick Fix Commands

```bash
# 1. Remove crons from vercel.json
# Edit the file to remove the "crons" array

# 2. Commit and push
git add vercel.json
git commit -m "fix: remove crons for Vercel Hobby compatibility"
git push

# 3. Configure B2 lifecycle in Backblaze console (manual step)

# 4. Test deployment
# Verify build succeeds without cron errors
```

---

*Document created: January 15, 2026*
*Based on Vercel Hobby plan limitations and current HandScript architecture*
