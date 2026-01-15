

## 1. System Architecture Overview

### 1.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
│  ┌────────────┐    ┌─────────────┐    ┌───────────────┐                     │
│  │ Upload.tsx │───▶│  PDF.js     │───▶│ Canvas→PNG   │                     │
│  │            │    │ (Worker)    │    │ Conversion   │                     │
│  └────────────┘    └─────────────┘    └───────┬───────┘                     │
└───────────────────────────────────────────────┼─────────────────────────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │           VERCEL SERVERLESS FUNCTIONS                 │
                    │                           ▼                           │
                    │  ┌──────────────────────────────────────────────────┐ │
                    │  │        /api/get-upload-url                       │ │
                    │  │   Generates B2 pre-signed upload URLs            │ │
                    │  └──────────────────────────────────────────────────┘ │
                    │                           │                           │
                    │                           ▼                           │
                    │  ┌──────────────────────────────────────────────────┐ │
                    │  │        /api/jobs (POST)                          │ │
                    │  │   Creates job in Redis, triggers QStash          │ │
                    │  └──────────────────────────────────────────────────┘ │
                    │                           │                           │
                    │                    ┌──────┴──────┐                    │
                    │                    ▼             ▼                    │
                    │  ┌─────────────────────┐  ┌─────────────────────────┐ │
                    │  │ /api/internal/      │  │ /api/jobs/[id]/status   │ │
                    │  │ process-batch       │  │ (polling endpoint)      │ │
                    │  │ (QStash triggered)  │  └─────────────────────────┘ │
                    │  └─────────┬───────────┘                              │
                    │            │ (recursive batches)                      │
                    │            ▼                                          │
                    │  ┌──────────────────────────────────────────────────┐ │
                    │  │        /api/jobs/[id]/finalize                   │ │
                    │  │   Renders HTML→PDF, merges, uploads, emails      │ │
                    │  └──────────────────────────────────────────────────┘ │
                    │            │                                          │
                    │            ▼                                          │
                    │  ┌──────────────────────────────────────────────────┐ │
                    │  │ /api/send-email OR /api/send-error-email         │ │
                    │  │ (QStash triggered, Resend integration)           │ │
                    │  └──────────────────────────────────────────────────┘ │
                    └───────────────────────────────────────────────────────┘
                                                │
        ┌───────────────────────────────────────┼───────────────────────────┐
        │                    EXTERNAL SERVICES                              │
        │                                       ▼                           │
        │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
        │  │ Backblaze B2 │  │ Upstash Redis│  │ Upstash      │            │
        │  │ (S3-compat)  │  │              │  │ QStash       │            │
        │  └──────────────┘  └──────────────┘  └──────────────┘            │
        │                                       │                           │
        │  ┌──────────────┐  ┌──────────────┐  │                           │
        │  │ Google       │  │ Resend       │◀─┘                           │
        │  │ Gemini AI    │  │ (Email)      │                              │
        │  └──────────────┘  └──────────────┘                              │
        │                                                                   │
        │  ┌──────────────┐                                                │
        │  │ Modal.com    │ (External PDF rendering service)               │
        │  │ PDF Service  │                                                │
        │  └──────────────┘                                                │
        └───────────────────────────────────────────────────────────────────┘
```

---

## 2. Critical Issue: Vercel Function Timeout vs Gemini Processing Time

### 2.1 Problem Statement

**The Core Issue:**
- Vercel Hobby plan has a **hard 60-second timeout** for serverless functions
- The internal Gemini request timeout in `lib/gemini.ts` was set to **50 seconds** (previously 120s)
- If Gemini processing takes **longer than 60 seconds**, Vercel **abruptly kills** the function
- This results in "no response" with **no error logs** because the process dies instantly before any catch block executes

**Current Configuration (`vercel.json`):**
```json
{
    "functions": {
        "app/api/internal/process-batch/route.ts": { "maxDuration": 60 },
        "app/api/jobs/[jobId]/finalize/route.ts": { "maxDuration": 60 }
    }
}
```

**Current Timeout (`lib/gemini.ts` line 102):**
```typescript
withTimeout(geminiModel.generateContent([...]), 50000, "Gemini request timed out")
```

### 2.2 Root Cause Analysis

The architecture has a **timeout hierarchy problem**:

```
┌─────────────────────────────────────────────────────────────────┐
│  Vercel Platform (60s hard limit - cannot be changed on Hobby) │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  QStash → process-batch (60s maxDuration)                 │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  withRetry (3 attempts × exponential backoff)       │  │  │
│  │  │  ┌──────────────────────────────────────────────┐  │  │  │
│  │  │  │  withTimeout(50000ms) → Gemini API call      │  │  │  │
│  │  │  │  (PROBLEM: If this takes >60s, Vercel kills) │  │  │  │
│  │  │  └──────────────────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Why the current 50s timeout still fails:**
1. `withRetry` with 3 retries and exponential backoff adds overhead
2. Network latency, signed URL generation, and other processing adds time
3. If first attempt times out at 50s, retry at 51s → Vercel kills at 60s before retry completes
4. Total worst-case: 50s + 1s delay + start of retry = >60s = **silent death**

---

## 3. Proposed Solutions (Free Tier Compatible)

### 3.1 Solution A: Aggressive Timeout Reduction (Recommended - Quick Fix)

**Strategy:** Reduce all internal timeouts to leave a safe buffer before Vercel's 60s limit.

**Changes Required:**

| Component | Current | Proposed | Rationale |
|-----------|---------|----------|-----------|
| `lib/gemini.ts` Gemini timeout | 50s | **25s** | Allow 2 retries within 60s |
| `lib/gemini.ts` Max retries | 3 | **2** | 25s × 2 = 50s + overhead |
| `finalize/route.ts` Modal timeout | 30s | **20s** | Buffer for PDF merge |
| `finalize/route.ts` Modal retries | 3 | **2** | Faster failure |

**Implementation:**

```typescript
// lib/gemini.ts - Line 96-110
const result = await withRetry(
    () => withTimeout(
        geminiModel.generateContent([SYSTEM_PROMPT, ...imageParts]),
        25000,  // REDUCED: 25s timeout (was 50s)
        "Gemini request timed out"
    ),
    {
        maxRetries: 2,  // REDUCED: 2 retries (was 3)
        baseDelayMs: 500,  // REDUCED: faster retry (was 1000)
        onRetry: (attempt, err) => console.warn(`[Gemini] Retry ${attempt}: ${err.message}`)
    }
);
```

**Timeout Budget Analysis:**
```
Attempt 1: 0s  → 25s  (timeout or success)
Delay:     25s → 25.5s (500ms)
Attempt 2: 25.5s → 50.5s (timeout or success)
Buffer:    50.5s → 60s (9.5s for cleanup/logging/response)
```

**Pros:** Simple, no new services, no code restructuring
**Cons:** May reject legitimate slow Gemini responses; doesn't fundamentally solve the limit

---

### 3.2 Solution B: Reduce Batch Size (Recommended - Systemic Fix)

**Strategy:** Process fewer images per Gemini call to reduce processing time.

**Current State:**
- `BATCH_SIZE = 3` images per Gemini call
- Complex handwritten notes with diagrams can take 30-60s for 3 images

**Proposed Change:**
```typescript
// app/api/internal/process-batch/route.ts - Line 44-45
const BATCH_SIZE = 2;  // REDUCED from 3
// For very complex documents, consider BATCH_SIZE = 1
```

**Impact Analysis:**
| Batch Size | Gemini Calls (30 pages) | Est. Time/Call | Total Time |
|------------|-------------------------|----------------|------------|
| 3 (current) | 10 | 20-45s | 200-450s |
| 2 (proposed) | 15 | 12-25s | 180-375s |
| 1 (safest) | 30 | 8-15s | 240-450s |

**Pros:** Naturally keeps each call under timeout; more granular progress
**Cons:** More QStash messages (still within free tier of 500/day)

---

### 3.3 Solution C: QStash Retry Delegation (Safest - Leverages Existing Infrastructure)

**Strategy:** Let QStash handle retries instead of internal `withRetry`, and reduce internal timeout to fail fast.

**Rationale:** QStash already retries failed requests (configured as `retries: 3` in `lib/queue.ts`). If Vercel times out at 60s, QStash sees `504` and retries. The problem is: we're doing **double retrying**.

**Implementation:**

```typescript
// lib/gemini.ts - Remove internal retry, fail fast
export async function generateBatchNotes(signedUrls: string[]): Promise<BatchResponse> {
    // NO withRetry wrapper - let QStash handle retries
    const result = await withTimeout(
        geminiModel.generateContent([SYSTEM_PROMPT, ...imageParts]),
        45000,  // 45s timeout - leaves 15s buffer for function overhead
        "Gemini request timed out"
    );
    
    // ... rest of processing
}
```

```typescript
// lib/queue.ts - Ensure QStash retries are configured
await qstash.publishJSON({
    url,
    body,
    retries: 3,  // QStash will retry on 5xx errors
    delay: "5s", // Optional: add delay between retries
});
```

**How it works:**
1. Gemini call starts → if slow, times out at 45s
2. Function returns 500 error (or Vercel kills at 60s → 504)
3. QStash sees 5xx → waits → retries the entire batch
4. Next attempt may succeed (transient Gemini slowness)

**Pros:** Eliminates double-retry overhead; fail-fast behavior; cleaner code
**Cons:** Full batch re-processing on retry (no partial progress within batch)

---

### 3.4 Solution D: Streaming Response (Advanced - For Future)

**Strategy:** Use Vercel's streaming response capability to keep the connection alive.

**Concept:** If we start streaming a response within 30s, Vercel allows the connection to continue indefinitely (Edge Functions) or extended duration (streaming Node.js).

**Limitations for this use case:**
- Gemini's `generateContent` is NOT natively streamable with structured JSON output
- Would require migrating to `generateContentStream` + post-processing
- Complex architectural change

**Not recommended for immediate fix**, but viable for future optimization.

---

### 3.5 Solution E: Pre-flight Timeout Estimation

**Strategy:** Estimate batch complexity and adjust timeout/batch-size dynamically.

**Implementation Concept:**
```typescript
async function handler(request: NextRequest) {
    const { manifest, batchIndex } = processBatchSchema.parse(await request.json());
    
    const batchSize = calculateDynamicBatchSize(manifest.length);
    const timeout = estimateTimeout(batchSize);
    
    if (timeout > 50000) {
        // Split this batch further
        return splitAndRequeue(jobId, batchIndex, manifest);
    }
    
    // Proceed with adjusted batch
}
```

**Pros:** Adaptive to content complexity
**Cons:** Adds complexity; estimation may be inaccurate

---

## 4. Recommended Implementation Order

### Priority 1: Immediate Fix (Deploy Today)

1. **Reduce Gemini timeout** in `lib/gemini.ts`:
   - `withTimeout`: 50000 → 25000
   - `maxRetries`: 3 → 2
   - `baseDelayMs`: 1000 → 500

2. **Reduce batch size** in `app/api/internal/process-batch/route.ts`:
   - `BATCH_SIZE`: 3 → 2

### Priority 2: Structural Improvement (This Week)

3. **Remove internal retry from Gemini**, delegate to QStash:
   - Simplify `lib/gemini.ts` to single attempt with 45s timeout
   - Ensure QStash retries are working correctly

### Priority 3: Monitoring (Ongoing)

4. **Add timeout tracking metrics**:
   ```typescript
   // lib/gemini.ts
   const startTime = Date.now();
   try {
       const result = await withTimeout(...);
       await metrics.recordLatency("gemini_success_latency", Date.now() - startTime);
   } catch (error) {
       await metrics.recordLatency("gemini_failure_latency", Date.now() - startTime);
       await metrics.increment("gemini_timeout_errors");
       throw error;
   }
   ```

---

## 5. Verification Plan

### After Implementation:

1. **Test with known slow document** (complex diagrams, many pages)
2. **Monitor Vercel logs** for 504 errors (should disappear)
3. **Check Redis logs** for proper error messages (should see "Gemini timed out" instead of silence)
4. **Verify QStash retry behavior** in Upstash dashboard

### Success Criteria:

- [ ] No silent failures (all errors are logged)
- [ ] Jobs either complete or fail with proper error notification
- [ ] Average batch processing time <40s
- [ ] QStash retry rate <10%

---

## 6. Services Used (All Free Tier)

| Service | Free Tier Limit | Current Usage | Post-Fix Impact |
|---------|-----------------|---------------|-----------------|
| Vercel Hobby | 60s function timeout | At limit | No change (working within limit) |
| QStash | 500 msg/day | ~50-100/job | May increase slightly with smaller batches |
| Upstash Redis | 10K commands/day | ~200/job | No change |
| Gemini 2.5 Flash | 1000 RPM | ~10-30/job | May increase with smaller batches |
| Modal.com | $30/month free | ~30 renders/job | No change |
| Backblaze B2 | 10GB free | <1GB/job | No change |

**All solutions remain within free tier limits.**

Instead of processing a batch of 3 images in one Vercel function, process exactly 1 image per function call.

•
How it works: The /api/jobs endpoint splits the PDF into $N$ images and triggers $N$ QStash messages, one for each image.

•
Benefits:

•
Each call is extremely fast (well under 60s).

•
Maximum parallelism (QStash can trigger many Vercel functions at once).

•
Granular retries: If one image fails, only that image is retried.



•
Constraint Check: QStash Free Tier allows 500 messages/day. If a job has 50 pages, one job consumes 10% of the daily limit.

