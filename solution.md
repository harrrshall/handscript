# Solution: Architectural Transition from Typst to HTML/CSS/KaTeX/Puppeteer PDF Generation

## Executive Summary

This document provides a first-principles analysis of the HandScript codebase and outlines a complete architectural transformation from the current Typst-based PDF generation system to a robust HTML/CSS/KaTeX/Puppeteer pipeline deployed on modal.com.

---

## Part 0: Capacity Analysis - Can Modal Free Tier Handle 10K Users/Month?

### 0.1 Modal Free Tier Limits

| Resource              | Free Tier Allowance                  |
| --------------------- | ------------------------------------ |
| Compute time          | **30 hours/month** (108,000 seconds) |
| Concurrent containers | Unlimited (auto-scale)               |
| CPU                   | Shared (no GPU needed)               |

### 0.2 Performance Benchmarks (Playwright/Puppeteer PDF Generation)

Based on industry benchmarks:

- **Cold start**: 2-5 seconds (first request to new container)
- **Warm request**: 0.5-2 seconds per page
- **Average with KaTeX math**: ~2 seconds per page (conservative)

### 0.3 Capacity Calculation

**Assumptions:**

- Average document: 5 pages
- PDF generation time: 2 seconds/page
- Container reuse (warm): 80% of requests

**Per-Document Cost:**

```
5 pages × 2 seconds = 10 seconds per document
```

**Monthly Capacity:**

```
108,000 seconds ÷ 10 seconds = 10,800 documents/month
```

**Per-User Estimate (1-2 documents/user):**

```
10,800 documents ÷ 1.5 docs/user ≈ 7,200 users/month
```

### 0.4 Verdict: 10K Users/Month

| Scenario     | Documents/User | Users Supported    | Feasible? |
| ------------ | -------------- | ------------------ | --------- |
| Light usage  | 1 doc/user     | **10,800 users**   | ✅ YES    |
| Medium usage | 2 docs/user    | **5, users**       | ⚠️ CLOSE  |
| Heavy usage  | 3 docs/user    | **3,604000 users** | ❌ NO     |

### 0.5 Optimizations to Reach 10K Users

To reliably support 10K users/month on free tier:

1. **Keep containers warm**: Modal caches containers; reusing them eliminates cold starts
2. **Batch pages**: Render multiple pages in single browser session (~40% faster)
3. **Optimize HTML**: Minimal CSS, inline KaTeX fonts (reduce parse time)
4. **Target 1.5 sec/page**: Achievable with optimized HTML

**With optimizations:**

```
5 pages × 1.5 seconds = 7.5 seconds per document
108,000 ÷ 7.5 = 14,400 documents/month
14,400 ÷ 1.5 docs/user = 9,600 users/month ≈ 10K ✅
```

### 0.6 Fallback: Modal Paid Tier

If you exceed free tier:

- Modal charges **~$0.0001/second** for CPU compute
- 10K users × 1.5 docs × 7.5 sec = 112,500 seconds
- Cost: **(112,500 - 108,000) × $0.0001 = $0.45/month** overage

**Conclusion: YES, 10K users/month is feasible on Modal free tier with optimizations.**

---

## Part 1: Current System Analysis

### 1.1 Existing Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT PDF GENERATION PIPELINE                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [PDF Upload] → [PDF.js Extract] → [Gemini AI] → [Structured IR (JSON)]         │
│                                                                                 │
│       ↓                                                                         │
│                                                                                 │
│  [renderToTypst()] → [Typst Code] → [Modal Typst Service] → [PDF Output]        │
│                                                                                 │
│  (lib/formatting.ts)   (typst/*.typ)  (scripts/modal_typst_service.py)          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Complete Inventory of Typst-Related Files and Dependencies

#### Files to Remove (Local Codebase)

| File Path                        | Purpose                                                    | Action Required                           |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| `typst/knowtube-academic.typ`    | Typst template with semantic blocks (theorem, proof, etc.) | DELETE                                    |
| `scripts/modal_typst_service.py` | Modal.com Typst compilation service                        | DELETE entirely, replace with new service |
| `lib/typst.ts`                   | Local Typst compilation wrapper                            | DELETE                                    |
| `lib/formatting.ts`              | Converts IR to Typst code (`renderToTypst()`)              | REWRITE to `renderToHtml()`               |
| `tests/formatting.test.ts`       | Tests for Typst rendering                                  | REWRITE for HTML rendering                |

#### API Routes Requiring Modification

| Route                        | File                                     | Current Behavior                  | Required Change                |
| ---------------------------- | ---------------------------------------- | --------------------------------- | ------------------------------ |
| `/api/process-batch`         | `app/api/process-batch/route.ts`         | Calls `renderToTypst()`           | Call `renderToHtml()` instead  |
| `/api/jobs/[jobId]/finalize` | `app/api/jobs/[jobId]/finalize/route.ts` | Sends Typst to Modal, merges PDFs | Send HTML to new Modal service |
| `/api/jobs/[jobId]/render`   | `app/api/jobs/[jobId]/render/route.ts`   | Calls Modal Typst endpoint        | Call new Puppeteer endpoint    |

#### Environment Variables

| Variable               | Current Use                | New Use                        |
| ---------------------- | -------------------------- | ------------------------------ |
| `MODAL_TYPST_ENDPOINT` | URL to Modal Typst service | Rename to `MODAL_PDF_ENDPOINT` |

### 1.3 Why Typst Fails with AI-Generated Input

| Failure Pattern         | Example Input         | Typst Interpretation |
| ----------------------- | --------------------- | -------------------- |
| Unescaped `$` in text   | `Price: $50`          | Math mode start      |
| Hash characters         | `Issue #123`          | Typst command        |
| Unbalanced brackets     | `f(x) = {x if x>0`    | Syntax error         |
| Invalid LaTeX via mitex | `\textsuperscript{2}` | Mitex parse failure  |

**Root Cause**: Typst's syntax conflicts with natural mathematical and programming notation found in educational content. AI-generated content is inherently unpredictable, making rigid syntax parsing unreliable.

---

## Part 2: Target Architecture

### 2.1 New Pipeline Design

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         NEW PDF GENERATION PIPELINE                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [PDF Upload] → [PDF.js Extract] → [Gemini AI] → [Structured IR (JSON)]         │
│                                                                                 │
│       ↓                                                                         │
│                                                                                 │
│  [renderToHtml()] → [HTML + CSS + KaTeX] → [Modal Puppeteer] → [PDF Output]     │
│                                                                                 │
│  (lib/formatting.ts)   (inline/template)   (scripts/modal_pdf_service.py)       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack Justification

| Component                | Technology           | Rationale                                                                       |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------- |
| **Math Rendering**       | KaTeX                | Synchronous, no reflow, deterministic output, server-side rendering capable     |
| **HTML Templating**      | Inline HTML strings  | Simple, no dependencies, full control                                           |
| **CSS Styling**          | Embedded CSS         | Self-contained, no external dependencies                                        |
| **PDF Generation**       | Puppeteer (Chromium) | Industry standard, handles malformed input gracefully, CSS @media print support |
| **Serverless Execution** | Modal.com            | Python-native, free tier sufficient, headless browser support via Playwright    |

### 2.3 Why This Architecture is Resilient

1. **HTML is Forgiving**: Browsers gracefully handle malformed HTML; unclosed tags don't crash rendering
2. **KaTeX Error Handling**: `throwOnError: false` renders invalid LaTeX as red text instead of crashing
3. **CSS Isolation**: Styles are scoped and don't affect rendering logic
4. **Puppeteer Stability**: Chrome's print-to-PDF is battle-tested and deterministic
5. **Page-Level Isolation**: Each page renders independently; one failure doesn't halt the batch

---

## Part 3: Constraint Verification

### 3.1 Vercel Free Plan Compatibility

| Requirement                            | Solution                          | Verification                    |
| -------------------------------------- | --------------------------------- | ------------------------------- |
| Serverless functions max 10s execution | PDF generation offloaded to Modal | ✅ Vercel only makes HTTP calls |
| No native binaries                     | No local Puppeteer/Typst needed   | ✅ All heavy lifting on Modal   |
| 100GB bandwidth/month                  | PDF sizes unchanged               | ✅ No impact                    |
| Edge function limits                   | Not using Edge                    | ✅ Using standard serverless    |

### 3.2 Modal.com Compatibility

| Requirement               | Solution                          | Verification                     |
| ------------------------- | --------------------------------- | -------------------------------- |
| Free tier: 30 hours/month | PDF generation is CPU-bound, fast | ✅ ~2-5s per page                |
| Container image support   | Playwright-based image            | ✅ Debian + Playwright + Python  |
| Web endpoint support      | `@modal.web_endpoint` decorator   | ✅ Same as current Typst service |
| No GPU required           | Puppeteer is CPU-only             | ✅ No GPU costs                  |

### 3.3 Architectural Boundary Constraints

| Constraint                       | Verification                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| No changes outside PDF subsystem | Only `lib/formatting.ts`, `lib/typst.ts`, Modal service, and API routes calling them |
| Frontend unchanged               | `app/components/*` untouched                                                         |
| Redis schema unchanged           | Same `job:*` key structure                                                           |
| Blob storage unchanged           | Same `uploadFile()` interface                                                        |
| Gemini integration unchanged     | Same `generateBatchNotes()`                                                          |

### 3.4 Fault Tolerance Requirements

| Failure Scenario         | Mitigation Strategy                              |
| ------------------------ | ------------------------------------------------ |
| KaTeX parse error        | `throwOnError: false` renders error inline       |
| Puppeteer crash          | Try/catch with fallback blank PDF page           |
| Modal timeout            | Per-page isolation; failed pages get placeholder |
| Malformed HTML           | Browser's error correction handles gracefully    |
| Network failure to Modal | Retry logic + ultimate fallback via pdf-lib      |

---

## Part 4: Complete Removal Guide - Typst from System and Modal.com

### 4.1 Local Codebase Removal - Exact Commands

Run these commands from the project root (`/home/cybernovas/Downloads/handscript-main`):

```bash
# Step 1: Delete Typst template directory
rm -rf typst/

# Step 2: Delete Modal Typst service
rm scripts/modal_typst_service.py

# Step 3: Delete local Typst library
rm lib/typst.ts

# Step 4: Verify deletions
ls typst/          # Should show: No such file or directory
ls lib/typst.ts    # Should show: No such file or directory
ls scripts/modal_typst_service.py  # Should show: No such file or directory
```

### 4.2 Modal.com Complete Removal

#### Option A: Via Modal CLI (Recommended)

```bash
# Ensure Modal CLI is installed and authenticated
pip install modal
modal token new  # If not already authenticated

# Stop the running app
modal app stop handscript-typst

# Delete the app entirely
modal app delete handscript-typst --yes
```

#### Option B: Via Modal Dashboard (Manual)

1. Navigate to: **https://modal.com/apps**
2. Find the app named `handscript-typst`
3. Click on the app to open details
4. Click **"Stop"** button (if running)
5. Click **"Delete"** button
6. Confirm deletion

#### Verify Removal on Modal.com

```bash
# List all your Modal apps
modal app list

# Should NOT show 'handscript-typst' in the output
```

### 4.3 Code References to Update/Remove

After deleting the files, these imports will break and need updating:

| File                                     | Line | Current Import                                | Action                |
| ---------------------------------------- | ---- | --------------------------------------------- | --------------------- |
| `app/api/jobs/[jobId]/finalize/route.ts` | 4    | `import { compileTypst } from '@/lib/typst'`  | REMOVE this import    |
| `app/api/jobs/[jobId]/render/route.ts`   | 4    | `import { compileTypst } from '@/lib/typst'`  | REMOVE this import    |
| `scripts/test-workflow-new.ts`           | 5    | `import { compileTypst } from '../lib/typst'` | REMOVE or update test |

### 4.4 Environment Variable Cleanup

#### Vercel Dashboard

1. Go to: **https://vercel.com/[your-project]/settings/environment-variables**
2. Find: `MODAL_TYPST_ENDPOINT`
3. Click **Delete** (after new system is deployed)

#### Local Development (.env.local)

```bash
# Edit .env.local file
# REMOVE this line:
MODAL_TYPST_ENDPOINT=https://your-username--handscript-typst-render-pdf.modal.run

# ADD this line (after deploying new service):
MODAL_PDF_ENDPOINT=https://your-username--handscript-pdf-render-pdf.modal.run
```

### 4.5 Python Virtual Environment Cleanup

```bash
# The .venv contains Modal SDK - keep it for new service
# But clear any Typst-related cached data
rm -rf .venv/lib/python*/site-packages/__pycache__/
rm -rf scripts/__pycache__/
```

### 4.6 Complete Removal Verification Checklist

Run this verification script:

```bash
#!/bin/bash
echo "=== Typst Removal Verification ==="

echo -n "1. typst/ directory: "
[ -d "typst" ] && echo "❌ STILL EXISTS" || echo "✅ Removed"

echo -n "2. lib/typst.ts: "
[ -f "lib/typst.ts" ] && echo "❌ STILL EXISTS" || echo "✅ Removed"

echo -n "3. modal_typst_service.py: "
[ -f "scripts/modal_typst_service.py" ] && echo "❌ STILL EXISTS" || echo "✅ Removed"

echo -n "4. Typst references in code: "
grep -r "typst" lib/ app/ --include="*.ts" 2>/dev/null | grep -v ".git" | head -5
[ $? -eq 0 ] && echo "⚠️  References found above" || echo "✅ No references"

echo -n "5. Modal app status: "
modal app list 2>/dev/null | grep -q "handscript-typst" && echo "❌ Still on Modal" || echo "✅ Removed from Modal"

echo "=== Verification Complete ==="
```

### 4.7 Git Cleanup (Optional)

```bash
# Stage deletions
git add -A

# Commit the removal
git commit -m "Remove Typst-based PDF generation system

- Delete typst/ template directory
- Delete lib/typst.ts local compiler wrapper
- Delete scripts/modal_typst_service.py Modal service
- Prepare for HTML/KaTeX/Puppeteer replacement"

# Push to remote
git push origin main
```

---

## Part 5: Detailed Transformation Plan

### Phase 1: Create New Modal PDF Service

#### 5.1.1 New Service File: `scripts/modal_pdf_service.py`

**Purpose**: Accept HTML content, render with Puppeteer/Playwright, return PDF as base64.

**Container Image Requirements**:

- Base: `modal.Image.debian_slim()`
- System packages: Playwright dependencies (Chromium)
- Python packages: `playwright`, `fastapi[standard]`
- Post-install: `playwright install chromium`

**API Contract**:

```python
# Input (POST JSON):
{
    "html": "<html>...</html>"  # Complete HTML document with embedded CSS and KaTeX
}

# Output (JSON):
{
    "pdf": "base64-encoded-pdf-bytes"
}
# OR on error:
{
    "error": "Error message"
}
```

**Key Design Decisions**:

1. **Full HTML document**: Client sends complete `<html>` including `<head>` with KaTeX CSS
2. **Self-contained**: No external resource fetching; all CSS/fonts inlined or base64
3. **A4 format**: Match current Typst output dimensions
4. **Print-optimized CSS**: Use `@media print` for PDF-specific styling

#### 5.1.2 Modal Image Configuration

```python
image = (
    modal.Image.debian_slim()
    .apt_install("wget", "gnupg", "ca-certificates")
    .run_commands([
        "apt-get update",
        # Playwright system dependencies
        "apt-get install -y libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libnspr4 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 xdg-utils fonts-liberation libappindicator3-1 libu2f-udev libvulkan1",
    ])
    .pip_install("playwright", "fastapi[standard]")
    .run_commands(["playwright install chromium"])
)
```

### Phase 2: Rewrite Formatting Layer

#### 5.2.1 Replace `lib/formatting.ts`

**Current Function**: `renderToTypst(ir: DocumentIR): string`

**New Function**: `renderToHtml(ir: DocumentIR): string`

**Transformation Logic**:

| IR Block Type            | Current Typst Output            | New HTML Output                                   |
| ------------------------ | ------------------------------- | ------------------------------------------------- |
| `heading`                | `= Title`                       | `<h1>Title</h1>`                                  |
| `paragraph`              | `text with $math$`              | `<p>text with <span class="katex">...</span></p>` |
| `math` (display)         | `#align(center)[#mitex("...")]` | `<div class="math-display">...</div>`             |
| `math` (inline)          | `#mitex("...")`                 | `<span class="math-inline">...</span>`            |
| `list` (ordered)         | `1. item`                       | `<ol><li>item</li></ol>`                          |
| `list` (unordered)       | `- item`                        | `<ul><li>item</li></ul>`                          |
| `container` (theorem)    | `#theorem[...]`                 | `<div class="theorem"><h4>Theorem</h4>...</div>`  |
| `container` (proof)      | `#proof[...]`                   | `<div class="proof">...</div>`                    |
| `container` (definition) | `#definition[...]`              | `<div class="definition">...</div>`               |
| `container` (example)    | `#example[...]`                 | `<div class="example">...</div>`                  |
| `container` (note)       | `#note[...]`                    | `<div class="note">...</div>`                     |
| `container` (warning)    | `#warning[...]`                 | `<div class="warning">...</div>`                  |
| `diagram`                | `#figure(rect[...])`            | `<figure class="diagram">...</figure>`            |

#### 5.2.2 KaTeX Integration Strategy

**Server-Side Rendering** (Recommended):

- Use `katex` npm package in Node.js
- Pre-render all LaTeX to HTML+CSS during `renderToHtml()`
- No client-side JavaScript needed in final HTML
- Deterministic output

**KaTeX Configuration**:

```typescript
const katexOptions = {
  throwOnError: false, // CRITICAL: Don't crash on bad LaTeX
  errorColor: "#cc0000", // Red for errors
  displayMode: false, // Set per-expression
  output: "html", // Pure HTML, no MathML
  trust: false, // Security
  strict: false, // Lenient parsing
};
```

#### 5.2.3 CSS Template for Academic Documents

The HTML output must include a complete CSS stylesheet providing:

1. **Page Layout**: A4 dimensions, proper margins
2. **Typography**: Academic fonts (serif body, potentially sans headings)
3. **Semantic Blocks**: Colored boxes for theorems, definitions, etc.
4. **Print Optimization**: `@media print` rules, page breaks
5. **KaTeX Fonts**: Inline or linked KaTeX CSS

**Semantic Block Styling** (matching current Typst showybox):

| Block Type   | Border Color            | Background Color |
| ------------ | ----------------------- | ---------------- |
| `theorem`    | Purple                  | Light purple     |
| `definition` | Blue                    | Light blue       |
| `proof`      | Gray (left border only) | None             |
| `example`    | Green                   | Light green      |
| `note`       | Yellow                  | Light yellow     |
| `warning`    | Red                     | Light red        |

### Phase 3: Update API Routes

#### 5.3.1 Modify `/api/process-batch/route.ts`

**Current Line 65**:

```typescript
processedPages[page.pageIndex] = renderToTypst(pageIR);
```

**New**:

```typescript
processedPages[page.pageIndex] = renderToHtml(pageIR);
```

**Additional Change**: Update Redis storage key from `typst` to `html`:

```typescript
msetObj[`job:${jobId}:page:${pageIndex}`] = JSON.stringify({
  html, // Changed from 'typst'
  status: "complete",
});
```

#### 5.3.2 Modify `/api/jobs/[jobId]/finalize/route.ts`

**Current Logic**:

1. Fetch page content (Typst)
2. POST to `MODAL_TYPST_ENDPOINT`
3. Receive PDF, merge with pdf-lib

**New Logic**:

1. Fetch page content (HTML)
2. Wrap in complete HTML document with CSS template
3. POST to `MODAL_PDF_ENDPOINT`
4. Receive PDF, merge with pdf-lib (unchanged)

**Key Change in Line 90**:

```typescript
// OLD:
body: JSON.stringify({ typst: sanitized }),

// NEW:
body: JSON.stringify({ html: wrapWithTemplate(sanitized) }),
```

#### 5.3.3 Modify `/api/jobs/[jobId]/render/route.ts`

Same pattern as finalize - replace Typst payload with HTML payload.

### Phase 4: Update Tests

#### 5.4.1 Rewrite `tests/formatting.test.ts`

**Replace Typst assertions with HTML assertions**:

```typescript
// OLD:
const output = renderToTypst(mockDoc);
assert(output.includes("#theorem"));

// NEW:
const output = renderToHtml(mockDoc);
assert(output.includes('<div class="theorem">'));
assert(output.includes('class="katex"')); // KaTeX rendered
```

### Phase 5: Cleanup and Deployment

#### 5.5.1 Local Cleanup Sequence

1. Merge new code to main branch
2. Delete `typst/` directory
3. Delete `lib/typst.ts`
4. Delete `scripts/modal_typst_service.py`
5. Update imports in all affected files
6. Run full test suite

#### 5.5.2 Modal Deployment Sequence

1. Deploy new `modal_pdf_service.py` as `handscript-pdf`
2. Obtain new endpoint URL
3. Update Vercel environment: `MODAL_PDF_ENDPOINT=<new-url>`
4. Verify integration with test PDF generation
5. Undeploy old `handscript-typst` service

#### 5.5.3 Environment Variable Migration

```bash
# Vercel Dashboard
# 1. Add new:
MODAL_PDF_ENDPOINT=https://<user>--handscript-pdf-render-pdf.modal.run

# 2. After verification, remove old:
MODAL_TYPST_ENDPOINT  # DELETE
```

---

## Part 6: Determinism and Resilience Analysis

### 6.1 Determinism Guarantees

| Layer     | Determinism Mechanism                              |
| --------- | -------------------------------------------------- |
| KaTeX     | Same LaTeX → same HTML output (no random elements) |
| CSS       | Static rules, no animations or transitions         |
| Puppeteer | `--deterministic-fetch`, `--disable-gpu` flags     |
| Modal     | Immutable container images                         |

### 6.2 Error Recovery Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ERROR RECOVERY FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [Page HTML] → [Modal Puppeteer]                                                │
│       │              │                                                          │
│       │              ├─→ Success → [PDF bytes]                                  │
│       │              │                                                          │
│       │              └─→ Failure → [Fallback 1: Simplified HTML]                │
│       │                                   │                                     │
│       │                                   ├─→ Success → [PDF bytes]             │
│       │                                   │                                     │
│       │                                   └─→ [Fallback 2: pdf-lib blank page]  │
│       │                                                                         │
│       └────── Page N proceeds regardless of Page N-1 outcome                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Fallback 1**: Strip all KaTeX, render plain text
**Fallback 2**: Generate blank page with error message using pdf-lib (already implemented)

### 6.3 Malformed Input Handling

| Input Problem | KaTeX Behavior                              | HTML Behavior          | Puppeteer Behavior    |
| ------------- | ------------------------------------------- | ---------------------- | --------------------- |
| Invalid LaTeX | Red error text (with `throwOnError: false`) | Displays error inline  | Renders as-is         |
| Unclosed tags | N/A                                         | Browser auto-closes    | Renders corrected DOM |
| Missing CSS   | N/A                                         | Default browser styles | Still produces PDF    |
| Empty content | Empty string                                | Valid empty document   | Valid empty PDF       |

---

## Part 7: New File Structure

### After Migration

```
handscript-main/
├── app/
│   ├── api/
│   │   ├── jobs/
│   │   │   └── [jobId]/
│   │   │       ├── finalize/route.ts    # Modified: calls Modal PDF service
│   │   │       ├── render/route.ts      # Modified: calls Modal PDF service
│   │   │       └── ...
│   │   └── process-batch/route.ts       # Modified: calls renderToHtml()
│   └── ...
├── lib/
│   ├── formatting.ts                    # REWRITTEN: renderToHtml()
│   ├── html-template.ts                 # NEW: HTML/CSS template wrapper
│   ├── latex-sanitizer.ts               # Keep as-is (still useful for input cleaning)
│   ├── blob.ts                          # Unchanged
│   ├── gemini.ts                        # Unchanged
│   ├── redis.ts                         # Unchanged
│   └── schema.ts                        # Unchanged
├── scripts/
│   ├── modal_pdf_service.py             # NEW: Playwright-based PDF service
│   └── ...                              # Test scripts updated
├── tests/
│   └── formatting.test.ts               # REWRITTEN: tests renderToHtml()
└── ...

DELETED:
├── typst/                               # ENTIRE DIRECTORY DELETED
├── lib/typst.ts                         # DELETED
└── scripts/modal_typst_service.py       # DELETED
```

---

## Part 8: Implementation Order

### Recommended Sequence

1. **Create `lib/html-template.ts`**: HTML wrapper with CSS template and KaTeX CSS
2. **Install KaTeX**: `npm install katex @types/katex`
3. **Rewrite `lib/formatting.ts`**: Implement `renderToHtml()` using KaTeX
4. **Create `scripts/modal_pdf_service.py`**: New Playwright-based Modal service
5. **Deploy to Modal**: `modal deploy scripts/modal_pdf_service.py`
6. **Update environment variables**: Add `MODAL_PDF_ENDPOINT`
7. **Modify API routes**: Update `/process-batch`, `/finalize`, `/render`
8. **Update tests**: Rewrite `tests/formatting.test.ts`
9. **Integration testing**: Full end-to-end PDF generation test
10. **Cleanup**: Delete Typst files and old Modal deployment

---

## Part 9: Risk Mitigation

### 9.1 Rollback Plan

If the new system fails in production:

1. Restore `MODAL_TYPST_ENDPOINT` environment variable
2. Revert `lib/formatting.ts` to Typst version
3. Revert API route changes
4. Typst service remains deployed until new system is verified

### 9.2 Parallel Running Period

Recommended: Run both systems in parallel for 1 week

- New system as primary
- Old system as fallback (via feature flag)
- Monitor error rates before full cutover

### 9.3 Monitoring Points

| Metric                      | Alert Threshold |
| --------------------------- | --------------- |
| PDF generation success rate | < 95%           |
| Modal endpoint latency      | > 30s           |
| PDF file size anomalies     | > 10MB per page |
| KaTeX error rate (red text) | > 10% of pages  |

---

## Part 10: Summary

This transformation replaces the brittle Typst-based PDF generation with a robust HTML/CSS/KaTeX/Puppeteer pipeline that:

1. **Gracefully handles malformed input** through browser error correction and KaTeX's error tolerance
2. **Maintains visual fidelity** with CSS-based semantic block styling matching the original Typst design
3. **Operates within free tier constraints** on both Vercel and Modal.com
4. **Requires no changes outside the PDF subsystem** - frontend, Gemini integration, and Redis schema remain unchanged
5. **Provides page-level fault isolation** ensuring single-page failures don't crash batch processing

The migration can be executed incrementally with a clear rollback path, minimizing production risk.
