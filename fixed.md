# HandScript - Complete System Analysis and Error Handling Documentation

## Executive Summary

This document provides a comprehensive first-principles analysis of the HandScript codebase, identifying all failure points during Vercel deployment, and defining proper error handling strategies for every component.

---

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

### 1.2 Data Flow Sequence

```
1. User uploads PDF → Browser
2. PDF.js extracts pages → Canvas → PNG blobs
3. For each PNG:
   a. Client requests pre-signed URL from /api/get-upload-url
   b. Client uploads directly to B2 using pre-signed URL
4. Client calls /api/jobs with pageManifest (array of B2 keys)
5. Server creates job in Redis, publishes to QStash
6. QStash triggers /api/internal/process-batch (batch 0)
7. process-batch:
   a. Fetches 5 images per batch (BATCH_SIZE=5)
   b. Generates signed URLs for Gemini
   c. Calls Gemini AI with images
   d. Stores HTML results in Redis
   e. Publishes next batch to QStash (recursive)
   f. On final batch, publishes to /api/jobs/[id]/finalize
8. finalize:
   a. Fetches all page HTML from Redis
   b. Renders each page to PDF via Modal service
   c. Merges all PDFs using pdf-lib
   d. Uploads final PDF to B2
   e. Queues email delivery via QStash
9. send-email sends PDF link to user via Resend
```

---

## 2. Identified Failure Points and Root Causes

### 2.1 Vercel Function Timeout (10 second limit)

**Location:** All API routes, especially `/api/internal/process-batch` and `/api/jobs/[id]/finalize`

**Root Cause Analysis:**
- Vercel Hobby/Pro plans have a 10-60 second execution limit
- Gemini AI calls can take 5-30 seconds depending on image count
- PDF rendering via Modal can timeout
- Large batch sizes exceed timeout window

**Evidence from Workflow Logs:**
```
Jan 15 16:43:00.83 POST 200 /api/jobs - Started background processing for job kElgp_1L_gJBnTrucgOh5
```
(No subsequent logs showing batch completion = timeout occurred)

**Current Mitigation (Partial):**
- `BATCH_SIZE = 5` in process-batch/route.ts (line 49)
- Recursive QStash calls to chain batches

**Remaining Issues:**
- Single Gemini call with 5 images can still timeout
- No timeout handling in `generateBatchNotes()`
- Finalize route processes all pages in parallel without chunking

---

### 2.2 Gemini API Stalling/Hanging

**Location:** `lib/gemini.ts` - `generateBatchNotes()`

**Root Cause Analysis:**
1. **Model Version Incompatibility:** Code comment indicates "Gemini 2.0 does NOT support external URLs" but uses `gemini-2.5-flash`
2. **No Request Timeout:** The `generateContent()` call has no timeout wrapper
3. **fileUri vs inlineData:** Using `fileUri` for external URLs which requires specific model support
4. **Signed URL Expiration:** URLs are generated with 2-hour expiry, but may expire during retry queues

**Code Evidence (lib/gemini.ts:77-104):**
```typescript
export async function generateBatchNotes(signedUrls: string[]): Promise<BatchResponse> {
    try {
        const imageParts = signedUrls.map((url) => ({
            fileData: {
                fileUri: url,  // External URL approach
                mimeType: "image/png",
            },
        }));
        // NO TIMEOUT WRAPPER
        const result = await geminiModel.generateContent([...]);
```

**Failure Modes:**
- Gemini fails to fetch external URLs (network issues, expired signatures)
- Model rate limiting causes indefinite hanging
- Malformed response causes JSON parse failure

---

### 2.3 QStash Local Development Incompatibility

**Location:** `lib/queue.ts` - `publishToQStash()`

**Root Cause from Workflow:**
```
Error [QstashError]: {"error":"invalid destination url: endpoint resolves to a loopback address: ::1"}
```

**Analysis:**
- QStash cannot reach localhost/127.0.0.1 endpoints
- Current bypass only checks for explicit localhost strings
- IPv6 loopback `::1` not handled in some cases

**Code Evidence (lib/queue.ts:24):**
```typescript
const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1") || url.includes("::1");
```

**Issue:** The check happens AFTER constructing the URL, but VERCEL_URL might be undefined locally, causing the baseUrl to be "http://localhost:3000" which then gets passed to QStash in production mode.

---

### 2.4 Environment Variable Validation Failures

**Locations:** Multiple files with incomplete validation

**Critical Issues:**

1. **lib/redis.ts (lines 3-4):**
```typescript
if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('...');  // Throws at module load time - crashes build
}
```

2. **lib/gemini.ts (lines 5-7):**
```typescript
if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY must be defined');  // Build-time crash
}
```

3. **lib/queue.ts (lines 3-7):** Token validation is weak:
```typescript
if (!process.env.QSTASH_TOKEN) {
    // Empty block - allows undefined token
}
export const qstash = new Client({
    token: process.env.QSTASH_TOKEN || "mock_token",  // Silent fallback
});
```

4. **lib/s3.ts:** Uses non-null assertions without validation:
```typescript
accessKeyId: cleanToken(process.env.B2_KEY_ID)!,  // Will be undefined if missing
```

---

### 2.5 Redis Connection/Operation Failures

**Location:** All routes using `redis` from `lib/redis.ts`

**Failure Modes:**
1. Connection timeout to Upstash
2. Rate limiting (Upstash has per-second limits)
3. Key expiration during processing
4. MGET returning null for expected keys

**Evidence (app/api/jobs/[jobId]/finalize/route.ts:66-79):**
```typescript
let results: (string | null)[];
try {
    results = await redis.mget(keys);
} catch (e) {
    console.error(JSON.stringify({...}));
    return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 });
}
```

**Missing Handling:**
- No retry logic for transient Redis failures
- No circuit breaker pattern
- Status endpoint has no error handling for Redis failures

---

### 2.6 B2/S3 Pre-signed URL Issues

**Location:** `app/api/get-upload-url/route.ts`, `lib/s3.ts`

**Failure Modes:**
1. **Credential Expiration:** B2 application keys can expire
2. **URL Expiration:** Signed URLs expire in 1-2 hours
3. **Region Mismatch:** Endpoint configuration issues
4. **Bucket Permissions:** CORS, ACL, or policy misconfigurations

**Code Evidence (lib/s3.ts:5-9):**
```typescript
const cleanToken = (token: string | undefined) => {
    if (!token) return undefined;  // Returns undefined, then used with !
```

---

### 2.7 Modal PDF Rendering Service Failures

**Location:** `app/api/jobs/[jobId]/finalize/route.ts`

**Failure Modes:**
1. Modal service unavailable
2. Complex HTML causing rendering timeout
3. Large HTML content exceeding Modal limits
4. Network timeouts between Vercel and Modal

**Current Error Handling (lines 175-231):**
- Has fallback to simple HTML recovery
- Has ultimate fallback to blank PDF via pdf-lib
- But fallback chain can still fail completely

**Issues:**
- No timeout wrapper on Modal fetch
- MODAL_PDF_ENDPOINT not validated
- Recovery HTML could also fail to render

---

### 2.8 Email Delivery Failures

**Location:** `/api/send-email/route.ts`, `/api/send-error-email/route.ts`

**Failure Modes:**
1. Resend API key invalid or expired
2. Email address bounce/rejection
3. Rate limiting by Resend
4. QStash signature verification failure

**Current Handling:**
- Mocks email if RESEND_API_KEY missing
- Updates job status on failure
- Has production warning log

**Issues:**
- No retry mechanism for failed emails
- Job marked as complete before email confirmed sent
- Pre-signed URL in email expires in 24 hours (could expire before user opens)

---

### 2.9 PDF Assembly Failures

**Location:** `app/api/jobs/[jobId]/finalize/route.ts`

**Failure Modes:**
1. pdf-lib fails to parse corrupt/empty page PDFs
2. Memory exhaustion with large documents
3. Promise.all fails if ANY page fails

**Code Evidence (lines 262-270):**
```typescript
const mergedPdf = await PDFDocument.create();
for (const pdfBytes of pdfDocs) {
    const doc = await PDFDocument.load(pdfBytes);  // Can throw on corrupt PDF
    const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
}
```

**No try-catch around individual page loading** - one corrupt page kills entire merge.

---

### 2.10 Client-Side Failures

**Location:** `app/components/Upload.tsx`

**Failure Modes:**
1. PDF.js fails to parse corrupt PDF
2. Canvas rendering fails (memory, complex content)
3. Network failures during upload
4. Browser tab closed during processing

**Current Error Handling:**
```typescript
} catch (err: any) {
    console.error(err);
    onError(err.message || 'Failed to process PDF');
    setIsProcessing(false);
}
```

**Issues:**
- No progress persistence (refresh = restart)
- No upload retry on failure
- No batch upload failure recovery

---

## 3. Complete Environment Variables Audit

### 3.1 Required Variables

| Variable | Service | Validated? | Failure Mode |
|----------|---------|------------|--------------|
| `GEMINI_API_KEY` | Google AI | ✅ Build-time crash | App won't start |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis | ✅ Build-time crash | App won't start |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis | ✅ Build-time crash | App won't start |
| `QSTASH_TOKEN` | Upstash QStash | ⚠️ Soft fail | Silent mock_token |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash Verify | ⚠️ Skips verification | Security bypass in prod |
| `B2_ENDPOINT` | Backblaze B2 | ❌ No validation | Runtime crash on upload |
| `B2_REGION` | Backblaze B2 | ❌ No validation | Undefined passed to SDK |
| `B2_KEY_ID` | Backblaze B2 | ❌ Non-null assertion | Runtime undefined |
| `B2_APPLICATION_KEY` | Backblaze B2 | ❌ Non-null assertion | Runtime undefined |
| `B2_BUCKET_NAME` | Backblaze B2 | ❌ Non-null assertion | Runtime undefined |
| `RESEND_API_KEY` | Resend Email | ⚠️ Soft mock | Emails not sent |
| `EMAIL_FROM` | Resend | ⚠️ Fallback exists | Uses default sender |
| `MODAL_PDF_ENDPOINT` | Modal | ❌ No validation | Finalize fails |
| `VERCEL_URL` | Vercel | ⚠️ Fallback to localhost | QStash failures |
| `CRON_SECRET` | Cleanup Auth | ❌ No validation | Cron unauthorized |

### 3.2 Vercel Environment Configuration Issues

1. **VERCEL_URL** is auto-set by Vercel but may be the preview URL not production URL
2. **Build-time vs Runtime:** Some vars needed only at runtime but validated at build
3. **No .env.example** file documenting required variables

---

## 4. Comprehensive Error Handling Recommendations

### 4.1 Timeout Wrappers

```typescript
// RECOMMENDED: Add to lib/gemini.ts
async function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(errorMsg)), ms);
    });
    return Promise.race([promise, timeout]);
}

// Usage:
const result = await withTimeout(
    geminiModel.generateContent([...]),
    25000, // 25 second timeout
    'Gemini request timed out'
);
```

### 4.2 Retry Logic with Exponential Backoff

```typescript
// RECOMMENDED: Add to lib/utils.ts
async function withRetry<T>(
    fn: () => Promise<T>,
    options: { maxRetries: number; baseDelayMs: number; onRetry?: (attempt: number, error: Error) => void }
): Promise<T> {
    let lastError: Error;
    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            options.onRetry?.(attempt, lastError);
            if (attempt < options.maxRetries) {
                await new Promise(r => setTimeout(r, options.baseDelayMs * Math.pow(2, attempt - 1)));
            }
        }
    }
    throw lastError!;
}
```

### 4.3 Circuit Breaker Pattern

```typescript
// RECOMMENDED: For external service calls
class CircuitBreaker {
    private failures = 0;
    private lastFailure = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    
    constructor(
        private threshold: number = 5,
        private resetTimeMs: number = 30000
    ) {}
    
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailure > this.resetTimeMs) {
                this.state = 'half-open';
            } else {
                throw new Error('Circuit breaker is open');
            }
        }
        
        try {
            const result = await fn();
            this.failures = 0;
            this.state = 'closed';
            return result;
        } catch (error) {
            this.failures++;
            this.lastFailure = Date.now();
            if (this.failures >= this.threshold) {
                this.state = 'open';
            }
            throw error;
        }
    }
}
```

### 4.4 Graceful Degradation Strategy

For each failure point, define fallback behavior:

| Component | Primary | Fallback 1 | Fallback 2 | Ultimate |
|-----------|---------|------------|------------|----------|
| Gemini | Full transcription | Retry with smaller batch | OCR placeholder | "[Processing Failed]" |
| Modal PDF | Full render | Simple HTML render | pdf-lib blank page | Skip page |
| Email | Resend delivery | Log + persist URL | - | User polls status |
| Redis | Upstash | - | - | 500 error (critical) |
| B2 Upload | Pre-signed PUT | - | - | 500 error |

---

## 5. Specific Route Fixes

### 5.1 `/api/jobs/route.ts`

**Current Issues:**
- QStash failure doesn't fail the job
- No validation of pageManifest URLs
- Status returned before background processing verified

**Recommended Fixes:**
```typescript
// 1. Validate manifest entries
if (pageManifest.some(key => !key.startsWith('uploads/') && !key.startsWith('inputs/'))) {
    return NextResponse.json({ error: 'Invalid manifest keys' }, { status: 400 });
}

// 2. Mark job as 'queued' initially, not 'processing'
job.status = 'queued';

// 3. On QStash failure, mark job as failed
} catch (queueError) {
    job.status = 'queue_failed';
    job.error = 'Failed to start background processing';
    await redis.set(`job:${jobId}`, job);
    // Still return jobId so user can retry
}
```

### 5.2 `/api/internal/process-batch/route.ts`

**Current Issues:**
- No timeout on Gemini call
- Error doesn't include enough context
- Missing batch index validation

**Recommended Fixes:**
```typescript
// 1. Validate batch index
if (batchIndex < 0 || batchIndex > Math.ceil(manifest.length / BATCH_SIZE)) {
    return NextResponse.json({ error: 'Invalid batch index' }, { status: 400 });
}

// 2. Add timeout to Gemini call
try {
    batchResponse = await withTimeout(
        generateBatchNotes(signedUrls),
        25000,
        `Gemini timeout on batch ${batchIndex}`
    );
} catch (geminiError) {
    // Enhanced error logging with all context
}

// 3. Track failed pages individually
for (const [idx, html] of processedPages.entries()) {
    if (html.includes('[UNCLEAR')) {
        await redis.rpush(`job:${jobId}:failed`, start + idx);
    }
}
```

### 5.3 `/api/jobs/[jobId]/finalize/route.ts`

**Current Issues:**
- Promise.all for rendering (one failure = all fail)
- No timeout on Modal calls
- Async cleanup not awaited (could orphan files)

**Recommended Fixes:**
```typescript
// 1. Use Promise.allSettled instead of Promise.all
const renderResults = await Promise.allSettled(renderPromises);

// Separate successful and failed
const pdfDocs: Uint8Array[] = [];
const failedIndices: number[] = [];

renderResults.forEach((result, idx) => {
    if (result.status === 'fulfilled' && result.value.length > 0) {
        pdfDocs.push(result.value);
    } else {
        failedIndices.push(idx);
    }
});

// 2. Add timeout to Modal calls
const response = await withTimeout(
    fetch(modalEndpoint, {...}),
    30000,
    `Modal timeout on page ${i}`
);

// 3. Await cleanup before response
await cleanupInputFiles(job.pageManifest);
```

### 5.4 `/api/send-email/route.ts`

**Current Issues:**
- No retry on Resend failure
- Job updated after email sent (race condition)

**Recommended Fixes:**
```typescript
// 1. Retry logic
const { data, error } = await withRetry(
    () => resend.emails.send({...}),
    { maxRetries: 3, baseDelayMs: 1000 }
);

// 2. Atomic status update
await redis.set(`job:${jobId}`, {
    ...job,
    emailStatus: error ? 'failed' : 'sent',
    emailSentAt: error ? undefined : Date.now(),
    emailError: error?.message
});
```

---

## 6. Environment Variable Validation Module

**Recommended: Create `lib/env.ts`**

```typescript
import { z } from 'zod';

const envSchema = z.object({
    // Required at build time
    GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
    
    // Required at runtime
    UPSTASH_REDIS_REST_URL: z.string().url('Invalid Redis URL'),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    QSTASH_TOKEN: z.string().min(1).optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
    
    B2_ENDPOINT: z.string().min(1, 'B2_ENDPOINT is required'),
    B2_REGION: z.string().min(1),
    B2_KEY_ID: z.string().min(1),
    B2_APPLICATION_KEY: z.string().min(1),
    B2_BUCKET_NAME: z.string().min(1),
    
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),
    
    MODAL_PDF_ENDPOINT: z.string().url().optional(),
    
    VERCEL_URL: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
    if (cachedEnv) return cachedEnv;
    
    const result = envSchema.safeParse(process.env);
    
    if (!result.success) {
        console.error('Environment validation failed:');
        result.error.issues.forEach(issue => {
            console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
        });
        
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Invalid environment configuration');
        }
    }
    
    cachedEnv = result.data as Env;
    return cachedEnv;
}

// Export validated env
export const env = getEnv();
```

---

## 7. Logging and Observability Improvements

### 7.1 Structured Logging Standard

All log entries should follow this format:
```typescript
interface LogEntry {
    event: string;           // e.g., 'BatchProcessingStart', 'GeminiError'
    jobId?: string;
    batchIndex?: number;
    pageIndex?: number;
    timestamp: string;       // ISO format
    duration?: number;       // milliseconds
    error?: string;
    stack?: string;
    metadata?: Record<string, any>;
}

function log(entry: LogEntry) {
    console.log(JSON.stringify(entry));
}
```

### 7.2 Recommended Metrics to Track

1. **Latency Metrics:**
   - Job creation time
   - Per-batch Gemini processing time
   - Per-page Modal rendering time
   - Total job completion time

2. **Error Rates:**
   - Gemini failure rate per batch
   - Modal timeout rate
   - Email delivery failure rate
   - QStash publish failure rate

3. **Resource Metrics:**
   - Pages processed per job
   - Failed pages per job
   - Retry attempts per batch

---

## 8. Safe Connection Termination

### 8.1 Graceful Shutdown Handler

```typescript
// Recommended: Add to middleware or server initialization
const activeJobs = new Set<string>();

process.on('SIGTERM', async () => {
    console.log('SIGTERM received, graceful shutdown initiated');
    
    // Mark active jobs as interrupted
    for (const jobId of activeJobs) {
        try {
            const job = await redis.get(`job:${jobId}`);
            if (job && job.status === 'processing') {
                job.status = 'interrupted';
                job.error = 'Server shutdown during processing';
                await redis.set(`job:${jobId}`, job);
            }
        } catch (e) {
            console.error(`Failed to update job ${jobId} on shutdown`);
        }
    }
    
    process.exit(0);
});
```

### 8.2 Request Abort Handling

```typescript
// In API routes with long-running operations
export async function POST(request: Request) {
    const abortController = new AbortController();
    
    request.signal?.addEventListener('abort', () => {
        abortController.abort();
        // Cleanup logic here
    });
    
    try {
        const result = await fetchWithAbort(url, abortController.signal);
    } catch (error) {
        if (error.name === 'AbortError') {
            return NextResponse.json({ error: 'Request cancelled' }, { status: 499 });
        }
    }
}
```

---

## 9. Vercel-Specific Deployment Fixes

### 9.1 Function Configuration

Add to `vercel.json`:
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

### 9.2 Edge Runtime Consideration

For timeout-sensitive routes, consider Edge runtime:
```typescript
export const runtime = 'edge';  // Up to 30 seconds on Edge
```

**Note:** Edge has limitations (no Node.js APIs), so evaluate compatibility.

### 9.3 Cron Configuration

Add Vercel cron for cleanup:
```json
// vercel.json
{
    "crons": [
        {
            "path": "/api/cron/cleanup",
            "schedule": "0 * * * *"
        }
    ]
}
```

---

## 10. Testing Recommendations

### 10.1 Unit Tests Needed

- [ ] `lib/gemini.ts` - Mock Gemini responses, test timeout handling
- [ ] `lib/formatting.ts` - Test all content block types
- [ ] `lib/queue.ts` - Test localhost bypass, mock QStash
- [ ] `lib/s3.ts` - Mock S3 client, test error handling

### 10.2 Integration Tests Needed

- [ ] Full job creation → completion flow (happy path)
- [ ] Gemini failure → retry → success path
- [ ] Email delivery → confirmation path
- [ ] Cron cleanup execution

### 10.3 Chaos Testing

- [ ] Kill Gemini mid-request (simulate timeout)
- [ ] Return corrupt PDF from Modal
- [ ] Redis connection drops during processing
- [ ] B2 signature expires during processing

---

## 11. Summary of Critical Fixes

### Priority 1 (Blocking Deployment)

1. **Add timeout wrapper to Gemini calls** - Prevents indefinite hangs
2. **Create env validation module** - Prevents runtime crashes from missing vars
3. **Add vercel.json function configs** - Extends timeout limits

### Priority 2 (Reliability)

4. **Switch Promise.all to Promise.allSettled in finalize** - Prevents single-page failures from killing jobs
5. **Add retry logic to external service calls** - Handles transient failures
6. **Fix VERCEL_URL handling for production** - Ensures QStash targets correct URL

### Priority 3 (Observability)

7. **Standardize structured logging** - Enables debugging
8. **Add per-job logging to Redis** - Already partially implemented
9. **Track failure metrics** - Enables proactive monitoring

### Priority 4 (User Experience)

10. **Implement error notification emails** - Already exists, needs reliability
11. **Add job status recovery mechanism** - For interrupted jobs
12. **Persist client upload progress** - For browser refresh recovery

---

## Appendix A: File Reference

| File | Purpose | Critical Issues |
|------|---------|-----------------|
| `lib/gemini.ts` | Gemini AI integration | No timeout, model compatibility |
| `lib/redis.ts` | Redis client | Build-time crash on missing env |
| `lib/queue.ts` | QStash integration | Localhost bypass incomplete |
| `lib/s3.ts` | B2/S3 integration | No env validation |
| `lib/formatting.ts` | HTML generation | KaTeX errors not fully handled |
| `lib/html-template.ts` | PDF template | External CSS dependency |
| `app/api/jobs/route.ts` | Job creation | QStash failure handling |
| `app/api/internal/process-batch/route.ts` | Batch processing | Timeout, retry logic |
| `app/api/jobs/[jobId]/finalize/route.ts` | PDF assembly | Promise.all failure mode |
| `app/api/send-email/route.ts` | Email delivery | Retry logic |
| `app/components/Upload.tsx` | Client upload | No progress persistence |
| `app/components/Status.tsx` | Status polling | Email confirmation UX |

---

## Appendix B: Environment Template

Create `.env.example`:
```bash
# Required - Core Services
GEMINI_API_KEY=your_gemini_api_key
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_token

# Required - Backblaze B2
B2_ENDPOINT=s3.us-west-000.backblazeb2.com
B2_REGION=us-west-000
B2_KEY_ID=your_key_id
B2_APPLICATION_KEY=your_app_key
B2_BUCKET_NAME=your-bucket

# Required - QStash (for production)
QSTASH_TOKEN=your_qstash_token
QSTASH_CURRENT_SIGNING_KEY=your_signing_key

# Optional - Email
RESEND_API_KEY=re_your_key
EMAIL_FROM=HandScript <noreply@yourdomain.com>

# Optional - PDF Rendering
MODAL_PDF_ENDPOINT=https://your-modal-endpoint

# Optional - Cron
CRON_SECRET=your_secret_string

# Auto-set by Vercel (do not set manually)
# VERCEL_URL=your-app.vercel.app
```

---

*Document generated: January 15, 2026*
*Analysis covers HandScript codebase version as of commit with QStash integration*
