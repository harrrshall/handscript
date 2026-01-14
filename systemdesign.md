# HandScript System Design: 10× Output Quality Improvement

## Executive Summary

This document presents a comprehensive first-principles analysis of the HandScript application and proposes a complete system redesign to achieve **10× better output quality** while operating entirely within free/open-source tooling constraints.

---

## Part 1: Current System Analysis

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│[PDF Upload] → [PDF.js Extract] → [Base64 Images] → [Gemini 2.5 Flash lite]  │
│                                                                             │
│   → [Raw Markdown] → [Concatenate Pages] → [Typst + cmarker] → [PDF]        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Component Breakdown

| Component         | File                          | Role                            | Current Limitation                       |
| ----------------- | ----------------------------- | ------------------------------- | ---------------------------------------- |
| PDF Extraction    | `Upload.tsx`                  | Client-side PDF.js @ 1.5x scale | Low resolution, no pre-processing        |
| OCR/Transcription | `gemini.ts`                   | Gemini 2.5 Flash Lite batch     | Single-pass, no validation, context loss |
| Markdown Assembly | `finalize/route.ts`           | Simple concatenation            | No structure inference, no deduplication |
| PDF Rendering     | `typst/knowtube-academic.typ` | Basic cmarker template          | Minimal styling, generic layout          |
| Infrastructure    | Modal.com / Local             | Stateless Typst compile         | No caching, no asset management          |

### 1.3 Quality Audit of Current Output

Based on analysis of `mdnotes.pdf`, the current system produces output with these deficiencies:

#### Image Quality Issues

- **Resolution**: 1.5x scale in PDF.js yields ~108 DPI (vs. 300 DPI standard for OCR)
- **No preprocessing**: Skew, shadows, lighting variations passed directly to LLM
- **No noise reduction**: Ruled lines, paper texture, bleed-through degrade transcription

#### Transcription Quality Issues

- **Context fragmentation**: Each batch of 3 pages processed independently
- **No cross-page reasoning**: Equations split across pages lose coherence
- **No validation layer**: Hallucinations and OCR errors go uncorrected
- **Missing semantic structure**: Headers, definitions, theorems not tagged

#### Document Quality Issues

- **Generic template**: Same styling for all content types
- **No navigation**: No TOC, bookmarks, or cross-references
- **Poor math rendering**: LaTeX errors not caught pre-render
- **No visual hierarchy**: Definitions, theorems, examples look identical
- **Missing metadata**: No title, subject, date extraction

---

## Part 2: First-Principles Redesign

### 2.1 Core Insight

The fundamental problem is treating handwritten notes as a **transcription task** rather than a **document understanding and reconstruction task**.

**First Principle**: A beautiful PDF is not a transcription—it's a _semantic reconstruction_ of knowledge with proper:

1. **Information Architecture** (structure, hierarchy, relationships)
2. **Visual Design** (typography, spacing, emphasis)
3. **Navigability** (TOC, bookmarks, cross-references)
4. **Fidelity** (accurate math, preserved diagrams, no hallucinations)

### 2.2 Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        PROPOSED 10× PIPELINE                                        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  PHASE 1: INTELLIGENT EXTRACTION                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ [PDF] → [High-Res Extract] → [Image Preprocessing] → [Region Detection]     │  │
│  │         (3x scale, PNG24)     (deskew, denoise,       (text blocks, math,   │  │
│  │                                contrast, crop)         diagrams, tables)     │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                     │
│  PHASE 2: SEMANTIC UNDERSTANDING                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ [Full Document Context] → [Multi-Pass LLM] → [Structured Output]             │  │
│  │  (all pages as context)    (Pass 1: TOC &     (JSON schema with             │  │
│  │                             structure,         sections, math blocks,        │  │
│  │                             Pass 2: Content,   metadata, relationships)      │  │
│  │                             Pass 3: Validate)                                │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                     │
│  PHASE 3: INTELLIGENT RENDERING                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │ [Structured Data] → [Template Selection] → [Typst Compile] → [Post-Process] │  │
│  │                      (academic, notes,      (themed template    (compress,   │  │
│  │                       problem-set)          with TOC/bookmarks)  optimize)   │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Detailed Design Specifications

### 3.1 Phase 1: Intelligent Extraction

#### 3.1.1 High-Resolution Extraction

**Current**: `viewport.scale = 1.5` (~108 DPI)

**Proposed**: Dynamic scaling based on page content density

```typescript
// Proposed algorithm
function calculateOptimalScale(page: PDFPage): number {
  const baseDPI = 300; // Industry standard for OCR
  const pageWidth = page.getViewport({ scale: 1 }).width;

  // Target ~2400px width for handwritten content
  const targetWidth = 2400;
  const scale = targetWidth / pageWidth;

  // Cap at 4x to prevent memory issues
  return Math.min(scale, 4);
}
```

**Tradeoff**: Higher resolution = more tokens to Gemini, but dramatically better small-text recognition.

#### 3.1.2 Client-Side Image Preprocessing

Leverage Canvas API for zero-cost preprocessing:

| Operation                | Purpose                | Implementation                      |
| ------------------------ | ---------------------- | ----------------------------------- |
| **Deskew Detection**     | Fix tilted scans       | Hough transform on detected lines   |
| **Auto-Crop**            | Remove scanner margins | Edge detection, find content bounds |
| **Contrast Enhancement** | Improve ink visibility | Adaptive histogram equalization     |
| **Noise Reduction**      | Remove paper texture   | Bilateral filter (preserve edges)   |
| **Binarization**         | Optional for pure text | Otsu's method with local thresholds |

**Free Library**: Use **OpenCV.js** (WASM build, MIT license, runs in browser)

```typescript
// Example preprocessing pipeline
async function preprocessImage(canvas: HTMLCanvasElement): Promise<ImageData> {
  const cv = await loadOpenCV(); // Load from /public/opencv.js

  const src = cv.imread(canvas);
  const dst = new cv.Mat();

  // Convert to grayscale
  cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);

  // Denoise (non-local means)
  cv.fastNlMeansDenoising(dst, dst, 10);

  // Adaptive threshold for better contrast
  cv.adaptiveThreshold(
    dst,
    dst,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY,
    11,
    2
  );

  // Deskew using Hough lines
  const angle = detectSkewAngle(dst);
  if (Math.abs(angle) > 0.5) {
    rotateImage(dst, angle);
  }

  return dst;
}
```

#### 3.1.3 Region Detection

Before sending to LLM, segment the page into semantic regions:

```typescript
interface PageRegion {
  type: "text" | "math" | "diagram" | "table" | "margin-note";
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
}

// Use contour detection + heuristics
function detectRegions(image: cv.Mat): PageRegion[] {
  // Find contours
  const contours = cv.findContours(
    image,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE
  );

  // Classify each region by aspect ratio, density, position
  return contours.map((contour) => ({
    type: classifyRegion(contour),
    bounds: cv.boundingRect(contour),
    confidence: 0.9,
  }));
}
```

**Purpose**: Gives LLM structured hints about what it's looking at, reducing hallucinations.

---

### 3.2 Phase 2: Semantic Understanding

#### 3.2.1 Multi-Pass LLM Strategy

**Current Approach**: Single pass with generic prompt → raw markdown

**Proposed Approach**: Three-pass semantic extraction

##### Pass 1: Document Structure Analysis (FULL CONTEXT)

Send ALL page images at once with a structure-only prompt:

```typescript
const STRUCTURE_PROMPT = `
You are analyzing a complete set of handwritten academic notes.
Your task is ONLY to identify the document structure, NOT transcribe content.

Analyze all pages and return a JSON structure:

{
  "documentType": "lecture-notes" | "problem-set" | "study-guide" | "lab-report",
  "subject": "string (e.g., 'Quantum Mechanics', 'Organic Chemistry')",
  "estimatedDate": "string or null",
  "tableOfContents": [
    {
      "title": "Section name",
      "startPage": 1,
      "endPage": 3,
      "subsections": [...]
    }
  ],
  "specialElements": {
    "theorems": [{ "page": 2, "approximatePosition": "top-half" }],
    "definitions": [...],
    "examples": [...],
    "diagrams": [...],
    "equations": [...]
  }
}

DO NOT transcribe any text. Only identify structure.
`;
```

**Rationale**: By seeing ALL pages first, the LLM understands context (e.g., "Chapter 3 continues from page 5") and can make intelligent decisions about where sections begin/end.

##### Pass 2: Content Extraction (PER-SECTION)

Armed with structural knowledge, extract content section-by-section:

```typescript
const CONTENT_PROMPT = (section: Section, context: DocumentContext) => `
You are transcribing section "${section.title}" from handwritten notes on ${
  context.subject
}.

CONTEXT FROM OTHER SECTIONS:
- Previous section ended with: "${context.previousSectionEnding}"
- This section covers pages ${section.startPage}-${section.endPage}
- Known theorems in this section: ${section.theorems
  .map((t) => t.hint)
  .join(", ")}

OUTPUT FORMAT (Typst-compatible Markdown):

1. Use proper heading levels (## for section, ### for subsection)
2. Mathematical expressions:
   - Inline: $...$
   - Block: $$...$$
   - Use proper LaTeX: \\frac{}{}, \\int, \\sum, \\partial, \\vec{}, etc.
3. Special blocks (use these exact markers):
   - **Definition**: :::definition[Term]\\nContent\\n:::
   - **Theorem**: :::theorem[Name]\\nContent\\n:::
   - **Proof**: :::proof\\nContent\\n:::
   - **Example**: :::example\\nContent\\n:::
4. Diagrams: [DIAGRAM: detailed description for later recreation]
5. Unclear text: [UNCLEAR: best guess]

TRANSCRIBE NOW:
`;
```

**Key Insight**: Section-by-section extraction with global context prevents:

- Duplicated content at page boundaries
- Lost cross-references ("as shown in equation 3.2")
- Inconsistent notation (using both `x` and `X` for same variable)

##### Pass 3: Validation & Correction

Final pass reviews the assembled document:

```typescript
const VALIDATION_PROMPT = `
Review this transcribed document for:

1. **Mathematical Consistency**: Same variable should have same notation throughout
2. **LaTeX Validity**: All math expressions should compile
3. **Logical Flow**: Theorems before their proofs, definitions before usage
4. **Cross-References**: If "equation (3)" is referenced, it should exist
5. **Completeness**: No [UNCLEAR] blocks that can be resolved with context

Return corrections as JSON:
{
  "corrections": [
    {
      "location": "section 2, paragraph 3",
      "original": "$\\frac{d}{dx}$",
      "corrected": "$\\frac{\\partial}{\\partial x}$",
      "reason": "Partial derivative notation used elsewhere"
    }
  ]
}
`;
```

#### 3.2.2 Structured Output Schema

Replace raw markdown with typed JSON intermediate representation:

```typescript
interface DocumentIR {
  metadata: {
    title: string;
    subject: string;
    author?: string;
    date?: string;
    documentType: "lecture" | "problem-set" | "study-guide" | "lab-report";
  };

  sections: Section[];

  glossary: {
    term: string;
    definition: string;
    firstMention: { section: number; paragraph: number };
  }[];

  equations: {
    id: string;
    latex: string;
    label?: string;
    description?: string;
  }[];

  figures: {
    id: string;
    description: string;
    suggestedTikZ?: string; // For simple diagrams
    originalPage: number;
  }[];
}

interface Section {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  content: ContentBlock[];
}

type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "math"; latex: string; display: "inline" | "block"; label?: string }
  | { type: "definition"; term: string; content: string }
  | { type: "theorem"; name?: string; content: string }
  | { type: "proof"; content: string }
  | { type: "example"; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "diagram"; description: string; tikz?: string }
  | { type: "note"; content: string; style: "info" | "warning" | "tip" };
```

**Benefit**: Structured IR enables intelligent template selection, validation, and rich rendering.

---

### 3.3 Phase 3: Intelligent Rendering

#### 3.3.1 Template System

Replace single generic template with context-aware template selection:

##### Template: Academic Lecture Notes

```typst
// templates/academic-lecture.typ
#import "@preview/cmarker:0.1.1"
#import "@preview/mitex:0.2.5": mitex
#import "@preview/showybox:2.0.1": showybox
#import "@preview/codly:1.0.0": *

#let definition(term, body) = showybox(
  title: [*Definition:* #term],
  frame: (
    border-color: blue.darken(20%),
    title-color: blue.lighten(80%),
    body-color: blue.lighten(95%),
  ),
  body
)

#let theorem(name, body) = showybox(
  title: if name != none [*Theorem* (#name)] else [*Theorem*],
  frame: (
    border-color: purple.darken(20%),
    title-color: purple.lighten(80%),
    body-color: purple.lighten(95%),
  ),
  body
)

#let proof(body) = block(
  width: 100%,
  inset: (left: 1em),
  stroke: (left: 2pt + gray),
  [_Proof._ #body #h(1fr) $square.stroked$]
)

#let example(body) = showybox(
  title: [*Example*],
  frame: (
    border-color: green.darken(20%),
    title-color: green.lighten(80%),
    body-color: green.lighten(95%),
  ),
  body
)

#set document(
  title: sys.inputs.at("title", default: "Lecture Notes"),
  author: sys.inputs.at("author", default: "HandScript"),
)

#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2.5cm),
  header: context {
    if counter(page).get().first() > 1 {
      grid(
        columns: (1fr, auto, 1fr),
        align: (left, center, right),
        [#sys.inputs.at("subject", default: "")],
        [_#sys.inputs.at("title", default: "Notes")_],
        [Page #counter(page).display()]
      )
    }
  },
  footer: context {
    if counter(page).get().first() == 1 {
      align(center)[Generated by HandScript • #datetime.today().display()]
    }
  }
)

#set text(
  font: ("New Computer Modern", "Noto Serif"),
  size: 11pt,
)

#set heading(numbering: "1.1.1")
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  block(above: 2em, below: 1em)[
    #set text(size: 18pt, weight: "bold")
    #it
  ]
}

#set par(
  justify: true,
  leading: 0.65em,
)

#set math.equation(numbering: "(1)")

// Title page
#align(center)[
  #v(3cm)
  #text(size: 28pt, weight: "bold")[#sys.inputs.at("title", default: "Lecture Notes")]
  #v(1cm)
  #text(size: 16pt)[#sys.inputs.at("subject", default: "")]
  #v(2cm)
  #text(size: 12pt, fill: gray)[Transcribed from handwritten notes]
  #v(1fr)
]

#pagebreak()

// Table of Contents
#outline(
  title: [Contents],
  indent: auto,
  depth: 3,
)

#pagebreak()

// Main content
#let md_content = read("content.md")
#cmarker.render(
  md_content,
  math: mitex,
  smart-punctuation: true,
)
```

##### Template: Problem Set

```typst
// templates/problem-set.typ
#import "@preview/cmarker:0.1.1"
#import "@preview/mitex:0.2.5": mitex
#import "@preview/showybox:2.0.1": showybox

#let problem(number, body) = {
  v(1em)
  block(width: 100%)[
    #text(weight: "bold", size: 12pt)[Problem #number]
    #v(0.5em)
    #body
  ]
}

#let solution(body) = showybox(
  title: [*Solution*],
  frame: (
    border-color: green.darken(20%),
    title-color: green.lighten(85%),
    body-color: green.lighten(97%),
    thickness: 1pt,
  ),
  body
)

#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2cm),
  header: context {
    if counter(page).get().first() > 1 {
      line(length: 100%, stroke: 0.5pt + gray)
      v(0.3em)
      grid(
        columns: (1fr, 1fr),
        align: (left, right),
        [#sys.inputs.at("course", default: "Course")],
        [Problem Set #sys.inputs.at("pset-number", default: "")]
      )
    }
  },
  numbering: "1",
)

#set text(font: "New Computer Modern", size: 11pt)
#set par(justify: true)
#set math.equation(numbering: "(1)")

// Header
#align(center)[
  #text(size: 14pt, weight: "bold")[#sys.inputs.at("course", default: "Course Name")]
  #v(0.3em)
  #text(size: 12pt)[Problem Set #sys.inputs.at("pset-number", default: "N")]
  #v(0.5em)
  #text(size: 10pt, fill: gray)[#sys.inputs.at("date", default: "")]
]

#v(1em)
#line(length: 100%, stroke: 1pt)
#v(1em)

#let md_content = read("content.md")
#cmarker.render(
  md_content,
  math: mitex,
  smart-punctuation: true,
)
```

#### 3.3.2 Dynamic Template Selection

```typescript
function selectTemplate(documentIR: DocumentIR): string {
  const type = documentIR.metadata.documentType;

  const templateMap = {
    lecture: "academic-lecture.typ",
    "problem-set": "problem-set.typ",
    "study-guide": "study-guide.typ",
    "lab-report": "lab-report.typ",
  };

  return templateMap[type] || "academic-lecture.typ";
}
```

#### 3.3.3 Enhanced Markdown-to-Typst Pipeline

Transform the structured IR into template-ready markdown:

````typescript
function irToMarkdown(ir: DocumentIR): string {
  let output = "";

  for (const section of ir.sections) {
    output += "#".repeat(section.level) + " " + section.title + "\n\n";

    for (const block of section.content) {
      switch (block.type) {
        case "paragraph":
          output += block.text + "\n\n";
          break;

        case "math":
          if (block.display === "block") {
            output += "$$\n" + block.latex + "\n$$\n\n";
          } else {
            // Inline math handled within text
          }
          break;

        case "definition":
          output += `:::definition[${block.term}]\n${block.content}\n:::\n\n`;
          break;

        case "theorem":
          const name = block.name ? `[${block.name}]` : "";
          output += `:::theorem${name}\n${block.content}\n:::\n\n`;
          break;

        case "proof":
          output += `:::proof\n${block.content}\n:::\n\n`;
          break;

        case "example":
          output += `:::example\n${block.content}\n:::\n\n`;
          break;

        case "diagram":
          if (block.tikz) {
            output += "```tikz\n" + block.tikz + "\n```\n\n";
          } else {
            output += `> **[Diagram]** ${block.description}\n\n`;
          }
          break;
      }
    }
  }

  return output;
}
````

#### 3.3.4 Typst Package Ecosystem (All Free)

Leverage the Typst package ecosystem for enhanced rendering:

| Package                 | Purpose                                | Usage                     |
| ----------------------- | -------------------------------------- | ------------------------- |
| `@preview/showybox`     | Colored boxes for theorems/definitions | Semantic block styling    |
| `@preview/cmarker`      | Markdown rendering                     | Core markdown support     |
| `@preview/mitex`        | LaTeX math in Typst                    | Math rendering            |
| `@preview/codly`        | Code highlighting                      | For CS notes              |
| `@preview/cetz`         | Diagrams                               | Vector diagram generation |
| `@preview/physica`      | Physics notation                       | Better physics symbols    |
| `@preview/chem`         | Chemistry                              | Molecular formulas        |
| `@preview/gentle-clues` | Admonitions                            | Info/warning boxes        |

---

### 3.4 Enhanced Prompting Strategy

#### 3.4.1 Subject-Aware Prompts

Detect subject matter and inject domain-specific instructions:

```typescript
const SUBJECT_HINTS: Record<string, string> = {
  physics: `
    - Use \\vec{} for vectors, \\hat{} for unit vectors
    - Distinguish between \\partial (partial) and d (total) derivatives  
    - Use SI units with \\,\\text{unit} formatting
    - Maxwell's equations: \\nabla \\cdot, \\nabla \\times
  `,

  mathematics: `
    - Proof structure: Claim → Proof → QED
    - Use \\implies, \\iff for logical connectives
    - Sets: \\mathbb{R}, \\mathbb{N}, \\mathbb{C}
    - Functions: f: A \\to B
  `,

  chemistry: `
    - Chemical equations: \\ce{} syntax (requires mhchem)
    - Electron configurations: Use superscripts
    - Molecular formulas: C_6H_{12}O_6
  `,

  "computer-science": `
    - Use proper code blocks with language tags
    - Pseudocode: algorithm environment
    - Complexity: O(n \\log n), \\Theta(), \\Omega()
  `,
};

function getSubjectHints(subject: string): string {
  const normalized = subject.toLowerCase();
  for (const [key, hints] of Object.entries(SUBJECT_HINTS)) {
    if (normalized.includes(key)) return hints;
  }
  return "";
}
```

#### 3.4.2 Few-Shot Examples

Include before/after examples in prompts:

```typescript
const FEW_SHOT_EXAMPLES = `
EXAMPLE INPUT (description of handwritten content):
"Handwritten text showing: 'Thm: Every cont. fn on [a,b] is uniformly cont.' with proof below"

EXAMPLE OUTPUT:
:::theorem[Uniform Continuity on Closed Intervals]
Every continuous function $f: [a,b] \\to \\mathbb{R}$ is uniformly continuous.
:::

:::proof
Let $\\varepsilon > 0$ be given. Since $[a,b]$ is compact and $f$ is continuous, 
$f$ is uniformly continuous by the Heine-Cantor theorem.
:::
`;
```

---

## Part 4: Implementation Phases

### Phase 1: Quick Wins (1-2 days effort)

These improvements require minimal code changes but yield significant quality improvements:

1. **Increase PDF.js scale from 1.5x to 3x**

   - File: `app/components/Upload.tsx` line 46
   - Impact: 4x more pixels for OCR, dramatically better small-text recognition

2. **Add PNG quality optimization**

   - Replace `canvas.toDataURL('image/png')` with quality-optimized output
   - Use `image/webp` with quality 0.95 for smaller payloads with better quality

3. **Improve Typst template with showybox**

   - File: `typst/knowtube-academic.typ`
   - Add theorem/definition/example boxes
   - Add proper TOC generation
   - Impact: Immediately more visually appealing

4. **Enhance system prompt**
   - File: `lib/gemini.ts`
   - Add few-shot examples
   - Add LaTeX validation hints
   - Impact: Fewer math rendering errors

### Phase 2: Core Architecture (1 week effort)

1. **Implement structured IR**

   - Create `lib/ir.ts` with TypeScript interfaces
   - Modify LLM responses to return JSON
   - Add IR validation layer

2. **Multi-pass LLM pipeline**

   - Create `lib/semantic-pipeline.ts`
   - Implement structure pass → content pass → validation pass
   - Add cross-page context management

3. **Template system**
   - Create `typst/templates/` directory
   - Implement template selection logic
   - Add metadata injection via Typst CLI inputs

### Phase 3: Advanced Features (2 weeks effort)

1. **Client-side image preprocessing**

   - Add OpenCV.js to project
   - Implement deskew, denoise, contrast enhancement
   - Add region detection hints to LLM

2. **Equation numbering and cross-references**

   - Track equation labels in IR
   - Generate proper Typst cross-references
   - Support "as shown in equation (3)" patterns

3. **Diagram reconstruction**
   - For simple diagrams, generate TikZ/CeTZ code
   - Use LLM to describe diagram → generate vector graphics
   - Fallback to description boxes for complex diagrams

---

## Part 5: Free Tool Stack

### All Components Are Free

| Layer               | Tool                  | License     | Notes                        |
| ------------------- | --------------------- | ----------- | ---------------------------- |
| Frontend            | Next.js 16            | MIT         | Already in use               |
| PDF Processing      | PDF.js                | Apache 2.0  | Already in use               |
| Image Preprocessing | OpenCV.js             | Apache 2.0  | WASM, runs in browser        |
| LLM                 | Gemini 2.5 Flash Lite | Free tier   | 15 RPM, 1M tokens/day        |
| PDF Rendering       | Typst                 | Apache 2.0  | Local or Modal.com free tier |
| Typst Packages      | @preview/\*           | Various OSS | All free                     |
| Hosting             | Modal.com             | Free tier   | 30 hours/month GPU-free      |
| Storage             | Vercel Blob           | Free tier   | 1GB included                 |
| State               | Upstash Redis         | Free tier   | 10K commands/day             |

### Modal.com Free Tier Details

- 30 hours/month of compute (more than sufficient)
- No cold start charges
- Supports Typst compilation
- No GPU needed for PDF generation

---

## Part 6: Quality Metrics

### Before vs. After Comparison

| Metric                 | Current              | Target               | Improvement |
| ---------------------- | -------------------- | -------------------- | ----------- |
| **OCR Accuracy**       | ~85% (estimated)     | >95%                 | +12%        |
| **Math Rendering**     | ~70% correct         | >95%                 | +36%        |
| **Document Structure** | None                 | Full TOC + sections  | ∞           |
| **Visual Appeal**      | Plain text dump      | Themed, boxed        | 10×         |
| **Navigation**         | None                 | TOC + bookmarks      | ∞           |
| **Cross-references**   | None                 | Equation/figure refs | ∞           |
| **Diagram Handling**   | [DIAGRAM: desc]      | Vector/styled        | 5×          |
| **Consistency**        | Per-page, fragmented | Document-wide        | 5×          |

### Definition of 10× Improvement

1. **Readability**: From raw text to properly typeset academic document
2. **Navigability**: From linear dump to structured TOC with hyperlinks
3. **Visual Hierarchy**: From monolithic text to themed boxes and sections
4. **Math Quality**: From error-prone to validated and numbered
5. **Professional Polish**: From "screenshot dump" to "publishable notes"

---

## Part 7: Risk Mitigation

### Potential Issues and Solutions

| Risk                        | Mitigation                                        |
| --------------------------- | ------------------------------------------------- |
| Gemini rate limits          | Implement request queuing, batch efficiently      |
| Large documents (200 pages) | Process in chunks with shared context cache       |
| Complex diagrams            | Graceful fallback to styled description boxes     |
| LaTeX errors                | Pre-validation pass, common error auto-correction |
| Modal cold starts           | Use memory snapshots for Typst dependencies       |
| Typst package downloads     | Pre-cache packages in Modal image                 |

---

## Part 8: Conclusion

The proposed redesign transforms HandScript from a **transcription tool** into a **document reconstruction system**. By applying first-principles thinking:

1. **Extract Better**: Higher resolution, preprocessed images
2. **Understand Deeper**: Multi-pass semantic analysis with global context
3. **Render Smarter**: Context-aware templates with rich visual hierarchy

All components use free, open-source tools compatible with the existing Modal.com and Vercel infrastructure. The result will be PDFs that look professionally typeset—comparable to LaTeX documents—while faithfully preserving the original handwritten content.

**Expected outcome**: Output quality improvement of 10× as measured by visual appeal, navigability, accuracy, and professional polish.
