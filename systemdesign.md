---

## Scalability Review: 10,000 Users/Month on Free Tier

### Executive Summary

**Goal**: Serve 10,000 users/month on Vercel Free tier with gemini-2.5-flash-lite.

**Verdict**: The current server-side Typst architecture **cannot achieve 10,000 users/month** due to Vercel's 4 CPU-hr/month limit. By offloading PDF generation to **Modal.com** (free tier: 30 hrs/month), **10,000+ jobs/month becomes achievable**.

---

### Constraint Analysis (Corrected for gemini-2.5-flash-lite)

| Resource          | Free Limit          | Current Usage/Job (10 pages) | Max Jobs/Month                 |
| ----------------- | ------------------- | ---------------------------- | ------------------------------ |
| **Vercel CPU**    | 4 CPU-hrs (14,400s) | ~30s (Typst)                 | **~480** ⚠️ PRIMARY BOTTLENECK |
| **Upstash Redis** | 10K/day (300K/mo)   | ~80 commands                 | ~3,750                         |
| **Gemini RPM**    | 4,000/minute        | 10 requests                  | ∞ (not a constraint)           |
| **Gemini TPM**    | 4M tokens/minute    | ~10K tokens                  | ∞ (not a constraint)           |
| **Bandwidth**     | 100 GB/month        | ~6 MB                        | ~16,000                        |
| **Blob Storage**  | 500 MB total        | Ephemeral                    | Manageable                     |

**Key Insight**: Gemini's generous limits (4,000 RPM, 4M TPM, no daily cap) are **not a bottleneck**. No rate limiting infrastructure is needed.

**Primary Bottleneck**: Server-side Typst compilation consuming ~30s of CPU per job on Vercel.

---

### Bottleneck #1: Server-Side Typst (CRITICAL)

**Problem**: Each PDF compilation uses ~30s of CPU time. With 4 CPU-hrs/month limit:

- `14,400s / 30s = 480 jobs/month` maximum
- Even at 10s/job optimized: only `1,440 jobs/month`

**Solution**: Offload PDF generation to **Modal.com** — a free serverless compute platform.

#### Why Modal.com?

| Feature        | Modal.com Free Tier                       |
| -------------- | ----------------------------------------- |
| Compute        | **30 hours/month** (108,000 CPU-seconds)  |
| Cold start     | ~1-2 seconds                              |
| HTTP endpoints | Native support via `@modal.web_endpoint`  |
| CLI tools      | Full Linux environment, can install Typst |
| Pricing        | Completely free up to 30 hrs              |
| Integration    | Simple HTTP POST from Vercel              |

**Capacity with Modal**:

- 30 hrs = 108,000 seconds
- At 30s per PDF: `108,000 / 30 = 3,600 jobs/month` from compute alone
- At 10s optimized: `108,000 / 10 = 10,800 jobs/month` ✓

**Revised Architecture**:

```
Current:  Client → Vercel (Gemini OCR) → Vercel (Typst) → PDF
Proposed: Client → Vercel (Gemini OCR) → Modal.com (Typst) → PDF
```

---

### Modal.com Integration Design

#### Modal Typst Service

```python
# modal_typst_service.py
import modal
import subprocess
import tempfile
import os

app = modal.App("handscript-typst")

image = modal.Image.debian_slim().run_commands([
    "apt-get update",
    "apt-get install -y wget",
    "wget -qO typst.tar.xz https://github.com/typst/typst/releases/download/v0.12.0/typst-x86_64-unknown-linux-musl.tar.xz",
    "tar -xf typst.tar.xz",
    "mv typst-x86_64-unknown-linux-musl/typst /usr/local/bin/",
    "chmod +x /usr/local/bin/typst"
])

@app.function(image=image, timeout=300)
@modal.web_endpoint(method="POST")
def render_pdf(markdown: str, template: str = "academic"):
    with tempfile.TemporaryDirectory() as tmpdir:
        # Write markdown content
        content_path = os.path.join(tmpdir, "content.md")
        with open(content_path, "w") as f:
            f.write(markdown)

        # Write Typst template
        main_path = os.path.join(tmpdir, "main.typ")
        with open(main_path, "w") as f:
            f.write(TYPST_TEMPLATE)

        # Compile
        output_path = os.path.join(tmpdir, "output.pdf")
        result = subprocess.run(
            ["typst", "compile", "main.typ", "output.pdf"],
            cwd=tmpdir,
            capture_output=True
        )

        if result.returncode != 0:
            return {"error": result.stderr.decode()}

        # Return PDF as base64
        with open(output_path, "rb") as f:
            import base64
            pdf_base64 = base64.b64encode(f.read()).decode()

        return {"pdf": pdf_base64}
```

#### Vercel Integration

```typescript
// app/api/jobs/[jobId]/render/route.ts
export async function POST(request: Request, { params }) {
  const { jobId } = await params;

  // Fetch assembled markdown (from Redis or request body)
  const markdown = await getAssembledMarkdown(jobId);

  // Call Modal.com endpoint
  const response = await fetch(process.env.MODAL_TYPST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });

  const { pdf, error } = await response.json();

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  // Upload to Vercel Blob or return directly
  const pdfBuffer = Buffer.from(pdf, "base64");
  const pdfUrl = await uploadFile(pdfBuffer, `${jobId}.pdf`);

  return NextResponse.json({ pdfUrl });
}
```

---

### Bottleneck #2: Redis Operations (SECONDARY)

**Problem**: Current implementation uses ~80 Redis commands per job.

**Solution**: Since Gemini has no rate limits to enforce, Redis usage can be dramatically reduced.

**Optimized Redis Strategy**:

| Operation           | Current                 | Optimized                  |
| ------------------- | ----------------------- | -------------------------- |
| Job creation        | 2 (set + expire)        | 1 (set with TTL)           |
| Per-page processing | 6-7 ops                 | 1 op (store result only)   |
| Progress tracking   | Redis counter + polling | Client-side state          |
| Page locking        | Redis lock/unlock       | Remove (Gemini can handle) |
| Rate limiting       | Multiple ops            | **Remove entirely**        |
| Final render        | 3 ops                   | 2 ops                      |

**New Per-Job Total**: ~15 commands (down from ~80)
**New Capacity**: `10,000 / 15 = 667 jobs/day = 20,000 jobs/month` ✓

---

### Bottleneck #3: Image Bandwidth Round-trip

**Problem**: Page images uploaded to Blob, then re-fetched by serverless function.

**Solution**: Direct image submission in request body.

```
Before: Client → Blob (200KB) → Function (200KB fetch) → Gemini
After:  Client → Function (200KB direct) → Gemini
```

**Impact**: 50% bandwidth reduction per page.

---

### Optimized Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ PDF Upload   │  │ PDF.js       │  │ Parallel     │  │ Progress     │    │
│  │ Component    │──│ Page Extract │──│ OCR Dispatch │──│ Tracking     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
┌───────────────────────────────────┐   ┌───────────────────────────────────┐
│      VERCEL SERVERLESS            │   │         MODAL.COM                 │
├───────────────────────────────────┤   ├───────────────────────────────────┤
│  /api/process                     │   │  Typst PDF Service                │
│  - Receive base64 image           │   │  - 30 hrs/month free              │
│  - Call Gemini (4K RPM headroom)  │   │  - Full Linux environment         │
│  - Return markdown                │   │  - Typst CLI installed            │
│  - Minimal Redis (store result)   │   │  - Returns PDF as base64          │
│                                   │   │                                   │
│  /api/jobs/:id/render             │   │  POST /render_pdf                 │
│  - Assemble markdown              │──▶│  - Receives markdown              │
│  - Call Modal endpoint            │   │  - Compiles with cmarker          │
│  - Return PDF URL                 │   │  - Returns PDF                    │
└───────────────────────────────────┘   └───────────────────────────────────┘
                    │                                       │
                    ▼                                       │
┌───────────────────────────────────────────────────────────┴───────────────┐
│                              EXTERNAL SERVICES                             │
├───────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────────┐ │
│  │   Upstash Redis      │  │   Gemini API         │  │  Vercel Blob    │ │
│  │  - Job metadata      │  │  - gemini-2.5-flash  │  │  - Final PDFs   │ │
│  │  - Page results      │  │    -lite             │  │  - 500MB total  │ │
│  │  - ~15 ops/job       │  │  - 4K RPM, 4M TPM    │  │                 │ │
│  └──────────────────────┘  └──────────────────────┘  └─────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

---

### Capacity After Optimization

| Resource      | Limit     | Optimized Usage/Job | Max Jobs/Month | Status |
| ------------- | --------- | ------------------- | -------------- | ------ |
| Vercel CPU    | 14,400s   | ~1s (OCR only)      | **~14,000**    | ✅     |
| Modal CPU     | 108,000s  | ~10s (Typst)        | **~10,800**    | ✅     |
| Upstash Redis | 300K/mo   | ~15 commands        | **~20,000**    | ✅     |
| Gemini RPM    | 4,000/min | 10 requests         | **∞**          | ✅     |
| Bandwidth     | 100 GB    | ~3 MB               | **~33,000**    | ✅     |

**Conclusion**: 10,000 jobs/month is **achievable** with Modal.com for PDF generation.

---

### Performance Optimizations

Since Gemini has 4,000 RPM capacity, we can maximize parallelism:

#### Aggressive Parallel Processing

```typescript
// Client-side: process all pages in parallel
const MAX_CONCURRENT = 10; // Can go higher with 4K RPM
const results = await Promise.all(
  pages.map((page, i) => processPage(jobId, i, page.base64))
);
```

#### Batch OCR Requests

```typescript
// Server-side: batch multiple pages per request if beneficial
// Gemini can handle multiple images in one call
const result = await geminiModel.generateContent([
  SYSTEM_PROMPT,
  ...pages.map((p) => ({
    inlineData: { data: p.base64, mimeType: "image/png" },
  })),
]);
```

**Latency Improvement**:

- Current (sequential): 10 pages × 5s = 50s
- Optimized (parallel): 10 pages / 10 concurrent = ~5s total

---

### Implementation Priority

| Priority | Change                                 | Effort | Impact                  |
| -------- | -------------------------------------- | ------ | ----------------------- |
| **P0**   | Deploy Modal.com Typst service         | S-M    | Unlocks 10K+ capacity   |
| **P1**   | Remove rate limiting code              | XS     | Simplifies codebase     |
| **P2**   | Increase parallel OCR (10+ concurrent) | S      | 10x latency improvement |
| **P3**   | Remove per-page Redis locking          | S      | 5x Redis headroom       |
| **P4**   | Direct image submission (skip Blob)    | S      | 50% bandwidth reduction |

---

### Risk Mitigations

| Risk                        | Mitigation                                 |
| --------------------------- | ------------------------------------------ |
| Modal.com cold starts       | Keep service warm with periodic pings      |
| Large documents (50+ pages) | Enforce 50-page limit (Modal has time)     |
| Modal free tier exhaustion  | Monitor usage, alert at 80%                |
| Network latency to Modal    | Modal has edge locations, typically <100ms |
| Redis usage creep           | Budget ops per endpoint, add monitoring    |

---

### Alternative External Compute Options

If Modal.com doesn't fit, consider:

| Service            | Free Tier                 | Typst Support | Integration |
| ------------------ | ------------------------- | ------------- | ----------- |
| **Modal.com**      | 30 hrs/month              | ✅ Full CLI   | HTTP POST   |
| Fly.io             | 3 shared VMs              | ✅ Full CLI   | HTTP POST   |
| Railway            | $5 credit/month           | ✅ Full CLI   | HTTP POST   |
| Render             | 750 hrs/month (spin down) | ✅ Full CLI   | HTTP POST   |
| Cloudflare Workers | 100K req/day              | ❌ No CLI     | —           |

**Modal.com is recommended** for simplicity and generous free tier.

---

### Decision Log

| Decision                        | Rationale                                      | Trade-off                  |
| ------------------------------- | ---------------------------------------------- | -------------------------- |
| Modal.com for PDF generation    | 30 hrs free, full CLI, simple HTTP integration | External dependency        |
| Remove all rate limiting        | 4K RPM makes limiting unnecessary              | None                       |
| Aggressive parallelism (10+)    | 4K RPM allows high concurrency                 | Slightly higher peak load  |
| Keep server-side PDF generation | Better UX than client WASM, shareable URLs     | Requires Modal integration |
| Direct image in request body    | Eliminates Blob round-trip bandwidth           | Larger request payloads    |
| Max 50 pages per document       | Modal can handle longer jobs than Vercel       | Limits very large uploads  |

---

### Environment Variables

```bash
# Required
GEMINI_API_KEY=your-gemini-api-key
UPSTASH_REDIS_REST_URL=your-upstash-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-token

# Modal.com
MODAL_TYPST_ENDPOINT=https://your-modal-app--render-pdf.modal.run

# Optional
BLOB_READ_WRITE_TOKEN=your-vercel-blob-token
```

---

## Document Metadata

- **Version**: 2.1.0
- **Last Updated**: 2026-01-13
- **Status**: Scalability Review Complete (Modal.com Integration)
- **Author**: System Design Phase
- **Reviewer**: Architecture Optimization Pass
---

## Scalability Review: 10,000 Users/Month on Free Tier

### Executive Summary

**Goal**: Serve 10,000 users/month on Vercel Free tier with gemini-2.5-flash-lite.

**Verdict**: The current server-side Typst architecture **cannot achieve 10,000 users/month** due to Vercel's 4 CPU-hr/month limit. By offloading PDF generation to **Modal.com** (free tier: 30 hrs/month), **10,000+ jobs/month becomes achievable**.

---

### Constraint Analysis (Corrected for gemini-2.5-flash-lite)

| Resource          | Free Limit          | Current Usage/Job (10 pages) | Max Jobs/Month                 |
| ----------------- | ------------------- | ---------------------------- | ------------------------------ |
| **Vercel CPU**    | 4 CPU-hrs (14,400s) | ~30s (Typst)                 | **~480** ⚠️ PRIMARY BOTTLENECK |
| **Upstash Redis** | 10K/day (300K/mo)   | ~80 commands                 | ~3,750                         |
| **Gemini RPM**    | 4,000/minute        | 10 requests                  | ∞ (not a constraint)           |
| **Gemini TPM**    | 4M tokens/minute    | ~10K tokens                  | ∞ (not a constraint)           |
| **Bandwidth**     | 100 GB/month        | ~6 MB                        | ~16,000                        |
| **Blob Storage**  | 500 MB total        | Ephemeral                    | Manageable                     |

**Key Insight**: Gemini's generous limits (4,000 RPM, 4M TPM, no daily cap) are **not a bottleneck**. No rate limiting infrastructure is needed.

**Primary Bottleneck**: Server-side Typst compilation consuming ~30s of CPU per job on Vercel.

---

### Bottleneck #1: Server-Side Typst (CRITICAL)

**Problem**: Each PDF compilation uses ~30s of CPU time. With 4 CPU-hrs/month limit:

- `14,400s / 30s = 480 jobs/month` maximum
- Even at 10s/job optimized: only `1,440 jobs/month`

**Solution**: Offload PDF generation to **Modal.com** — a free serverless compute platform.

#### Why Modal.com?

| Feature        | Modal.com Free Tier                       |
| -------------- | ----------------------------------------- |
| Compute        | **30 hours/month** (108,000 CPU-seconds)  |
| Cold start     | ~1-2 seconds                              |
| HTTP endpoints | Native support via `@modal.web_endpoint`  |
| CLI tools      | Full Linux environment, can install Typst |
| Pricing        | Completely free up to 30 hrs              |
| Integration    | Simple HTTP POST from Vercel              |

**Capacity with Modal**:

- 30 hrs = 108,000 seconds
- At 30s per PDF: `108,000 / 30 = 3,600 jobs/month` from compute alone
- At 10s optimized: `108,000 / 10 = 10,800 jobs/month` ✓

**Revised Architecture**:

```
Current:  Client → Vercel (Gemini OCR) → Vercel (Typst) → PDF
Proposed: Client → Vercel (Gemini OCR) → Modal.com (Typst) → PDF
```

---

### Modal.com Integration Design

#### Modal Typst Service

```python
# modal_typst_service.py
import modal
import subprocess
import tempfile
import os

app = modal.App("handscript-typst")

image = modal.Image.debian_slim().run_commands([
    "apt-get update",
    "apt-get install -y wget",
    "wget -qO typst.tar.xz https://github.com/typst/typst/releases/download/v0.12.0/typst-x86_64-unknown-linux-musl.tar.xz",
    "tar -xf typst.tar.xz",
    "mv typst-x86_64-unknown-linux-musl/typst /usr/local/bin/",
    "chmod +x /usr/local/bin/typst"
])

@app.function(image=image, timeout=300)
@modal.web_endpoint(method="POST")
def render_pdf(markdown: str, template: str = "academic"):
    with tempfile.TemporaryDirectory() as tmpdir:
        # Write markdown content
        content_path = os.path.join(tmpdir, "content.md")
        with open(content_path, "w") as f:
            f.write(markdown)

        # Write Typst template
        main_path = os.path.join(tmpdir, "main.typ")
        with open(main_path, "w") as f:
            f.write(TYPST_TEMPLATE)

        # Compile
        output_path = os.path.join(tmpdir, "output.pdf")
        result = subprocess.run(
            ["typst", "compile", "main.typ", "output.pdf"],
            cwd=tmpdir,
            capture_output=True
        )

        if result.returncode != 0:
            return {"error": result.stderr.decode()}

        # Return PDF as base64
        with open(output_path, "rb") as f:
            import base64
            pdf_base64 = base64.b64encode(f.read()).decode()

        return {"pdf": pdf_base64}
```

#### Vercel Integration

```typescript
// app/api/jobs/[jobId]/render/route.ts
export async function POST(request: Request, { params }) {
  const { jobId } = await params;

  // Fetch assembled markdown (from Redis or request body)
  const markdown = await getAssembledMarkdown(jobId);

  // Call Modal.com endpoint
  const response = await fetch(process.env.MODAL_TYPST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });

  const { pdf, error } = await response.json();

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  // Upload to Vercel Blob or return directly
  const pdfBuffer = Buffer.from(pdf, "base64");
  const pdfUrl = await uploadFile(pdfBuffer, `${jobId}.pdf`);

  return NextResponse.json({ pdfUrl });
}
```

---

### Bottleneck #2: Redis Operations (SECONDARY)

**Problem**: Current implementation uses ~80 Redis commands per job.

**Solution**: Since Gemini has no rate limits to enforce, Redis usage can be dramatically reduced.

**Optimized Redis Strategy**:

| Operation           | Current                 | Optimized                  |
| ------------------- | ----------------------- | -------------------------- |
| Job creation        | 2 (set + expire)        | 1 (set with TTL)           |
| Per-page processing | 6-7 ops                 | 1 op (store result only)   |
| Progress tracking   | Redis counter + polling | Client-side state          |
| Page locking        | Redis lock/unlock       | Remove (Gemini can handle) |
| Rate limiting       | Multiple ops            | **Remove entirely**        |
| Final render        | 3 ops                   | 2 ops                      |

**New Per-Job Total**: ~15 commands (down from ~80)
**New Capacity**: `10,000 / 15 = 667 jobs/day = 20,000 jobs/month` ✓

---

### Bottleneck #3: Image Bandwidth Round-trip

**Problem**: Page images uploaded to Blob, then re-fetched by serverless function.

**Solution**: Direct image submission in request body.

```
Before: Client → Blob (200KB) → Function (200KB fetch) → Gemini
After:  Client → Function (200KB direct) → Gemini
```

**Impact**: 50% bandwidth reduction per page.

---

### Optimized Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ PDF Upload   │  │ PDF.js       │  │ Parallel     │  │ Progress     │    │
│  │ Component    │──│ Page Extract │──│ OCR Dispatch │──│ Tracking     │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
┌───────────────────────────────────┐   ┌───────────────────────────────────┐
│      VERCEL SERVERLESS            │   │         MODAL.COM                 │
├───────────────────────────────────┤   ├───────────────────────────────────┤
│  /api/process                     │   │  Typst PDF Service                │
│  - Receive base64 image           │   │  - 30 hrs/month free              │
│  - Call Gemini (4K RPM headroom)  │   │  - Full Linux environment         │
│  - Return markdown                │   │  - Typst CLI installed            │
│  - Minimal Redis (store result)   │   │  - Returns PDF as base64          │
│                                   │   │                                   │
│  /api/jobs/:id/render             │   │  POST /render_pdf                 │
│  - Assemble markdown              │──▶│  - Receives markdown              │
│  - Call Modal endpoint            │   │  - Compiles with cmarker          │
│  - Return PDF URL                 │   │  - Returns PDF                    │
└───────────────────────────────────┘   └───────────────────────────────────┘
                    │                                       │
                    ▼                                       │
┌───────────────────────────────────────────────────────────┴───────────────┐
│                              EXTERNAL SERVICES                             │
├───────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────────┐ │
│  │   Upstash Redis      │  │   Gemini API         │  │  Vercel Blob    │ │
│  │  - Job metadata      │  │  - gemini-2.5-flash  │  │  - Final PDFs   │ │
│  │  - Page results      │  │    -lite             │  │  - 500MB total  │ │
│  │  - ~15 ops/job       │  │  - 4K RPM, 4M TPM    │  │                 │ │
│  └──────────────────────┘  └──────────────────────┘  └─────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
```

---

### Capacity After Optimization

| Resource      | Limit     | Optimized Usage/Job | Max Jobs/Month | Status |
| ------------- | --------- | ------------------- | -------------- | ------ |
| Vercel CPU    | 14,400s   | ~1s (OCR only)      | **~14,000**    | ✅     |
| Modal CPU     | 108,000s  | ~10s (Typst)        | **~10,800**    | ✅     |
| Upstash Redis | 300K/mo   | ~15 commands        | **~20,000**    | ✅     |
| Gemini RPM    | 4,000/min | 10 requests         | **∞**          | ✅     |
| Bandwidth     | 100 GB    | ~3 MB               | **~33,000**    | ✅     |

**Conclusion**: 10,000 jobs/month is **achievable** with Modal.com for PDF generation.

---

### Performance Optimizations

Since Gemini has 4,000 RPM capacity, we can maximize parallelism:

#### Aggressive Parallel Processing

```typescript
// Client-side: process all pages in parallel
const MAX_CONCURRENT = 10; // Can go higher with 4K RPM
const results = await Promise.all(
  pages.map((page, i) => processPage(jobId, i, page.base64))
);
```

#### Batch OCR Requests

```typescript
// Server-side: batch multiple pages per request if beneficial
// Gemini can handle multiple images in one call
const result = await geminiModel.generateContent([
  SYSTEM_PROMPT,
  ...pages.map((p) => ({
    inlineData: { data: p.base64, mimeType: "image/png" },
  })),
]);
```

**Latency Improvement**:

- Current (sequential): 10 pages × 5s = 50s
- Optimized (parallel): 10 pages / 10 concurrent = ~5s total

---

### Implementation Priority

| Priority | Change                                 | Effort | Impact                  |
| -------- | -------------------------------------- | ------ | ----------------------- |
| **P0**   | Deploy Modal.com Typst service         | S-M    | Unlocks 10K+ capacity   |
| **P1**   | Remove rate limiting code              | XS     | Simplifies codebase     |
| **P2**   | Increase parallel OCR (10+ concurrent) | S      | 10x latency improvement |
| **P3**   | Remove per-page Redis locking          | S      | 5x Redis headroom       |
| **P4**   | Direct image submission (skip Blob)    | S      | 50% bandwidth reduction |

---

### Risk Mitigations

| Risk                        | Mitigation                                 |
| --------------------------- | ------------------------------------------ |
| Modal.com cold starts       | Keep service warm with periodic pings      |
| Large documents (50+ pages) | Enforce 50-page limit (Modal has time)     |
| Modal free tier exhaustion  | Monitor usage, alert at 80%                |
| Network latency to Modal    | Modal has edge locations, typically <100ms |
| Redis usage creep           | Budget ops per endpoint, add monitoring    |

---

### Alternative External Compute Options

If Modal.com doesn't fit, consider:

| Service            | Free Tier                 | Typst Support | Integration |
| ------------------ | ------------------------- | ------------- | ----------- |
| **Modal.com**      | 30 hrs/month              | ✅ Full CLI   | HTTP POST   |
| Fly.io             | 3 shared VMs              | ✅ Full CLI   | HTTP POST   |
| Railway            | $5 credit/month           | ✅ Full CLI   | HTTP POST   |
| Render             | 750 hrs/month (spin down) | ✅ Full CLI   | HTTP POST   |
| Cloudflare Workers | 100K req/day              | ❌ No CLI     | —           |

**Modal.com is recommended** for simplicity and generous free tier.

---

### Decision Log

| Decision                        | Rationale                                      | Trade-off                  |
| ------------------------------- | ---------------------------------------------- | -------------------------- |
| Modal.com for PDF generation    | 30 hrs free, full CLI, simple HTTP integration | External dependency        |
| Remove all rate limiting        | 4K RPM makes limiting unnecessary              | None                       |
| Aggressive parallelism (10+)    | 4K RPM allows high concurrency                 | Slightly higher peak load  |
| Keep server-side PDF generation | Better UX than client WASM, shareable URLs     | Requires Modal integration |
| Direct image in request body    | Eliminates Blob round-trip bandwidth           | Larger request payloads    |
| Max 50 pages per document       | Modal can handle longer jobs than Vercel       | Limits very large uploads  |

---

### Environment Variables

```bash
# Required
GEMINI_API_KEY=your-gemini-api-key
UPSTASH_REDIS_REST_URL=your-upstash-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-token

# Modal.com
MODAL_TYPST_ENDPOINT=https://your-modal-app--render-pdf.modal.run

# Optional
BLOB_READ_WRITE_TOKEN=your-vercel-blob-token
```

---

## Document Metadata

- **Version**: 2.1.0
- **Last Updated**: 2026-01-13
- **Status**: Scalability Review Complete (Modal.com Integration)
- **Author**: System Design Phase
- **Reviewer**: Architecture Optimization Pass
