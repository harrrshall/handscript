# Root Cause Analysis & Solution Design

## Executive Summary

The error is caused by **unsupported LaTeX commands** in the Gemini-generated Markdown being passed to the `mitex` package in Typst. The `\textsuperscript` command is not supported by `mitex`, which crashes the entire rendering pipeline. A secondary issue is the missing local fallback—the `typst` binary is not installed on the Vercel serverless runtime.

---

## Part 1: Error Chain Analysis

### Primary Error: `\textsuperscript` Command Unsupported

```
error: plugin errored with: error: unknown command: \textsuperscript
   ┌─ @preview/mitex:0.2.5/mitex.typ:18:8
```

**What happened:**
1. Gemini transcribed handwritten notes and output LaTeX math containing `\textsuperscript{...}`
2. The Markdown was sent to Modal.com's Typst service
3. `cmarker` (Markdown renderer) delegated math parsing to `mitex`
4. `mitex` v0.2.5 does not support `\textsuperscript`—it only supports a subset of LaTeX math commands
5. The WASM plugin threw a fatal error, crashing the entire Typst compilation

**Root Cause:** The LLM (Gemini) is instructed to use "LaTeX syntax" for math, but there is **no constraint on which LaTeX commands are valid**. The prompt contains extensive LaTeX examples but does not warn against commands that `mitex` cannot handle.

### Secondary Error: Local Fallback Failed

```
/bin/sh: line 1: typst: command not found
```

**What happened:**
1. After Modal rendering failed, `finalize/route.ts` attempts a local fallback via `compileTypst()`
2. `lib/typst.ts` runs `exec('typst compile main.typ output.pdf')`
3. Typst is not installed on the Vercel serverless runtime
4. The fallback crashes, and the entire job fails

**Root Cause:** The local fallback was designed for development environments. It was never meant to work on Vercel's production runtime, but there's no guard to detect/skip this path.

---

## Part 2: Architectural Vulnerabilities

### Vulnerability 1: Unvalidated LLM Output

```
Gemini → Raw Markdown/LaTeX → Typst
         ↑
         No validation layer
```

The system trusts Gemini's output completely. Any invalid LaTeX, malformed Markdown, or unsupported command will crash rendering.

**Similar issues waiting to happen:**
- `\textbf{}` (text commands inside math mode)
- `\phantom{}`, `\hspace{}`, `\vspace{}`
- `\stackrel{}`, `\overset{}` (depending on mitex version)
- Custom macros Gemini might invent
- Unbalanced delimiters (`$...$` without closing)

### Vulnerability 2: Single-Point Rendering Failure

The current flow has no error isolation:

```
┌─────────────────────────────────────────────────────┐
│  All pages assembled → Single Typst compile call    │
│                              ↓                      │
│              One bad equation = Total failure       │
└─────────────────────────────────────────────────────┘
```

A single invalid LaTeX expression in a 50-page document causes the entire job to fail.

### Vulnerability 3: Non-Functional Fallback

```typescript
// finalize/route.ts lines 126-135
if (modalEndpoint) {
    try { ... }
    catch (renderError) {
        pdfUrl = await compileTypst(assembledMarkdown, jobId);  // ← Will always fail on Vercel
    }
}
```

The fallback to local Typst only works in local development—it's dead code in production.

### Vulnerability 4: No Error Context Preservation

When rendering fails, the error message contains the Typst stack trace but not:
- Which page caused the error
- Which specific LaTeX expression failed
- A way to retry without the problematic content

---

## Part 3: Proposed Solution Architecture

### Strategy: Defense in Depth with Graceful Degradation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROPOSED RENDERING PIPELINE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Layer 1: LLM Output Constraint                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Update system prompt with explicit mitex-supported command list      │  │
│  │  Add negative examples: "NEVER use \textsuperscript, use ^{} instead" │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Layer 2: Pre-Render Sanitization                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  LaTeX Sanitizer Module:                                               │  │
│  │  - Regex-based replacement of known unsupported commands              │  │
│  │  - \textsuperscript{x} → ^{x}                                         │  │
│  │  - \textsubscript{x} → _{x}                                           │  │
│  │  - Strip unsupported formatting commands                              │  │
│  │  - Validate balanced delimiters                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Layer 3: Page-Level Rendering Isolation                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Render each page independently:                                       │  │
│  │  - Success: Include rendered content                                  │  │
│  │  - Failure: Include fallback with raw text + error note               │  │
│  │  - Never let one page kill the entire document                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Layer 4: Remove Dead Fallback Code                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  - Remove local typst fallback from production code                   │  │
│  │  - If Modal fails, return meaningful error to user                    │  │
│  │  - Or: Use a secondary Modal endpoint as true fallback                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 4: Detailed Solution Components

### 4.1 Update System Prompt (Layer 1)

Add explicit constraints to `lib/gemini.ts` SYSTEM_PROMPT:

```markdown
═══════════════════════════════════════════════════════════════════════════════
                     LATEX COMMAND RESTRICTIONS (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════

The rendering system uses a LIMITED LaTeX subset. You MUST avoid these commands:

FORBIDDEN COMMANDS (will cause rendering failure):
• \textsuperscript{} → USE: ^{}  instead (e.g., 2^{nd} not \textsuperscript{nd})
• \textsubscript{} → USE: _{}  instead
• \textbf{} inside math → USE: \mathbf{}
• \textit{} inside math → USE: \mathit{}
• \text{} with nested commands → USE: plain \text{simple text only}
• \phantom{}, \hspace{}, \vspace{} → OMIT spacing commands
• \ensuremath{} → OMIT, assume math mode
• \stackrel{} → USE: \overset{} or \underset{} 
• Custom or obscure LaTeX packages

SAFE COMMANDS (verified supported):
• Basic: ^{}, _{}, \frac{}, \sqrt{}, \sqrt[n]{}
• Greek: \alpha through \omega, \Gamma through \Omega
• Operators: \sum, \prod, \int, \lim, \log, \sin, \cos, etc.
• Relations: =, \neq, \leq, \geq, \approx, \equiv, \propto
• Arrows: \to, \rightarrow, \leftarrow, \Rightarrow, \Leftrightarrow
• Sets: \in, \notin, \subset, \cup, \cap, \emptyset
• Formatting: \vec{}, \hat{}, \bar{}, \dot{}, \ddot{}
• Environments: aligned, cases, pmatrix, bmatrix, vmatrix
• Text in math: \text{simple text} (no nested commands)

When in doubt, use simpler notation. A working equation is better than a failed render.
```

### 4.2 LaTeX Sanitizer Module (Layer 2)

Create a new module `lib/latex-sanitizer.ts`:

```
┌─────────────────────────────────────────────────────────────────┐
│                    LaTeX Sanitizer Pipeline                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Input: Raw Markdown with LaTeX                                 │
│         ↓                                                       │
│  Step 1: Extract math blocks (inline $...$ and display $$...$$) │
│         ↓                                                       │
│  Step 2: Apply command replacements:                            │
│         • \textsuperscript{x} → ^{x}                            │
│         • \textsubscript{x} → _{x}                              │
│         • \textbf{x} → \mathbf{x} (in math)                     │
│         • \textit{x} → \mathit{x} (in math)                     │
│         • Strip \phantom, \hspace, \vspace                      │
│         ↓                                                       │
│  Step 3: Validate balanced delimiters                           │
│         • Count $, $$, \begin{}, \end{}                         │
│         • Flag unbalanced expressions                           │
│         ↓                                                       │
│  Step 4: Escape/neutralize remaining unknown commands           │
│         • \unknownCommand{...} → [unknownCommand: ...]          │
│         ↓                                                       │
│  Output: Sanitized Markdown safe for mitex                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Transformations:**

| Unsupported Command | Replacement | Notes |
|---------------------|-------------|-------|
| `\textsuperscript{x}` | `^{x}` | Works in math mode |
| `\textsubscript{x}` | `_{x}` | Works in math mode |
| `\textbf{x}` (in math) | `\mathbf{x}` | Different command |
| `\textit{x}` (in math) | `\mathit{x}` | Different command |
| `\phantom{x}` | `` (remove) | Spacing hack |
| `\hspace{x}` | `\,` or `` | Simplify |
| `\vspace{x}` | `` (remove) | Remove |
| `\mbox{x}` | `\text{x}` | Equivalent |
| `\ensuremath{x}` | `x` | Strip wrapper |

### 4.3 Page-Level Rendering Isolation (Layer 3)

Restructure the rendering pipeline:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      ISOLATED PAGE RENDERING FLOW                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  For each page in document:                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  1. Extract page content from assembled markdown                       │  │
│  │  2. Sanitize LaTeX (Layer 2)                                           │  │
│  │  3. Attempt Typst render via Modal:                                    │  │
│  │     ├─ Success: Get rendered PDF fragment or Typst content             │  │
│  │     └─ Failure:                                                        │  │
│  │         a. Log error with page number                                  │  │
│  │         b. Apply more aggressive sanitization (strip all math)         │  │
│  │         c. Retry render                                                │  │
│  │         d. If still fails: Insert placeholder page with:               │  │
│  │            - "This page could not be rendered"                         │  │
│  │            - Raw text content (non-formatted)                          │  │
│  │            - Error details in small print                              │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  Assemble all pages (successful + fallback) into final PDF                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Alternative: Single-Compile with Math Fallback in Typst Template**

Instead of per-page rendering, modify the Typst template to catch math errors:

```typst
// In template: wrap mitex with error handling
#let safe-math(content) = {
  // Typst doesn't have try-catch, but cmarker could provide a 
  // fallback mechanism via the math parameter
}
```

Since Typst lacks try-catch, the cleaner approach is **pre-validation in Node.js**.

### 4.4 Remove Non-Functional Fallback (Layer 4)

Current broken pattern:

```typescript
// finalize/route.ts
catch (renderError) {
    if (modalEndpoint) {
        pdfUrl = await compileTypst(assembledMarkdown, jobId);  // Always fails on Vercel
    }
}
```

**Proposed replacement:**

```
┌─────────────────────────────────────────────────────────────────┐
│                   PRODUCTION FALLBACK STRATEGY                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Option A: No Fallback (Recommended for Simplicity)             │
│  - Remove local typst call entirely                             │
│  - Return clear error to user: "Rendering failed: [reason]"     │
│  - Include sanitized markdown as downloadable fallback          │
│                                                                 │
│  Option B: Secondary Modal Endpoint                             │
│  - Deploy a "fallback" Modal function with stricter settings    │
│  - Uses plain Typst (no cmarker/mitex) for raw text render      │
│  - Produces basic but guaranteed-working output                 │
│                                                                 │
│  Option C: Client-Side Fallback                                 │
│  - Return assembled Markdown to client                          │
│  - Use browser-based PDF generation (jsPDF, pdfmake)            │
│  - Lower quality but always works                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 5: Implementation Priority

### Immediate (Fixes Current Error)

| Priority | Component | Effort | Impact |
|----------|-----------|--------|--------|
| P0 | Add `\textsuperscript` to prompt forbidden list | 5 min | Prevents this exact error |
| P0 | Add LaTeX sanitizer with textsuperscript→^{} | 1 hour | Fixes existing bad content |
| P1 | Remove broken local fallback | 10 min | Eliminates confusing error |

### Short-Term (Prevents Related Errors)

| Priority | Component | Effort | Impact |
|----------|-----------|--------|--------|
| P1 | Full LaTeX command whitelist in prompt | 1 hour | Prevents LLM from using unsupported commands |
| P1 | Comprehensive sanitizer (10+ replacements) | 2 hours | Catches common mistakes |
| P2 | Balanced delimiter validation | 1 hour | Prevents syntax errors |

### Medium-Term (Robust Architecture)

| Priority | Component | Effort | Impact |
|----------|-----------|--------|--------|
| P2 | Per-page error isolation | 4 hours | One bad page doesn't kill job |
| P2 | Meaningful fallback (Option A or B) | 2 hours | Graceful degradation |
| P3 | Pre-render validation endpoint | 4 hours | Catch errors before final render |

---

## Part 6: Testing Strategy

### Regression Tests to Add

1. **Unsupported Command Test**
   - Input: Markdown with `\textsuperscript{2}`
   - Expected: Sanitizer converts to `^{2}`, render succeeds

2. **Balanced Delimiter Test**
   - Input: Markdown with unmatched `$`
   - Expected: Validation flags error, provides location

3. **Page Isolation Test**
   - Input: 3-page document, page 2 has fatal LaTeX error
   - Expected: Pages 1 and 3 render, page 2 shows fallback

4. **Empty/Missing Fallback Test**
   - Input: Modal service unreachable
   - Expected: Meaningful error returned (not "command not found")

---

## Part 7: Monitoring Additions

Add structured logging for render pipeline visibility:

```
┌─────────────────────────────────────────────────────────────────┐
│                      LOGGING ADDITIONS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Pre-Render:                                                    │
│  - { event: "SanitizerApplied", replacements: 3, jobId }        │
│  - { event: "ValidationPassed", mathBlocks: 12, jobId }         │
│  - { event: "ValidationFailed", errors: [...], jobId }          │
│                                                                 │
│  Render:                                                        │
│  - { event: "RenderAttempt", page: 1, method: "Modal", jobId }  │
│  - { event: "RenderSuccess", page: 1, durationMs: 450, jobId }  │
│  - { event: "RenderFailed", page: 2, error: "...", jobId }      │
│  - { event: "FallbackUsed", page: 2, type: "plaintext", jobId } │
│                                                                 │
│  Post-Render:                                                   │
│  - { event: "JobComplete", pagesOk: 49, pagesFailed: 1, jobId } │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Conclusion

The `\textsuperscript` error is a symptom of a deeper architectural gap: **no validation layer between LLM output and Typst rendering**. The solution requires:

1. **Prompt Engineering**: Tell Gemini what it *cannot* use
2. **Sanitization Layer**: Transform unsupported commands automatically  
3. **Error Isolation**: Don't let one page kill the entire job
4. **Remove Dead Code**: The local Typst fallback will never work on Vercel

These changes ensure that when the next unsupported LaTeX command appears (and it will), the system degrades gracefully rather than failing completely.
