# Gemini API + Backblaze B2 Signed URLs Integration Guide

## Overview

This guide shows how to integrate Gemini API's new External URL feature with your existing Backblaze B2 infrastructure to process handwritten notes **without routing bandwidth through your Vercel serverless functions**.

### Why This Solution?

- ✅ **Zero bandwidth through Vercel** - Gemini fetches directly from B2
- ✅ **No 48-hour expiration** - Uses your existing B2 storage
- ✅ **Cost effective** - No double upload (B2 → Vercel → Gemini)
- ✅ **Production ready** - Announced January 12, 2026
- ✅ **Simple integration** - Minimal code changes needed

---

## Architecture Changes

### Before (Current - Bandwidth Through Vercel)
```
Browser → Vercel → B2 (upload)
B2 → Vercel → Gemini API (download + forward) ❌ HIGH BANDWIDTH
```

### After (Direct Fetch - Zero Vercel Bandwidth)
```
Browser → Vercel → B2 (upload)
B2 → Gemini API (direct fetch) ✅ NO BANDWIDTH COST
```

---

## Prerequisites

1. **Gemini API Key** with latest SDK version
2. **Backblaze B2 Account** (already configured)
3. **Node.js 18+** (for SDK support)

---

## Implementation

### 1. Update Dependencies

```bash
npm install @google/generative-ai@latest
# or
pnpm add @google/generative-ai@latest
```

**Verify SDK Version:**
Ensure you have at least version `0.21.0` or later (released after Jan 12, 2026).

---

### 2. Updated Gemini Client (lib/gemini.ts)

Replace your existing `generateBatchNotes` function:

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BatchResponseSchema, BatchResponse } from './schema';
import { env } from './env';
import { withRetry, withTimeout } from './utils';
import { logger, metrics } from './logger';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// UPDATED: Use gemini-2.5-flash for external URL support
// Note: Gemini 2.0 family does NOT support external URLs
const ACTIVE_MODEL_NAME = 'gemini-2.5-flash';

function cleanSchema(schema: any): any {
    if (typeof schema !== 'object' || schema === null) return schema;
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
        responseSchema: cleanedSchema as any
    }
});

export const SYSTEM_PROMPT = `
You are an expert academic transcription system.
Your goal is to transcribe handwritten notes into a structured format.

INPUT:
- A batch of images (pages of notes) from external URLs.

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
 * UPDATED: Generates structured notes using External URLs (B2 Signed URLs)
 * Gemini fetches images directly from B2 - NO bandwidth through Vercel!
 *
 * @param signedUrls Pre-signed URLs to images in B2 (must be valid for ~10 min)
 * @returns Parsed BatchResponse object
 */
export async function generateBatchNotes(signedUrls: string[]): Promise<BatchResponse> {
    try {
        // CRITICAL: Use file_data with file_uri for external URLs
        // This triggers Gemini's direct fetch from B2
        const imageParts = signedUrls.map((url) => ({
            fileData: {
                fileUri: url,
                mimeType: "image/png",
            },
        }));

        logger.info("GeminiRequest", {
            metadata: {
                method: "external_url",
                imageCount: signedUrls.length,
                note: "Gemini fetching directly from B2"
            }
        });

        const startTime = Date.now();

        const result = await withRetry(
            () => withTimeout(
                geminiModel.generateContent([
                    SYSTEM_PROMPT,
                    ...imageParts
                ]),
                35000, // Increased timeout for external fetches
                "Gemini request timed out"
            ),
            {
                maxRetries: 3,
                baseDelayMs: 1000,
                onRetry: (attempt, err) => {
                    console.warn(`[Gemini] Retry ${attempt} after error: ${err.message}`);
                    logger.warn("GeminiRetry", {
                        attempt,
                        error: err.message,
                        metadata: { signedUrlCount: signedUrls.length }
                    });
                }
            }
        );

        const duration = Date.now() - startTime;
        await metrics.increment("gemini_requests");
        await metrics.recordLatency("gemini_processing", duration);

        const responseText = result.response.text();
        const data = JSON.parse(responseText);
        return BatchResponseSchema.parse(data);

    } catch (error: any) {
        await metrics.increment("gemini_errors");
        
        // Enhanced error logging for URL issues
        const isUrlError = 
            error.message?.includes("url_retrieval") ||
            error.message?.includes("Invalid file_uri") ||
            error.message?.includes("URL_RETRIEVAL_STATUS");

        logger.error("GeminiError", {
            error: error.message,
            metadata: {
                isUrlError,
                urlCount: signedUrls.length,
                errorType: error.name,
                statusCode: error.statusCode
            }
        });

        // Provide helpful error message for common issues
        if (isUrlError) {
            throw new Error(
                "Gemini could not fetch images from B2. " +
                "Check: (1) URLs are publicly accessible or properly signed, " +
                "(2) URLs haven't expired, (3) CORS is configured on B2 bucket"
            );
        }

        throw error;
    }
}
```

---

### 3. Backblaze B2 Configuration

#### A. Enable CORS on Your B2 Bucket

Gemini needs to fetch files directly from B2. Configure CORS:

```json
[
  {
    "corsRuleName": "allowGeminiAPI",
    "allowedOrigins": [
      "https://generativelanguage.googleapis.com"
    ],
    "allowedOperations": [
      "s3_get"
    ],
    "allowedHeaders": [
      "*"
    ],
    "maxAgeSeconds": 3600
  }
]
```

**Apply via B2 CLI:**
```bash
b2 update-bucket --cors-rules '[...]' YOUR_BUCKET_NAME allPublic
```

**Or via Web Console:**
1. Go to B2 Bucket Settings
2. Navigate to "Bucket CORS Rules"
3. Add the rule above

#### B. Generate Signed URLs with Appropriate Duration

Update your `/api/get-upload-url` endpoint to generate signed URLs that last at least **15 minutes** (to account for Gemini processing time):

```typescript
// Example: lib/b2.ts
export async function generateSignedDownloadUrl(
  fileKey: string,
  durationSeconds: number = 900 // 15 minutes default
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.B2_BUCKET_NAME,
    Key: fileKey,
  });

  return await getSignedUrl(s3Client, command, { 
    expiresIn: durationSeconds 
  });
}
```

---

### 4. Update Process Batch Function

Modify `/api/internal/process-batch` to pass signed URLs to Gemini:

```typescript
// api/internal/process-batch.ts (simplified excerpt)

async function processBatch(jobId: string, batchNumber: number) {
  // 1. Get image keys from Redis
  const imageKeys = await redis.lrange(`job:${jobId}:images`, start, end);

  // 2. Generate signed URLs (15 min expiry)
  const signedUrls = await Promise.all(
    imageKeys.map(key => generateSignedDownloadUrl(key, 900))
  );

  // 3. Call Gemini with external URLs
  const batchResponse = await generateBatchNotes(signedUrls);

  // 4. Store results
  await storeBatchResults(jobId, batchNumber, batchResponse);
}
```

---

## Important Considerations

### 1. Model Compatibility

⚠️ **CRITICAL:** Gemini 2.0 models do NOT support external URLs.

**Supported Models:**
- ✅ `gemini-3-flash-preview`
- ✅ `gemini-2.5-flash`
- ✅ `gemini-2.5-pro`
- ✅ `gemini-1.5-flash`
- ✅ `gemini-1.5-pro`

**NOT Supported:**
- ❌ `gemini-2.0-flash` (any 2.0 variant)

### 2. URL Expiration Timing

```
Timeline:
┌─────────────────────────────────────────────────────┐
│ Upload to B2 → Generate URL → Queue Job            │  ~1 min
│ Job Starts → Gemini Fetches → Processing           │  ~5-10 min
│ Total Safe Window: 15 minutes                       │
└─────────────────────────────────────────────────────┘
```

**Recommendation:** Use 15-20 minute expiration for signed URLs.

### 3. File Size Limits

- **Maximum per file:** 100 MB
- **Recommended for images:** Keep under 10 MB per PNG for optimal performance
- **Total payload:** All images combined should stay under 100 MB

### 4. MIME Type Accuracy

Always specify correct MIME types:
```typescript
mimeType: "image/png"  // for PNGs
mimeType: "image/jpeg" // for JPEGs
mimeType: "image/webp" // for WebP
```

---

## Error Handling

### Common Error Codes

| Error | Cause | Solution |
|-------|-------|----------|
| `URL_RETRIEVAL_STATUS_UNSAFE` | Content safety check failed | Review image content |
| `URL_RETRIEVAL_STATUS_FAILED` | Network error or invalid URL | Check URL accessibility |
| `Invalid file_uri` | Incorrect URL format | Ensure proper HTTPS URL |
| `403 Forbidden` | CORS or authentication issue | Verify B2 CORS + signed URL |
| `404 Not Found` | File doesn't exist | Check file was uploaded |

### Retry Strategy

```typescript
// Already implemented in your withRetry util
const retryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2, // 1s, 2s, 4s
  onRetry: (attempt, err) => {
    if (err.message.includes('url_retrieval')) {
      // Don't retry URL fetch errors immediately
      return false;
    }
    return true; // Retry other errors
  }
};
```

---

## Testing Checklist

### Local Testing

```typescript
// test/gemini-external-url.test.ts
import { generateBatchNotes } from '../lib/gemini';

async function testExternalUrls() {
  // 1. Upload test image to B2
  const testImageKey = await uploadTestImage();
  
  // 2. Generate signed URL
  const signedUrl = await generateSignedDownloadUrl(testImageKey, 900);
  
  // 3. Verify URL is accessible
  const response = await fetch(signedUrl);
  console.assert(response.ok, "Signed URL should be accessible");
  
  // 4. Test Gemini processing
  const result = await generateBatchNotes([signedUrl]);
  console.log("Success:", result.pages.length);
}

testExternalUrls();
```

### Production Checklist

- [ ] B2 CORS configured for `generativelanguage.googleapis.com`
- [ ] Signed URLs generated with 15+ minute expiration
- [ ] Using `gemini-3-flash-preview` or `gemini-2.5-flash`
- [ ] Error handling for `url_retrieval` errors
- [ ] Monitoring for URL fetch failures
- [ ] Timeout increased to 35 seconds (external fetches slower than inline)

---

## Cost Comparison

### Current Approach (Inline Data)
```
Vercel bandwidth: $X per GB egress
B2 → Vercel → Gemini: FULL image data transfer
Cost: Vercel egress + Gemini API
```

### New Approach (External URLs)
```
Vercel bandwidth: $0 (no image routing)
B2 → Gemini: Direct fetch (B2 egress only)
Cost: B2 egress + Gemini API
```

**Savings:** Eliminate Vercel egress costs completely!

---

## Migration Strategy

### Phase 1: Parallel Testing (Week 1)
- Deploy external URL code to staging
- Run 10% of jobs through new path
- Monitor error rates and latency

### Phase 2: Gradual Rollout (Week 2)
- Increase to 50% traffic
- Compare costs and performance
- Gather user feedback

### Phase 3: Full Migration (Week 3)
- Route 100% to external URLs
- Remove old inline data code
- Update documentation

---

## Monitoring & Metrics

Track these metrics in your logging system:

```typescript
// Key metrics to monitor
metrics.increment("gemini_external_url_requests");
metrics.increment("gemini_url_fetch_failures");
metrics.recordLatency("gemini_external_url_latency", duration);
metrics.gauge("b2_signed_url_expirations", expiredUrlCount);
```

**Alert thresholds:**
- URL fetch failure rate > 5%
- Average latency > 40 seconds
- Signed URL expiration errors > 1%

---

## Troubleshooting Guide

### Issue: "URL_RETRIEVAL_STATUS_FAILED"

**Symptoms:** Gemini cannot fetch images from B2

**Debug steps:**
1. Test URL accessibility: `curl -I <signed_url>`
2. Check URL hasn't expired: verify timestamp
3. Verify CORS settings on B2 bucket
4. Test from different IP (Gemini's IPs may differ)

**Solution:**
```typescript
// Add pre-flight check before calling Gemini
async function validateSignedUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
```

### Issue: Images Not Loading in Final PDF

**Cause:** Gemini processed images, but image references in output are broken

**Solution:** Store image URLs in Redis along with transcription results

---

## API Reference

### Updated Function Signature

```typescript
/**
 * Process handwritten notes using Gemini API with external URLs
 * 
 * @param signedUrls - Array of B2 signed URLs (HTTPS, 15min+ expiry)
 * @returns Structured transcription data
 * 
 * @throws Error if URL fetch fails or content is unsafe
 * 
 * @example
 * const urls = [
 *   "https://s3.us-west-000.backblazeb2.com/bucket/page1.png?X-Amz-..."
 * ];
 * const result = await generateBatchNotes(urls);
 */
export async function generateBatchNotes(
  signedUrls: string[]
): Promise<BatchResponse>
```

---

## Additional Resources

- [Gemini File Input Methods Docs](https://ai.google.dev/gemini-api/docs/file-input-methods)
- [Backblaze B2 CORS Configuration](https://www.backblaze.com/docs/cloud-storage-cors-rules)
- [AWS S3 Signed URL Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html)

---

## Support

For issues specific to:
- **Gemini API:** [Google AI Developer Forum](https://discuss.ai.google.dev/)
- **Backblaze B2:** [B2 Support](https://help.backblaze.com/)
- **Your App:** Check `logs/` directory or contact your team

---

## Changelog

- **v2.0.0** (Jan 2026): Migrated to external URL method
- **v1.0.0** (Dec 2025): Original inline data implementation