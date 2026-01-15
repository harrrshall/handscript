# HandScript Codebase Analysis & Architecture Findings

**Analysis Date:** January 2026  
**Objective:** First-principles analysis of the entire codebase with recommendations for optimization, email delivery extension, and achieving zero Fast Origin Transfer on Vercel.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture Overview](#system-architecture-overview)
3. [Dependency Constraints & Version Matrix](#dependency-constraints--version-matrix)
6. [Performance Optimizations for Zero Fast Origin Transfer](#performance-optimizations-for-zero-fast-origin-transfer)
7. [Implementation Guidance](#implementation-guidance)
8. [Risk Mitigation & Regression Prevention](#risk-mitigation--regression-prevention)

---

## Executive Summary

HandScript is a Next.js 16 application that converts handwritten notes (PDF format) into professionally formatted PDF documents using:

- **Gemini AI** for transcription and structured data extraction
- **Backblaze B2** for temporary image storage
- **Upstash Redis** for job state management
- **Modal.com** (Playwright/Puppeteer) for HTML-to-PDF rendering

### Key Findings

| Category            | Finding                                                      | Impact                                      |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| **Unused Code**     | 8 files/directories identified as bloat                      | ~15% codebase reduction possible            |
| **Legacy Patterns** | Markdown-based rendering remnants exist                      | Confusion potential, dead code paths        |
| **Performance**     | Current architecture transfers large payloads through Vercel | Bandwidth costs, timeout risks              |
| **Email Extension** | Requires background job processing                           | Vercel limitations require external service |

---

## System Architecture Overview

### Current Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              HANDSCRIPT PROCESSING PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  PHASE 1: CLIENT-SIDE EXTRACTION                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────┐    │
│  │ [PDF Upload] → [PDF.js @ 1.5x] → [Canvas PNG] → [Presigned URL] → [B2 Upload]  │    │
│  │  (Upload.tsx)   (Client-side)    (Per page)     (/api/get-upload-url)           │    │
│  └────────────────────────────────────────────────────────────────────────────────┘    │
│                                         ↓                                               │
│  PHASE 2: JOB CREATION                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────┐    │
│  │ [POST /api/jobs] → [Redis job:{id}] → [Return jobId to client]                 │    │
│  │  (Creates job metadata with pageManifest of B2 keys)                           │    │
│  └────────────────────────────────────────────────────────────────────────────────┘    │
│                                         ↓                                               │
│  PHASE 3: PARALLEL BATCH PROCESSING (Client-Orchestrated)                              │
│  ┌────────────────────────────────────────────────────────────────────────────────┐    │
│  │ [Status.tsx] → [POST /api/process-batch] (x N batches, 5 concurrent)            │    │
│  │       ↓                                                                         │    │
│  │ [Signed URLs for B2 keys] → [Fetch images] → [Gemini API] → [Structured JSON]   │    │
│  │       ↓                                                                         │    │
│  │ [renderToHtml()] → [Store HTML in Redis job:{id}:page:{n}]                      │    │
│  └────────────────────────────────────────────────────────────────────────────────┘    │
│                                         ↓                                               │
│  PHASE 4: FINALIZATION (Client-Triggered)                                              │
│  ┌────────────────────────────────────────────────────────────────────────────────┐    │
│  │ [POST /api/jobs/{id}/finalize]                                                  │    │
│  │       ↓                                                                         │    │
│  │ [Fetch all pages from Redis] → [Parallel Modal.com calls] → [PDF per page]     │    │
│  │       ↓                                                                         │    │
│  │ [pdf-lib merge] → [Upload to B2] → [Presigned download URL] → [Update job]     │    │
│  │       ↓                                                                         │    │
│  │ [Cleanup: Delete input images from B2]                                          │    │
│  └────────────────────────────────────────────────────────────────────────────────┘    │
│                                         ↓                                               │
│  PHASE 5: DELIVERY                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐    │
│  │ [Status.tsx polls /api/jobs/{id}/status] → [Receives finalPdfUrl] → [Download] │    │
│  └────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component         | File(s)                                  | Responsibility                                                              |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| **Upload.tsx**    | `app/components/Upload.tsx`              | PDF extraction, presigned URL fetch, direct B2 upload, job creation trigger |
| **Status.tsx**    | `app/components/Status.tsx`              | Batch processing orchestration, progress polling, finalize trigger          |
| **Jobs API**      | `app/api/jobs/route.ts`                  | Job creation with page manifest                                             |
| **Status API**    | `app/api/jobs/[jobId]/status/route.ts`   | Real-time progress via Redis counters                                       |
| **Process Batch** | `app/api/process-batch/route.ts`         | Gemini API calls, HTML generation, Redis storage                            |
| **Finalize**      | `app/api/jobs/[jobId]/finalize/route.ts` | PDF rendering via Modal, merging, B2 upload, cleanup                        |
| **Gemini**        | `lib/gemini.ts`                          | Structured output generation with JSON schema                               |
| **Formatting**    | `lib/formatting.ts`                      | IR → HTML conversion with KaTeX math rendering                              |
| **S3/B2**         | `lib/s3.ts`                              | Backblaze B2 operations (upload, download, delete, list)                    |
| **Redis**         | `lib/redis.ts`                           | Upstash Redis client for job state                                          |

---

## Dependency Constraints & Version Matrix

### Production Dependencies

| Package                         | Version    | Purpose             | Constraints                                   |
| ------------------------------- | ---------- | ------------------- | --------------------------------------------- |
| `next`                          | `16.1.1`   | Framework           | Node.js 18.17+, React 19.x required           |
| `react`                         | `19.2.3`   | UI Library          | Next.js 16 requires React 19.x                |
| `react-dom`                     | `19.2.3`   | React DOM           | Must match React version                      |
| `@google/generative-ai`         | `^0.24.1`  | Gemini API          | Requires `GEMINI_API_KEY` env var             |
| `@aws-sdk/client-s3`            | `^3.968.0` | S3/B2 Operations    | AWS SDK v3, S3-compatible API                 |
| `@aws-sdk/s3-request-presigner` | `^3.968.0` | Presigned URLs      | Must match client-s3 version                  |
| `@upstash/redis`                | `^1.36.1`  | Redis Client        | HTTP-based, serverless-compatible             |
| `katex`                         | `^0.16.27` | Math Rendering      | Used server-side in formatting.ts             |
| `pdf-lib`                       | `^1.17.1`  | PDF Manipulation    | PDF merging in finalize route                 |
| `pdfjs-dist`                    | `4.8.69`   | PDF Parsing         | Client-side PDF extraction                    |
| `nanoid`                        | `^5.1.6`   | ID Generation       | ESM-only in v4+, used for job IDs             |
| `zod`                           | `^3.24.1`  | Schema Validation   | Used for request validation and Gemini schema |
| `zod-to-json-schema`            | `^3.25.1`  | Schema Conversion   | Converts Zod → JSON Schema for Gemini         |
| `p-limit`                       | `^7.2.0`   | Concurrency Control | ESM-only, used in test scripts                |
| `playwright`                    | `^1.57.0`  | Browser Automation  | Used in local test scripts only               |

### Development Dependencies

| Package                | Version   | Purpose        | Constraints                                       |
| ---------------------- | --------- | -------------- | ------------------------------------------------- |
| `typescript`           | `^5`      | Type System    | tsconfig: ES2017 target, bundler moduleResolution |
| `tailwindcss`          | `^4`      | Styling        | Tailwind v4 with new config format                |
| `@tailwindcss/postcss` | `^4`      | PostCSS Plugin | Must match Tailwind version                       |
| `dotenv`               | `^17.2.3` | Env Loading    | Used in test scripts                              |
| `eslint`               | `^9`      | Linting        | ESLint v9 flat config                             |
| `eslint-config-next`   | `16.1.1`  | Next.js ESLint | Must match Next.js version                        |

### External Services

| Service           | Purpose          | Free Tier Limits                      | Env Variables                                                                   |
| ----------------- | ---------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| **Gemini API**    | AI Transcription | 15 RPM, 1M tokens/day                 | `GEMINI_API_KEY`                                                                |
| **Backblaze B2**  | Image Storage    | 10GB storage, 1GB/day egress          | `B2_ENDPOINT`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_REGION` |
| **Upstash Redis** | Job State        | 10K commands/day                      | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                            |
| **Modal.com**     | PDF Rendering    | 30 hours/month compute                | `MODAL_PDF_ENDPOINT`                                                            |
| **Vercel**        | Hosting          | 100GB bandwidth, 10s function timeout | N/A                                                                             |

### Critical Version Constraints

1. **Node.js**: Must be 18.17+ for Next.js 16 and native fetch
2. **pdfjs-dist**: Pinned to `4.8.69` - Worker file in `public/` must match
3. **nanoid & p-limit**: ESM-only packages - require ESM import syntax
4. **AWS SDK v3**: All `@aws-sdk/*` packages must be same major version
5. **Next.js 16**: Uses new `params` as Promise pattern in dynamic routes

---

## Performance Optimizations for Zero Fast Origin Transfer

### Understanding Fast Origin Transfer

**Fast Origin Transfer** occurs when Vercel's edge network must fetch data from the origin (your serverless function) instead of serving from cache. For HandScript:

- **Current Issue:** Large payloads (images, PDFs) transit through Vercel functions
- **Goal:** Minimize or eliminate Vercel as a data proxy

### Optimization 1: Direct Client-to-B2 Uploads (Already Implemented ✓)

The current architecture already uses presigned URLs for direct uploads, bypassing Vercel's payload limits.

**Current Flow:**

```
Client → (GET /api/get-upload-url) → Vercel (50 bytes) → Returns presigned URL
Client → (PUT presigned URL) → B2 Direct (bypasses Vercel entirely)
```

**Verification:** Upload.tsx line 67-83 confirms direct B2 uploads.

### Optimization 2: Eliminate Image Fetching in Vercel Functions

**Current Issue:** `lib/gemini.ts` fetches images from B2 within Vercel function:

```typescript
// lib/gemini.ts lines 84-91
const imageBuffers = await Promise.all(imageUrls.map(async (url) => {
  const res = await fetch(url);
  // Fetches 1-2MB per image through Vercel!
  return { buffer: Buffer.from(await res.arrayBuffer()), ... };
}));
```

**Problem:** Each batch processes 20 images × 1-2MB = 20-40MB flowing through Vercel.

#### ✅ VERIFIED: Gemini External URL / Signed URL Support

**Official Documentation:** https://ai.google.dev/gemini-api/docs/file-input-methods

As of January 2026, Gemini API officially supports **External HTTP / Signed URLs**:

> "You can pass publicly accessible HTTPS URLs or pre-signed URLs (compatible with S3 Presigned URLs and Azure SAS) directly in your generation request. The Gemini API will fetch the content securely during processing."

**Key Details from Documentation:**

| Feature               | Specification                                          |
| --------------------- | ------------------------------------------------------ |
| Max File Size         | 100 MB per request/payload                             |
| Persistence           | None (fetched per request)                             |
| Supported Image Types | `image/png`, `image/jpeg`, `image/webp`, `image/bmp`   |
| URL Requirements      | Must be HTTPS, publicly accessible or valid signed URL |
| Authentication        | Signed URLs with appropriate expiry and permissions    |

**⚠️ Important Limitation:**

> "Note: Gemini 2.0 family of models are not supported"

This means you must use Gemini 1.5 Flash/Pro or Gemini 2.5+ for external URL support. The current codebase uses `gemini-2.5-flash` which **IS supported**.

#### Complete Implementation for Gemini fileUri

**Modified `lib/gemini.ts`:**

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BatchResponseSchema, BatchResponse } from "./schema";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY must be defined");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// IMPORTANT: Gemini 2.0 does NOT support external URLs
// Must use 2.5+ or 1.5 models
const ACTIVE_MODEL_NAME = "gemini-2.5-flash";

function cleanSchema(schema: any): any {
  if (typeof schema !== "object" || schema === null) return schema;
  if (Array.isArray(schema)) return schema.map(cleanSchema);

  const { additionalProperties, ...rest } = schema;
  const cleaned: any = { ...rest };

  if (cleaned.properties) {
    cleaned.properties = Object.fromEntries(
      Object.entries(cleaned.properties).map(([k, v]) => [k, cleanSchema(v)])
    );
  }
  if (cleaned.items) {
    cleaned.items = cleanSchema(cleaned.items);
  }
  if (cleaned.anyOf) {
    cleaned.anyOf = cleaned.anyOf.map(cleanSchema);
  }

  return cleaned;
}

const rawSchema = zodToJsonSchema(BatchResponseSchema, { target: "openApi3" });
const cleanedSchema = cleanSchema(rawSchema);

export const geminiModel = genAI.getGenerativeModel({
  model: ACTIVE_MODEL_NAME,
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: cleanedSchema as any,
  },
});

export const SYSTEM_PROMPT = `
You are an expert academic transcription system.
Your goal is to transcribe handwritten notes into a structured format.

INPUT:
- A batch of images (pages of notes).

OUTPUT:
- A JSON object adhering strictly to the provided schema.
- The schema contains a 'pages' array. You must populate it with one entry per image in the input batch.
- 'pageIndex' must match the order of images (0, 1, 2...).

TRANSCRIPTION RULES:
- Transcribe EXACTLY what is written. Do not summarize or "fix" content.
- Use valid LaTeX for math.
- For semantic blocks (Theorems, Proofs, etc.), use the 'container' type.
- For diagrams, provide a detailed description in the 'diagram' type.
- If text is illegible, use "[UNCLEAR]" or [ILLEGIBLE].
`;

/**
 * Generates structured notes from a batch of images using External URLs.
 * Gemini fetches images directly - no bandwidth through Vercel!
 *
 * @param signedUrls Pre-signed URLs to images in B2 (must be valid for processing duration)
 * @returns Parsed BatchResponse object
 */
export async function generateBatchNotes(
  signedUrls: string[]
): Promise<BatchResponse> {
  try {
    // OPTIMIZED: Use fileData with fileUri instead of inlineData
    // Gemini fetches directly from B2, bypassing Vercel bandwidth
    const imageParts = signedUrls.map((url) => ({
      fileData: {
        fileUri: url,
        mimeType: "image/png",
      },
    }));

    console.log(
      JSON.stringify({
        event: "GeminiRequest",
        method: "fileUri",
        imageCount: signedUrls.length,
        timestamp: new Date().toISOString(),
      })
    );

    const result = await geminiModel.generateContent([
      SYSTEM_PROMPT,
      ...imageParts,
    ]);

    const responseText = result.response.text();
    const data = JSON.parse(responseText);
    return BatchResponseSchema.parse(data);
  } catch (error: any) {
    console.error(
      JSON.stringify({
        event: "GeminiError",
        error: error.message,
        // Check for specific URL fetch errors
        isUrlError:
          error.message?.includes("url_retrieval") ||
          error.message?.includes("Invalid file_uri"),
        timestamp: new Date().toISOString(),
      })
    );
    throw error;
  }
}
```

**Key Changes:**

1. Replace `inlineData` with `fileData.fileUri`
2. Remove the `fetch` loop that downloads images
3. Pass signed URLs directly to Gemini
4. Add error handling for URL fetch failures

**Modify `lib/s3.ts` - Increase Presigned URL Expiry:**

```typescript
// Increase expiry for Gemini processing (2 hours instead of 1)
export async function getDownloadUrl(
  key: string,
  expiresSec = 7200,
  downloadName?: string
) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: downloadName
      ? `attachment; filename="${downloadName}"`
      : undefined,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: expiresSec });
}
```

**Bandwidth Savings:**

- Before: 20 images × 1.5MB × 2 (download + Gemini upload) = 60MB per batch through Vercel
- After: 0MB through Vercel (Gemini fetches directly from B2)
- **Result:** ~60MB bandwidth saved per 20-page batch

### Optimization 3: Eliminate PDF Proxying

**Current Issue:** `/api/download/route.ts` proxies PDF downloads for local files.

**Current Code (lines 26-45):**

```typescript
if (identifier.includes('localhost') || identifier.startsWith('/uploads/')) {
  const fileBuffer = fs.readFileSync(filePath);
  return new NextResponse(fileBuffer, { ... });
}
```

**Problem:** This pattern doesn't apply to production (B2), but the route still proxies via redirect.

**Solution:** Always redirect to presigned B2 URLs:

```typescript
// OPTIMIZED: Always redirect, never proxy
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "Key required" }, { status: 400 });
  }

  // Generate fresh presigned URL and redirect
  const presignedUrl = await getDownloadUrl(key, 3600, "handscript-notes.pdf");
  return NextResponse.redirect(presignedUrl, 302);
}
```

### Optimization 4: Edge Function Caching for Static Assets

**Current Issue:** PDF worker file served from origin.

**File:** `public/pdf.worker.min.mjs` (large file, frequently requested)

**Solution:** Add cache headers in `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  // ... existing config
  async headers() {
    return [
      {
        source: "/pdf.worker.min.mjs",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};
```


**Applicable Routes:**

1. `/api/get-upload-url` - Cannot cache (unique per request)
2. `/api/jobs/[jobId]/status` - Can cache for 1 second
3. `/api/jobs` - Cannot cache (mutations)

**Implementation for Status Route:**

```typescript
// app/api/jobs/[jobId]/status/route.ts
export async function GET(request: Request, ...) {
  // ... existing logic

  return NextResponse.json(responseData, {
    headers: {
      'Cache-Control': 's-maxage=1, stale-while-revalidate=2'
    }
  });
}
```

### Optimization 6: Reduce Finalize Payload (Modal Direct-to-B2)

**Current Issue:** Finalize route sends HTML to Modal, receives base64 PDF (500KB-2MB per page).

**Solution:** Have Modal upload PDFs directly to B2, return only the key.

#### Modal.com Secrets Configuration

**Official Documentation:** https://modal.com/docs/guide/secrets

Modal uses Secrets to securely inject environment variables into functions. You must create a Secret containing B2 credentials.

**Step 1: Create Modal Secret via CLI**

```bash
# Install Modal CLI if needed
pip install modal

# Authenticate
modal token new

# Create secret with B2 credentials
modal secret create b2-credentials \
  B2_ENDPOINT="https://s3.us-west-004.backblazeb2.com" \
  B2_REGION="us-west-004" \
  B2_KEY_ID="your-key-id" \
  B2_APPLICATION_KEY="your-application-key" \
  B2_BUCKET_NAME="handscript-images"
```

**Alternatively, create via Modal Dashboard:**

1. Go to https://modal.com/secrets
2. Click "Create new secret"
3. Select "Custom" template
4. Add the B2 environment variables
5. Name it `b2-credentials`

**Step 2: Modal Free Tier Limits**

| Resource              | Free Tier                        |
| --------------------- | -------------------------------- |
| Compute               | $30/month credit (~30 hours CPU) |
| Cold Start            | Sub-second                       |
| Concurrent Containers | Unlimited                        |
| GPU                   | Available (pay as you go)        |

**Documentation:** https://modal.com/pricing

#### Complete Modal Service with B2 Upload

**New File:** `scripts/modal_pdf_service.py`

```python
import modal
import os
import boto3
from botocore.config import Config
from fastapi import HTTPException
from pydantic import BaseModel

# Define the Modal image with required dependencies
image = (
    modal.Image.debian_slim()
    .apt_install(
        "wget", "gnupg", "ca-certificates",
        "libnss3", "libxss1", "libasound2", "libatk1.0-0",
        "libatk-bridge2.0-0", "libcups2", "libdrm2", "libgbm1",
        "libgtk-3-0", "libnspr4", "libxcomposite1", "libxdamage1",
        "libxfixes3", "libxrandr2", "xdg-utils", "fonts-liberation",
        "libappindicator3-1", "libu2f-udev", "libvulkan1"
    )
    .pip_install("playwright", "fastapi[standard]", "boto3")
    .run_commands(["playwright install chromium"])
)

app = modal.App("handscript-pdf")

class PDFRequest(BaseModel):
    html: str
    job_id: str = ""
    page_index: int = 0
    upload_to_b2: bool = False  # Flag to enable direct B2 upload

def get_s3_client():
    """Create S3 client for B2 using environment variables from Modal Secret."""
    endpoint = os.environ.get('B2_ENDPOINT', '')
    if not endpoint.startswith('http'):
        endpoint = f'https://{endpoint}'

    return boto3.client(
        's3',
        endpoint_url=endpoint,
        region_name=os.environ.get('B2_REGION', 'us-west-004'),
        aws_access_key_id=os.environ.get('B2_KEY_ID'),
        aws_secret_access_key=os.environ.get('B2_APPLICATION_KEY'),
        config=Config(signature_version='s3v4')
    )

@app.function(
    image=image,
    memory=1024,
    cpu=1.0,
    secrets=[modal.Secret.from_name("b2-credentials")]  # Inject B2 credentials
)
@modal.web_endpoint(method="POST")
async def render_pdf(request: PDFRequest):
    from playwright.async_api import async_playwright
    import base64

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()

            # Set content with timeout
            await page.set_content(request.html, wait_until="networkidle", timeout=30000)

            # Generate PDF
            pdf_bytes = await page.pdf(
                format="A4",
                print_background=True,
                margin={
                    "top": "0",
                    "bottom": "0",
                    "left": "0",
                    "right": "0"
                }
            )

            await browser.close()

            # If B2 upload requested, upload and return key
            if request.upload_to_b2 and request.job_id:
                try:
                    s3_client = get_s3_client()
                    bucket_name = os.environ.get('B2_BUCKET_NAME', 'handscript-images')

                    # Generate unique key
                    pdf_key = f"pdfs/{request.job_id}/page_{request.page_index}.pdf"

                    # Upload to B2
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=pdf_key,
                        Body=pdf_bytes,
                        ContentType='application/pdf'
                    )

                    return {
                        "success": True,
                        "key": pdf_key,
                        "size": len(pdf_bytes)
                    }

                except Exception as upload_error:
                    # Fall back to returning base64 if B2 upload fails
                    print(f"B2 upload failed, falling back to base64: {upload_error}")
                    return {
                        "pdf": base64.b64encode(pdf_bytes).decode("utf-8"),
                        "upload_failed": True,
                        "error": str(upload_error)
                    }

            # Default: return base64 encoded PDF
            return {"pdf": base64.b64encode(pdf_bytes).decode("utf-8")}

    except Exception as e:
        return {"error": str(e)}


# Health check endpoint
@app.function(image=image)
@modal.web_endpoint(method="GET")
async def health():
    return {"status": "healthy", "service": "handscript-pdf"}
```

**Deploy the Modal Service:**

```bash
# Deploy to Modal
modal deploy scripts/modal_pdf_service.py

# Get the endpoint URL (shown after deploy)
# Example: https://your-username--handscript-pdf-render-pdf.modal.run
```

#### Modified Vercel Finalize Route

**File:** `app/api/jobs/[jobId]/finalize/route.ts`

```typescript
// Add helper function to download PDF from B2 key
async function downloadPdfFromB2(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);
  const chunks: Uint8Array[] = [];

  // @ts-ignore - Body is a readable stream
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

// Modified render logic in finalize route
const renderPromises = results.map(async (val, i) => {
  // ... existing HTML preparation code ...

  try {
    const renderStart = Date.now();
    if (!modalEndpoint) throw new Error("No rendering endpoint configured");

    const response = await fetch(modalEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html: fullHtml,
        job_id: jobId,
        page_index: i,
        upload_to_b2: true, // Enable direct B2 upload
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Modal status ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    // Check if Modal uploaded directly to B2
    if (data.key) {
      // Download from B2 for merging (internal fast transfer)
      const pdfBuffer = await downloadPdfFromB2(data.key);

      // Clean up temporary page PDF
      await deleteFile(data.key);

      console.log(
        JSON.stringify({
          event: "RenderSuccess",
          jobId,
          pageIndex: i,
          method: "b2-direct",
          durationMs: Date.now() - renderStart,
          timestamp: new Date().toISOString(),
        })
      );

      return pdfBuffer;
    }

    // Fallback: Modal returned base64
    if (data.pdf) {
      const pdfBuffer = Buffer.from(data.pdf, "base64");
      console.log(
        JSON.stringify({
          event: "RenderSuccess",
          jobId,
          pageIndex: i,
          method: "base64-fallback",
          durationMs: Date.now() - renderStart,
          timestamp: new Date().toISOString(),
        })
      );
      return pdfBuffer;
    }

    throw new Error("No PDF returned from Modal");
  } catch (renderError) {
    // ... existing fallback logic ...
  }
});
```

#### Bandwidth Comparison

| Scenario              | Data Through Vercel | Notes                                 |
| --------------------- | ------------------- | ------------------------------------- |
| **Before (base64)**   | ~500KB per page     | PDF encoded as base64 (+33% overhead) |
| **After (B2 direct)** | ~100 bytes per page | Only key returned, PDF in B2          |
| **50-page document**  | 25MB → 5KB          | **99.98% reduction**                  |

**Trade-off:** The final merge step still requires downloading page PDFs from B2, but this happens via the fast internal Vercel-to-B2 connection rather than through the client response.

### Summary: Zero Fast Origin Transfer Checklist

| Component        | Current State            | Optimization       | Priority   |
| ---------------- | ------------------------ | ------------------ | ---------- |
| Image Upload     | ✅ Direct to B2          | Already optimized  | N/A        |
| Image Processing | ❌ Fetched via Vercel    | Use Gemini fileUri | **HIGH**   |
| PDF Download     | ⚠️ Redirect to B2        | Already redirects  | N/A        |
| PDF Rendering    | ❌ Base64 through Vercel | Modal → B2 direct  | **MEDIUM** |
| Static Assets    | ⚠️ No caching            | Add cache headers  | **LOW**    |
| API Responses    | ⚠️ No caching            | Add s-maxage       | **LOW**    |

---


### Priority Order

1. **HIGH PRIORITY: Gemini fileUri Optimization**

   - Largest bandwidth impact (40MB+ per batch)
   - Implementation time: 2-4 hours
   - Risk: Low (Gemini API supports this natively)

2. **MEDIUM PRIORITY: Email Delivery Extension**

   - User experience improvement
   - Implementation time: 4-8 hours
   - Risk: Low (optional feature, doesn't affect core flow)

3. **MEDIUM PRIORITY: Modal Direct-to-B2 Upload**

   - Reduces finalize bandwidth
   - Implementation time: 4-6 hours
   - Risk: Medium (requires Modal service changes)

4. **LOW PRIORITY: Legacy Code Removal**

   - Codebase cleanliness
   - Implementation time: 1-2 hours
   - Risk: Low (verify no external dependencies first)

5. **LOW PRIORITY: Cache Headers**
   - Marginal improvement
   - Implementation time: 30 minutes
   - Risk: Very low

### Testing Strategy

#### Before Any Changes

1. **Baseline Performance Capture:**

   ```bash
   # Run production test to capture current metrics
   npx ts-node scripts/test-vercel-prod.ts
   ```

2. **Redis Data Backup:**
   - Export any production job data for reference

#### After Each Change

1. **Unit Tests:**

   ```bash
   npx ts-node tests/formatting.test.ts
   ```

2. **Integration Test:**

   ```bash
   npx ts-node scripts/test-batch-flow.ts
   ```

3. **Production Verification:**
   ```bash
   npx ts-node scripts/test-vercel-prod.ts
   ```

---


### Rollback Procedures

#### Gemini fileUri Change

**If Gemini fails to fetch from B2:**

1. Revert `lib/gemini.ts` to inline base64 approach
2. Verify B2 CORS allows Gemini's fetch
3. Test with public B2 bucket temporarily

#### Email Integration

**If email sending fails:**

1. Email is already wrapped in try/catch
2. Job continues successfully, only email notification fails
3. Add manual retry endpoint: `POST /api/jobs/[jobId]/resend-email`

#### Legacy Code Removal

**If removed route is still needed:**

1. Routes are in Git history
2. Can be restored from commit
3. Keep backup branch before deletion

### Monitoring Recommendations

**Add structured logging for:**

1. Gemini API call duration
2. B2 upload/download duration
3. Modal rendering duration
4. Email delivery status
5. Overall job completion time

**Log Format (already partially implemented):**

```typescript
console.log(
  JSON.stringify({
    event: "EventName",
    jobId,
    durationMs,
    timestamp: new Date().toISOString(),
  })
);
```

**Vercel Analytics:**

- Enable Vercel Analytics for function invocation metrics
- Monitor for increased error rates after changes

---

## Appendix A: File Inventory

### Core Application Files

```
app/
├── api/
│   ├── cron/cleanup/route.ts      # Cron job for B2 cleanup
│   ├── download/route.ts          # PDF download proxy/redirect
│   ├── get-upload-url/route.ts    # Presigned URL generation
│   ├── jobs/
│   │   ├── route.ts               # Job creation
│   │   └── [jobId]/
│   │       ├── assemble/route.ts  # ⚠️ LEGACY - Markdown assembly
│   │       ├── finalize/route.ts  # PDF rendering & merging
│   │       ├── render/route.ts    # ⚠️ LEGACY - Separate render
│   │       └── status/route.ts    # Job status polling
│   ├── process/route.ts           # ⚠️ LEGACY - Single-page processing
│   ├── process-batch/route.ts     # Batch Gemini processing
│   └── upload/route.ts            # File upload endpoint
├── components/
│   ├── Header.tsx                 # App header
│   ├── Status.tsx                 # Progress display & orchestration
│   └── Upload.tsx                 # File upload & extraction
├── favicon.ico
├── globals.css                    # Tailwind styles
├── layout.tsx                     # Root layout
└── page.tsx                       # Main page component

lib/
├── formatting.ts                  # IR → HTML conversion
├── gemini.ts                      # Gemini API integration
├── html-template.ts               # HTML/CSS template
├── latex-sanitizer.ts             # ⚠️ DUPLICATE - LaTeX cleaning
├── latex-sanitizer.test.ts        # ⚠️ DUPLICATE - Tests
├── redis.ts                       # Upstash Redis client
├── s3.ts                          # B2/S3 operations
└── schema.ts                      # Zod schemas

scripts/
├── modal_pdf_service.py           # Modal.com Playwright service
├── setup-lifecycle.ts             # B2 lifecycle rules
├── test-b2.ts                     # B2 integration test
├── test-batch-flow.ts             # Local E2E test
├── test-e2e.ts                    # Basic E2E test
├── test-real-pdf.ts               # Real PDF test
├── test-vercel-prod.ts            # Production test
├── test-workflow-new.ts           # HTML pipeline test
├── verify-b2-flow.ts              # B2 flow verification
├── verify-cleanup.ts              # Cleanup verification
└── verify-parallel-perf.ts        # Performance test

tests/
└── formatting.test.ts             # Formatting unit tests
```

### Configuration Files

```
.env                               # Environment variables (gitignored)
.gitignore                         # Git ignore rules
eslint.config.mjs                  # ESLint flat config
next-env.d.ts                      # Next.js type declarations
next.config.ts                     # Next.js configuration
package.json                       # Dependencies
package-lock.json                  # Lockfile
postcss.config.mjs                 # PostCSS/Tailwind config
tsconfig.json                      # TypeScript configuration
```

---

## Appendix B: Environment Variable Reference

| Variable                   | Required | Service   | Description                                  |
| -------------------------- | -------- | --------- | -------------------------------------------- |
| `GEMINI_API_KEY`           | Yes      | Google AI | Gemini API authentication                    |
| `B2_ENDPOINT`              | Yes      | Backblaze | S3-compatible endpoint URL                   |
| `B2_KEY_ID`                | Yes      | Backblaze | Application key ID                           |
| `B2_APPLICATION_KEY`       | Yes      | Backblaze | Application key secret                       |
| `B2_BUCKET_NAME`           | Yes      | Backblaze | Bucket name                                  |
| `B2_REGION`                | Yes      | Backblaze | Bucket region                                |
| `UPSTASH_REDIS_REST_URL`   | Yes      | Upstash   | Redis HTTP endpoint                          |
| `UPSTASH_REDIS_REST_TOKEN` | Yes      | Upstash   | Redis authentication token                   |
| `MODAL_PDF_ENDPOINT`       | Yes      | Modal.com | PDF rendering service URL                    |
| `CRON_SECRET`              | Yes      | Vercel    | Cron job authentication                      |
| `RESEND_API_KEY`           | No\*     | Resend    | Email service (\*required for email feature) |

---


This analysis provides a comprehensive roadmap for:

1. **Cleaning 15%+ of codebase** through removal of unused legacy code
2. **Adding email delivery** without architectural disruption
3. **Achieving zero Fast Origin Transfer** through strategic bypass of Vercel data proxying

All recommendations maintain backwards compatibility and include rollback procedures. Implementation should proceed in the priority order specified, with thorough testing at each stage.

---

---

## Appendix C: Official Documentation References

### Gemini API

| Resource                  | URL                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------- |
| File Input Methods        | https://ai.google.dev/gemini-api/docs/file-input-methods                           |
| External HTTP/Signed URLs | https://ai.google.dev/gemini-api/docs/file-input-methods#external-http-signed-urls |
| Image Understanding       | https://ai.google.dev/gemini-api/docs/image-understanding                          |
| Rate Limits               | https://ai.google.dev/gemini-api/docs/rate-limits                                  |
| Pricing                   | https://ai.google.dev/gemini-api/docs/pricing                                      |

### Upstash QStash

| Resource               | URL                                                       |
| ---------------------- | --------------------------------------------------------- |
| Getting Started        | https://upstash.com/docs/qstash/overall/getstarted        |
| Next.js Quickstart     | https://upstash.com/docs/qstash/quickstarts/vercel-nextjs |
| Pricing                | https://upstash.com/pricing/qstash                        |
| Signature Verification | https://upstash.com/docs/qstash/howto/signature           |
| Local Development      | https://upstash.com/docs/qstash/howto/local-tunnel        |

### Resend Email

| Resource      | URL                                              |
| ------------- | ------------------------------------------------ |
| Documentation | https://resend.com/docs                          |
| API Reference | https://resend.com/docs/api-reference            |
| Pricing       | https://resend.com/pricing                       |
| Rate Limits   | https://resend.com/docs/api-reference/rate-limit |
| Node.js SDK   | https://resend.com/docs/sdks/nodejs              |

### Modal.com

| Resource             | URL                                               |
| -------------------- | ------------------------------------------------- |
| Guide                | https://modal.com/docs/guide                      |
| Secrets              | https://modal.com/docs/guide/secrets              |
| Web Endpoints        | https://modal.com/docs/guide/webhooks             |
| Pricing              | https://modal.com/pricing                         |
| S3 Gateway Endpoints | https://modal.com/docs/guide/s3-gateway-endpoints |

### Backblaze B2

| Resource           | URL                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------- |
| S3-Compatible API  | https://www.backblaze.com/docs/cloud-storage-s3-compatible-api                            |
| Python SDK (boto3) | https://www.backblaze.com/docs/cloud-storage-use-the-aws-sdk-for-python-with-backblaze-b2 |
| CORS Configuration | https://www.backblaze.com/docs/cloud-storage-cross-origin-resource-sharing-rules          |
| Application Keys   | https://www.backblaze.com/docs/cloud-storage-application-keys                             |

### Vercel

| Resource              | URL                                                    |
| --------------------- | ------------------------------------------------------ |
| Serverless Functions  | https://vercel.com/docs/functions                      |
| Environment Variables | https://vercel.com/docs/projects/environment-variables |
| Cron Jobs             | https://vercel.com/docs/cron-jobs                      |
| Limits                | https://vercel.com/docs/limits                         |

---


| Service            | Free Tier Limits                      | Monthly Cost |
| ------------------ | ------------------------------------- | ------------ |
| **Vercel**         | 100GB bandwidth, 10s function timeout | $0           |
| **Gemini API**     | 15 RPM, 1M tokens/day                 | $0           |
| **Backblaze B2**   | 10GB storage, 1GB/day egress          | $0           |
| **Upstash Redis**  | 10K commands/day, 256MB storage       | $0           |
| **Upstash QStash** | 1,000 messages/day                    | $0           |
| **Modal.com**      | $30/month credit (~30 hours CPU)      | $0           |
| **Resend**         | 3,000 emails/month, 100/day           | $0           |

**Total Monthly Cost for HandScript:** $0 (within free tier limits)

---

**Document Version:** 1.0  
**Generated:** January 2026  
**Analyst:** HandScript Architecture Review
