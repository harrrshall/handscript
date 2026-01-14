# Performance Optimization Analysis: HandScript 10x Speedup

This document outlines a first-principles analysis of the HandScript web application's performance and proposes a technical roadmap to achieve a **10x improvement in processing speed** while adhering to Vercel's free tier constraints and Gemini API rate limits.

---

## 1. First Principles Analysis of Current Bottlenecks

### A. The "Speed of Light" Baseline
From first principles, the minimum required operations to convert handwritten notes to a PDF are:
1. **Perception**: Extract text and structure from images (ML Inference).
2. **Translation**: Convert extracted entities into a document format (Transformation).
3. **Synthesis**: Render the document format into a portable visual format (PDF).

Currently, these operations are fragmented across multiple network hops and high-latency execution environments.

### B. Identified Bottlenecks (Order of Magnitude)

| Layer | Complexity | Impact | Latency Source |
| :--- | :--- | :--- | :--- |
| **Transmission** | O(N) Blobs | **Critical** | Client sends 1-2MB Base64 per page to Vercel. `BATCH_SIZE=1` is used to avoid 4.5MB Vercel limits, leading to serial uploads. |
| **Concurrency** | O(N/K) Serial | High | Only 5 pages process simultaneously via 5 concurrent `fetch` calls. |
| **Synthesis** | O(N) Heavy | **Critical** | Playwright on Modal entails container cold starts, Chromium launch, and heavy networking per page. |
| **Storage IO** | O(2N) Hops | Medium | Uploading intermediate images to S3 and downloading them back for Gemini. |

---

## 2. Theoretical Limit: The Zero-Payload Architecture

To reach 10x speedup, we must minimize **Data Movement** between the Client and Vercel.

### Strategy 1: Data Locality & Synthesis (10x Lever)
**Shift synthesis (PDF Generation) to the Client.**
*   **Reasoning**: The client (Browser) already has the images and is a high-performance rendering engine.
*   **Edge-Only ML**: The Server should be a thin proxy for Gemini. It receives an image, returns JSON, and finishes.
*   **Local Synthesis**: Move `renderToHtml` and PDF generation to the client using **Typst-WASM**. Typst compiles documents in milliseconds per page locally, eliminating the Modal/S3 cycle entirely (~15-30s reduction).

### Strategy 2: "Zero-Payload" Vercel Interaction (5x Lever)
**Bypass Vercel's 4.5MB payload limit to unlock parallelism.**
*   **Presigned Direct Uploads**: The client should upload extracted canvas blobs (PNG/WebP) **directly to S3** using presigned URLs. This is highly parallel (browsers allow 6+ concurrent uploads to S3's domain).
*   **Reference-Based Processing**: Instead of sending Base64 to `/api/process-batch`, the client sends the S3 key. This reduces the Vercel request payload from 2MB to 50 bytes.
*   **Batch Expansion**: With "Zero-Payload" requests, we can increase `BATCH_SIZE` from 1 to 10 or 20 without hitting limits, significantly increasing Gemini's throughput.

### Strategy 3: Gemini Throughput Maximization
**Exploit 1000 RPM and Large Context Windows.**
*   **Parallel Batch Triggering**: Once images are in S3, the client triggers **all** batches simultaneously. With 1000 RPM, a 100-page document (10 batches) starts processing instantly.
*   **Combined Prompts**: Use Gemini's ability to see multiple images in one turn to maintain context across pages (e.g., consistent theorem numbering).

---

## 3. Implementation Roadmap (First Principles Guided)

### Phase 1: Zero-Payload Pipeline (Immediate 3-5x Gain)
1.  **Direct S3 Upload**: Update `Upload.tsx` to upload canvas blobs directly to S3 using presigned URLs obtained from a new `get-upload-urls` endpoint.
2.  **Key-Based Extraction**: Refactor `process-batch` to accept S3 keys. The server fetches the image from S3 (internal fast network) or passes the S3 URL directly to the Gemini File API.
3.  **Massive Concurrency**: Set `CONCURRENCY_LIMIT` in `Status.tsx` to 20+ and `BATCH_SIZE` to 10.

### Phase 2: Synthesis Migration (Target 10-15x Gain)
1.  **Typst WASM Integration**: Replace `pdf-lib` and Modal with `@myriaddreamin/typst-ts-web-compiler` in the browser.
2.  **Live Preview**: As Gemini returns JSON for a page, render it immediately using Typst-WASM to a canvas. The user sees the high-quality formatted page in <3 seconds.
3.  **Local Assembly**: The final PDF is generated from the accumulated page IRs in the browser and downloaded directly. No S3 storage is needed for the final PDF.

### Phase 3: Gemini Optimization
1.  **Model Selection**: Force `gemini-1.5-flash` (or `2.0-flash`) for the fastest inference time.
2.  **Schema Pruning**: Minify the JSON schema and system prompt to reduce input token tax and output latency.

---

## 4. Summary of Speed Improvements (50 Page Document)

| Operation | Before (Current) | After (Optimized) | Factor |
| :--- | :--- | :--- | :--- |
| **Transmission** | 50s (Serial B64 Uploads) | 2s (Parallel S3 Uploads) | 25x |
| **Inference/ML** | 60s (5-at-a-time batches) | 5s (20-at-a-time batches) | 12x |
| **Synthesis** | 20s (Modal/Network) | 0.2s (Local Typst) | 100x |
| **Assembly** | 5s (S3 Upload/Merge) | 0s (Local Memory) | ∞ |
| **Total (E2E)** | **~2m 15s** | **~8-12 seconds** | **~13x** |

---

## 5. Constraint Validation
*   **Vercel Free Tier**: Moving almost all compute (Rendering, Transmission, Assembly) to the client reduces Vercel usage to near-zero, perfectly fitting the free tier.
*   **Gemini Rate Limit**: 1000 RPM is more than 100x what a single user needs for even the largest documents.
*   **Cost**: Total cost remains $0 (except the existing Gemini API tier).
