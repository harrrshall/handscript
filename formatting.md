# HandScript Formatting Rules

## Document Purpose

This document defines comprehensive formatting rules for HandScript's output generation system. These rules govern how the AI transcription system (Gemini) should structure its output and how the rendering pipeline (HTML/KaTeX/Puppeteer) should present the final PDF document.

The goal is to produce transcriptions that are:
- **Structurally clear** with logical hierarchy and semantic grouping
- **Visually clean** with consistent typography and whitespace
- **Practically useful** as study materials, reference documents, and exportable notes

---

## Part 1: Document Structure Rules

### 1.1 Page-Level Organization

| Rule ID | Rule | Rationale |
|---------|------|-----------|
| `PG-01` | Each page must be self-contained with no orphaned semantic blocks | Prevents confusion when pages are viewed independently |
| `PG-02` | Cross-page content must use explicit continuation markers | Maintains coherence across page boundaries |
| `PG-03` | Page breaks must never occur mid-equation or mid-proof | Preserves logical flow of mathematical reasoning |
| `PG-04` | Maximum content density: 60% of page area | Ensures readability and prevents visual overload |

### 1.2 Section Hierarchy

The document must follow a strict heading hierarchy:

```
# Document Title (Level 1 - Reserved for document title only)
## Major Section (Level 2 - Primary topic divisions)
### Subsection (Level 3 - Subtopic within a section)
#### Sub-subsection (Level 4 - Granular detail, use sparingly)
```

**Hierarchy Rules:**

| Rule ID | Rule |
|---------|------|
| `SH-01` | Never skip heading levels (e.g., no `##` followed directly by `####`) |
| `SH-02` | Heading text must be verbatim from source; never paraphrase or summarize |
| `SH-03` | Implicit headings (underlined text, larger handwriting) must be promoted to explicit headings |
| `SH-04` | Numbered sections in source (e.g., "3.2 Wave Functions") must preserve numbering |

### 1.3 Content Block Sequencing

Content blocks must appear in the following logical order within each section:

1. **Heading** (if applicable)
2. **Introductory prose** (context-setting paragraphs)
3. **Definitions** (foundational terms required for understanding)
4. **Theorems/Lemmas** (formal statements)
5. **Proofs** (immediately following their theorem)
6. **Examples** (illustrative applications)
7. **Problems/Exercises** (practice material)
8. **Notes/Warnings** (supplementary observations)

---

## Part 2: Semantic Block Formatting

### 2.1 Block Type Specifications

Each semantic block type has prescribed visual treatment:

#### Theorem Block
```
Visual Style:
├── Background: Light purple (#f3e5f5)
├── Left Border: 5px solid purple (#8e24aa)
├── Padding: 1em all sides
├── Title Format: "Theorem" or "Theorem: [Name]" in bold
└── Content: Italicized statement text
```

#### Definition Block
```
Visual Style:
├── Background: Light blue (#e3f2fd)
├── Left Border: 5px solid blue (#1565c0)
├── Padding: 1em all sides
├── Title Format: "Definition: [Term]" in bold
└── Content: The term being defined should be emphasized on first use
```

#### Proof Block
```
Visual Style:
├── Background: None (transparent)
├── Left Border: 3px solid gray (#757575)
├── Padding-left: 1em
├── Opening: "Proof." in bold, non-italic
├── Content: Italic text for proof body
└── Closing: Tombstone symbol (∎) right-aligned
```

#### Example Block
```
Visual Style:
├── Background: Light green (#e8f5e9)
├── Left Border: 5px solid green (#2e7d32)
├── Padding: 1em all sides
├── Title Format: "Example" or "Example: [Title]" in bold
└── Content: Standard prose with worked solutions
```

#### Note Block
```
Visual Style:
├── Background: Light yellow (#fffde7)
├── Left Border: 5px solid gold (#fbc02d)
├── Padding: 1em all sides
├── Title Format: "Note:" in bold (or "NB:", "Important:")
└── Content: Supplementary information
```

#### Warning Block
```
Visual Style:
├── Background: Light red (#ffebee)
├── Left Border: 5px solid red (#c62828)
├── Padding: 1em all sides
├── Title Format: "Warning:" or "Caution:" in bold
└── Content: Common mistakes or pitfalls to avoid
```

### 2.2 Block Nesting Rules

| Rule ID | Rule |
|---------|------|
| `BN-01` | Proofs must immediately follow their associated theorem/lemma with no intervening content |
| `BN-02` | Examples may contain nested sub-examples using lettered lists (a), (b), (c) |
| `BN-03` | Semantic blocks must not be nested inside other semantic blocks (flatten structure) |
| `BN-04` | Diagrams within semantic blocks must be described inline, not as separate blocks |

---

## Part 3: Mathematical Content Formatting

### 3.1 Display Mode Selection

| Context | Mode | Delimiter | Example |
|---------|------|-----------|---------|
| Inline (within sentence) | Inline | `$...$` | "where $x > 0$" |
| Standalone equation | Display | `$$...$$` | Centered, numbered |
| Equation reference in text | Inline | `$...$` | "From equation $F = ma$" |
| Multi-line derivation | Display | `$$\begin{aligned}...\end{aligned}$$` | Aligned steps |

### 3.2 Equation Formatting Rules

| Rule ID | Rule |
|---------|------|
| `EQ-01` | Display equations must have blank lines before and after for visual separation |
| `EQ-02` | Numbered equations use `\tag{n}` where n matches source numbering |
| `EQ-03` | Multi-step derivations use `\begin{aligned}` with `&=` alignment |
| `EQ-04` | Related equations grouped in `\begin{cases}` or `\begin{gathered}` |
| `EQ-05` | Units must use `\text{}` and thin space: `9.8\,\text{m/s}^2` |
| `EQ-06` | Vectors use `\vec{}` notation: `\vec{F}`, `\vec{v}` |
| `EQ-07` | Multi-character subscripts/superscripts must use braces: `x_{max}`, `e^{i\pi}` |

### 3.3 LaTeX Hygiene

**Required Escaping:**

| Character | Escape Sequence | Context |
|-----------|-----------------|---------|
| `%` | `\%` | Percentages in text |
| `$` | `\$` | Currency in text |
| `&` | `\&` | Outside tabular environments |
| `#` | `\#` | Hash symbols in text |
| `_` | `\_` | Underscores outside math mode |

**Spacing Commands:**

| Command | Use Case |
|---------|----------|
| `\,` | Thin space before units: `10\,\text{kg}` |
| `\;` | Medium space in integrals: `\int f(x)\;dx` |
| `\quad` | Separation between related equations |
| `\qquad` | Large separation for distinct concepts |

### 3.4 Common Symbol Standardization

| Concept | Standard Form | Avoid |
|---------|---------------|-------|
| Partial derivative | `\frac{\partial f}{\partial x}` | `df/dx` for partials |
| Gradient | `\nabla f` | `grad f` |
| Dot product | `\vec{a} \cdot \vec{b}` | `a.b` |
| Cross product | `\vec{a} \times \vec{b}` | `a x b` |
| Approximately | `\approx` | `~` or `≈` as text |
| Therefore | `\therefore` | `∴` as text |
| Because | `\because` | `∵` as text |
| Set membership | `\in` | `in` as text |
| Real numbers | `\mathbb{R}` | `R` |
| Complex numbers | `\mathbb{C}` | `C` |
| Natural numbers | `\mathbb{N}` | `N` |

---

## Part 4: Diagram and Figure Handling

### 4.1 Diagram Description Structure

When diagrams cannot be reconstructed, use this structured description format:

```
:::diagram[Descriptive Title]
**Type:** [Category from list below]

**Components:**
- [Element 1 with position/appearance]
- [Element 2 with position/appearance]
- [Labels and annotations]

**Relationships:**
- [How elements connect or interact]
- [Directional flows or dependencies]

**Labeled Values:**
- [Numerical values shown]
- [Variable names on diagram]
:::
```

### 4.2 Diagram Type Categories

| Type | Description | Common In |
|------|-------------|-----------|
| Free-body diagram | Force vectors on object | Physics |
| Circuit schematic | Electronic component connections | Electrical engineering |
| Geometric figure | Shapes with measurements | Mathematics |
| Graph/Plot | Function visualization | Mathematics, Physics |
| Flowchart | Process or algorithm steps | Computer science |
| State diagram | State machine transitions | Computer science |
| Block diagram | System component relationships | Engineering |
| Molecular structure | Chemical bonding | Chemistry |
| Phase diagram | Thermodynamic states | Chemistry, Physics |
| Vector field | Directional quantities in space | Physics, Mathematics |

### 4.3 Figure Placement Rules

| Rule ID | Rule |
|---------|------|
| `FG-01` | Figures must appear as close to their first reference as possible |
| `FG-02` | Figure captions go below the figure, centered, in italic |
| `FG-03` | Figure numbering follows section: "Figure 3.2" = second figure in section 3 |
| `FG-04` | Diagrams spanning multiple concepts should be placed at section boundaries |

---

## Part 5: Table Formatting

### 5.1 Table Structure

```markdown
| Header 1 | Header 2 | Header 3 |
|:---------|:--------:|----------:|
| Left     | Center   | Right     |
```

**Alignment Convention:**
- Text columns: left-aligned (`:---`)
- Numerical data: right-aligned (`---:`)
- Labels/categories: center-aligned (`:---:`)

### 5.2 Table Content Rules

| Rule ID | Rule |
|---------|------|
| `TB-01` | Tables must have header rows with bold or distinct styling |
| `TB-02` | Units should appear in header, not repeated in each cell |
| `TB-03` | Numerical values should align at decimal point |
| `TB-04` | Empty cells use `—` (em-dash), not blank |
| `TB-05` | Math expressions in cells use inline mode |

### 5.3 Table with Mathematical Content Example

```markdown
| Variable | Symbol | Value | Units |
|:---------|:------:|------:|:------|
| Force    | $F$    | $100$ | N     |
| Mass     | $m$    | $10$  | kg    |
| Acceleration | $a$ | $10$ | m/s² |
```

---

## Part 6: List Formatting

### 6.1 Unordered Lists

Use for items without inherent sequence:
- Consistent bullet style within a list level
- Indent child items with 2-space increase
- No trailing punctuation unless complete sentences

```markdown
- First item
- Second item
  - Sub-item A
  - Sub-item B
- Third item
```

### 6.2 Ordered Lists

Use for sequential steps, ranked items, or numbered references:

```markdown
1. First step
2. Second step
   a. Sub-step A
   b. Sub-step B
3. Third step
```

**Numbering Rules:**

| Rule ID | Rule |
|---------|------|
| `LS-01` | Preserve source numbering even if non-sequential (e.g., "Steps 1, 3, 5") |
| `LS-02` | Nested numbered lists use letters (a, b, c) then roman numerals (i, ii, iii) |
| `LS-03` | Problem numbers from source must be preserved exactly |

### 6.3 Definition Lists

For term-definition pairs:

```markdown
**Term 1**
: Definition of term 1

**Term 2**
: Definition of term 2
```

---

## Part 7: Text Formatting

### 7.1 Emphasis Hierarchy

| Visual Cue in Source | Markdown Representation |
|----------------------|-------------------------|
| Underlined text | `**bold**` |
| Boxed/circled text | `**bold**` or semantic block |
| Larger handwriting | Heading or `**bold**` |
| Different color ink | `*italic*` or note |
| Crossed out | `~~strikethrough~~` |
| Written in margin | `> **[Margin]:** content` |

### 7.2 Special Text Elements

**Inline code** for:
- Variable names in programming context
- File paths
- Command-line inputs
- Technical identifiers

**Block quotes** for:
- Quoted passages
- Margin annotations
- Referenced definitions from external sources

### 7.3 Cross-References

When the source references other content:

| Reference Type | Format |
|----------------|--------|
| "See equation (5)" | "See equation (5)" — preserve verbatim |
| "From theorem above" | "From theorem above" — do not hyperlink |
| "Page 3" | Omit unless contextually critical |
| "Section 2.1" | Preserve section reference exactly |

---

## Part 8: Uncertainty Markers

### 8.1 Confidence Levels

| Confidence | Marker | Use Case |
|------------|--------|----------|
| High (>95%) | No marker | Clearly legible content |
| Medium (70-95%) | `[?content?]` | Likely correct but uncertain |
| Low (30-70%) | `[UNCLEAR: interpretation]` | Multiple possible readings |
| None (<30%) | `[ILLEGIBLE]` | Cannot determine content |
| Damaged | `[SMUDGED: visible portion]` | Physically obscured |

### 8.2 Uncertainty Marker Rules

| Rule ID | Rule |
|---------|------|
| `UC-01` | Never guess at illegible content; always mark uncertainty |
| `UC-02` | For ambiguous math symbols, provide most likely interpretation with marker |
| `UC-03` | Uncertainty markers must not break LaTeX syntax (place outside `$...$`) |
| `UC-04` | Multiple interpretations: `[UNCLEAR: "entropy" or "enthalpy"]` |

---

## Part 9: Typography and Visual Spacing

### 9.1 Font Specifications

| Element | Font Family | Size | Weight |
|---------|-------------|------|--------|
| Body text | Libre Baskerville (serif) | 11pt | Regular |
| Headings | Open Sans (sans-serif) | Variable | Bold |
| Code/monospace | Fira Code | 10pt | Regular |
| Math | KaTeX default | Contextual | — |

### 9.2 Heading Sizes

| Level | Size | Additional Styling |
|-------|------|--------------------|
| H1 | 2.2em | Border-bottom 2px |
| H2 | 1.8em | Border-bottom 1px |
| H3 | 1.4em | None |
| H4 | 1.2em | Italic |

### 9.3 Spacing Rules

| Element | Margin Top | Margin Bottom |
|---------|------------|---------------|
| Heading | 1.5em | 0.5em |
| Paragraph | 0 | 1em |
| Semantic block | 1.5em | 1.5em |
| Display equation | 1.5em | 1.5em |
| List | 0.5em | 1em |
| List item | 0 | 0.5em |

### 9.4 Page Margins

```
A4 Paper (210mm × 297mm):
├── Top margin: 2.5cm
├── Bottom margin: 2.5cm
├── Left margin: 2.5cm
└── Right margin: 2.5cm

Content area: 160mm × 247mm
```

---

## Part 10: Page Layout Rules

### 10.1 Page Break Control

| Content Type | Page Break Rule |
|--------------|-----------------|
| Major section (H2) | May force page break before |
| Semantic block | Never break inside (`page-break-inside: avoid`) |
| Diagram + caption | Keep together |
| Theorem + proof | Keep together if space permits |
| Table | Never break mid-row |

### 10.2 Orphan/Widow Control

| Rule ID | Rule |
|---------|------|
| `PB-01` | Minimum 2 lines of paragraph on any page |
| `PB-02` | No single-line paragraphs at page bottom |
| `PB-03` | Heading must have at least 2 lines of content below on same page |

### 10.3 Column Layout

- **Default**: Single-column layout for all content
- **Exception**: Side-by-side content only when source explicitly shows parallel columns
- **Margin notes**: Rendered as indented blockquotes in main flow

---

## Part 11: Multi-Page Document Rules

### 11.1 Cross-Page Continuations

When content spans pages, use explicit markers:

**Starting on page N:**
```markdown
<!-- continues on next page -->
```

**Continuing on page N+1:**
```markdown
<!-- continues from previous page -->
```

**For split equations:**
```
Page N:   $F = ma = m\frac{dv}{dt} = \cdots$ <!-- continues on next page -->
Page N+1: <!-- continues from previous page --> $\cdots = \frac{d(mv)}{dt} = \frac{dp}{dt}$
```

### 11.2 Page Delimiter

Between processed pages, use exactly:
```
---PAGE_BREAK---
```

No content, whitespace, or formatting before or after the delimiter on its line.

---

## Part 12: Output Validation Checklist

Before finalizing any page output, verify:

### 12.1 Syntax Validation

- [ ] Every `$` has a matching `$`
- [ ] Every `$$` has a matching `$$`
- [ ] Every `\begin{...}` has a matching `\end{...}`
- [ ] Every `{` has a matching `}`
- [ ] Every `[` has a matching `]`
- [ ] Every `:::` block opener has a closing `:::`
- [ ] All heading levels are in proper sequence

### 12.2 Content Validation

- [ ] No content added that doesn't appear in source
- [ ] No content omitted that appears in source
- [ ] Semantic blocks match source labeling (don't infer "theorem" if not labeled)
- [ ] All uncertainty markers are syntactically valid
- [ ] Page break markers are correctly placed

### 12.3 Formatting Validation

- [ ] Consistent heading hierarchy
- [ ] Proper math mode selection (inline vs. display)
- [ ] Units formatted with `\text{}` and thin space
- [ ] Tables have proper alignment specification
- [ ] Lists maintain consistent styling

---

## Part 13: Error Recovery Guidelines

### 13.1 Rendering Failures

When KaTeX fails to render:
1. The `throwOnError: false` option renders error as red text
2. This is acceptable—preserves content visibility
3. Do not suppress or hide error indicators

### 13.2 Content Ambiguity

When source content is ambiguous:
1. Prioritize most likely interpretation
2. Mark with appropriate uncertainty level
3. Never fabricate missing content

### 13.3 Structural Ambiguity

When document structure is unclear:
1. Use paragraph blocks as default
2. Promote to semantic blocks only with clear source indicators
3. Prefer flat structure over inferred nesting

---

## Part 14: Domain-Specific Conventions

### 14.1 Physics

| Convention | Implementation |
|------------|----------------|
| Vectors | `\vec{F}`, `\vec{v}`, `\vec{a}` |
| Unit vectors | `\hat{i}`, `\hat{j}`, `\hat{k}` |
| Time derivatives | `\dot{x}`, `\ddot{x}` |
| Partial derivatives | `\frac{\partial f}{\partial x}` |
| Units | `\,\text{unit}` pattern |
| Constants | `c`, `h`, `\hbar`, `k_B`, `\epsilon_0`, `\mu_0` |

### 14.2 Mathematics

| Convention | Implementation |
|------------|----------------|
| Set notation | `\{x \in \mathbb{R} : x > 0\}` |
| Functions | `f: A \to B` |
| Logical connectives | `\implies`, `\iff`, `\forall`, `\exists` |
| Proof endings | QED symbol (∎) auto-appended to proof blocks |
| Sequences | `\{a_n\}_{n=1}^{\infty}` |

### 14.3 Chemistry

| Convention | Implementation |
|------------|----------------|
| Chemical formulas | Standard subscripts: `H_2O`, `C_6H_{12}O_6` |
| Reaction arrows | `\to`, `\leftrightarrow` |
| Equilibrium | `\rightleftharpoons` |
| State indicators | `\text{(g)}`, `\text{(l)}`, `\text{(s)}`, `\text{(aq)}` |

### 14.4 Computer Science

| Convention | Implementation |
|------------|----------------|
| Complexity | `O(n)`, `\Theta(n \log n)`, `\Omega(1)` |
| Pseudocode | Fenced code block with `pseudocode` language |
| Algorithms | Named blocks with numbered steps |
| Binary | Prefix with `0b` or use subscript: `1010_2` |

---

## Part 15: Summary of Rule Categories

| Category | Rule ID Prefix | Count | Priority |
|----------|----------------|-------|----------|
| Page-level | `PG-` | 4 | High |
| Section hierarchy | `SH-` | 4 | High |
| Block nesting | `BN-` | 4 | Medium |
| Equations | `EQ-` | 7 | Critical |
| Figures | `FG-` | 4 | Medium |
| Tables | `TB-` | 5 | Medium |
| Lists | `LS-` | 3 | Low |
| Uncertainty | `UC-` | 4 | High |
| Page breaks | `PB-` | 3 | Medium |

**Priority Legend:**
- **Critical**: Violations cause rendering failures
- **High**: Violations significantly degrade quality
- **Medium**: Violations affect aesthetics
- **Low**: Violations are minor stylistic issues

---

## Appendix A: Quick Reference Card

### Essential LaTeX Commands

```latex
% Fractions
\frac{a}{b}

% Roots
\sqrt{x}, \sqrt[n]{x}

% Subscripts/Superscripts
x_{max}, e^{i\pi}, a_n^{(k)}

% Sums/Products/Integrals
\sum_{i=1}^{n}, \prod_{j=1}^{m}, \int_{a}^{b} f(x)\,dx

% Greek
\alpha, \beta, \gamma, \delta, \epsilon, \theta, \lambda, \mu, \pi, \sigma, \omega
\Gamma, \Delta, \Theta, \Lambda, \Sigma, \Omega

% Operators
\pm, \times, \div, \cdot, \neq, \approx, \leq, \geq, \ll, \gg

% Vectors
\vec{v}, \hat{n}, \mathbf{F}

% Sets
\in, \notin, \subset, \subseteq, \cup, \cap, \setminus

% Logic
\implies, \iff, \forall, \exists, \neg, \land, \lor
```

### Semantic Block Syntax

```markdown
:::theorem[Optional Title]
Statement
:::

:::proof
Proof steps...
:::

:::definition[Term]
Definition text...
:::

:::example[Optional Title]
Example content...
:::

:::note
Supplementary information...
:::

:::warning
Cautionary information...
:::

:::diagram[Title]
**Type:** ...
**Components:** ...
**Relationships:** ...
**Labeled Values:** ...
:::
```

---

## Appendix B: Color Palette Reference

| Element | Background | Border |
|---------|------------|--------|
| Theorem | `#f3e5f5` | `#8e24aa` |
| Definition | `#e3f2fd` | `#1565c0` |
| Example | `#e8f5e9` | `#2e7d32` |
| Note | `#fffde7` | `#fbc02d` |
| Warning | `#ffebee` | `#c62828` |
| Proof | transparent | `#757575` |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Initial | Comprehensive formatting rules established |
