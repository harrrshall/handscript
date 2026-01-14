export const KATEK_CSS_URL = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";

export const ACADEMIC_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Open+Sans:wght@400;600;700&family=Fira+Code:wght@400;500&display=swap');

  :root {
    --font-body: 'Libre Baskerville', serif;
    --font-heading: 'Open Sans', sans-serif;
    --font-mono: 'Fira Code', monospace;
    --color-text: #2c3e50;
    --color-primary: #34495e;
    
    /* Semantic Blocks Colors */
    --bg-theorem: #f3e5f5; --border-theorem: #8e24aa;
    --bg-definition: #e3f2fd; --border-definition: #1565c0;
    --bg-example: #e8f5e9; --border-example: #2e7d32;
    --bg-note: #fffde7; --border-note: #fbc02d;
    --bg-warning: #ffebee; --border-warning: #c62828;
    --border-proof: #757575;
  }

  body {
    font-family: var(--font-body);
    font-size: 11pt;
    color: var(--color-text);
    line-height: 1.6;
    margin: 0;
    padding: 2.5cm; /* A4 Standard Margins */
    max-width: 210mm;
    margin-left: auto;
    margin-right: auto;
    box-sizing: border-box;
    background: white;
  }

  @page {
    size: A4;
    margin: 2.5cm;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading);
    color: var(--color-primary);
    font-weight: 700;
  }

  h1 { font-size: 2.2em; border-bottom: 2px solid var(--color-primary); padding-bottom: 0.3em; margin-top: 1.5em; margin-bottom: 0.5em; }
  h2 { font-size: 1.8em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; margin-top: 1.5em; margin-bottom: 0.5em; page-break-after: avoid; }
  h3 { font-size: 1.4em; margin-top: 1.5em; margin-bottom: 0.5em; page-break-after: avoid; }
  h4 { font-size: 1.2em; font-style: italic; margin-top: 1.5em; margin-bottom: 0.5em; }

  p { margin-bottom: 1em; text-align: justify; widows: 2; orphans: 2; }

  /* Semantic Blocks */
  .theorem, .definition, .example, .note, .warning {
    padding: 1em;
    margin: 1.5em 0;
    border-left: 5px solid;
    border-radius: 4px;
    page-break-inside: avoid;
  }

  .theorem { background: var(--bg-theorem); border-color: var(--border-theorem); }
  .definition { background: var(--bg-definition); border-color: var(--border-definition); }
  .example { background: var(--bg-example); border-color: var(--border-example); }
  .note { background: var(--bg-note); border-color: var(--border-note); }
  .warning { background: var(--bg-warning); border-color: var(--border-warning); }

  .theorem strong, .definition strong, .example strong, .note strong, .warning strong {
      display: block;
      margin-bottom: 0.5em;
  }
  
  /* Theorem statement specifically italicized per rule */
  .theorem em, .theorem i { font-style: italic; }
  /* But often the whole content block in theorem is italicized in LaTeX/Math, 
     formatting.md says "Content: Italicized statement text". 
     We'll handle this in the content rendering or via CSS if the block is generic.
     Let's force italic for the div body of theorem if we can, but we have mixed content.
     Safest is to let formatting.ts wrap content in <em> or just rely on block class.
     Rule: "Content: Italicized statement text"
  */
  .theorem div { font-style: italic; }

  .proof {
    margin: 1.5em 0;
    padding-left: 1em;
    border-left: 3px solid var(--border-proof);
    font-style: italic;
    color: #555;
    background: transparent;
  }
  .proof::before { content: "Proof."; font-weight: bold; font-style: normal; display: block; margin-bottom: 0.5em; color: #333; }
  .proof::after { content: "∎"; float: right; }

  /* Lists */
  ul, ol { margin-top: 0.5em; margin-bottom: 1em; padding-left: 2em; }
  li { margin-bottom: 0.5em; }

  /* Tables */
  table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5em 0;
      page-break-inside: avoid;
  }
  th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
  }
  th {
      background-color: #f2f2f2;
      font-weight: bold;
      text-align: center; /* Generally headers center */
  }
  /* Rule TB-01: Header rows bold or distinct styling (handled by th) */
  /* Rule TB-03: Numerical values align at decimal (hard to do generic CSS without classes, default right for now?) */
  /* formatting.md says: Text columns left, Numerical right. 
     We can't easily distinguish without classes. 
     We'll default to left. The rendering layer should add style="text-align: right" if feasible,
     but we are doing regex parsing. 
     We'll rely on the markdown alignment syntax (:---:) to set style attributes on td/th.
  */

  /* Code */
  pre {
    background: #f5f5f5;
    padding: 1em;
    border-radius: 4px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: 10pt;
  }
  code {
    font-family: var(--font-mono);
    background: #f5f5f5;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-size: 0.9em;
  }

  /* Math */
  .katex-display { margin: 1.5em 0 !important; overflow-x: auto; overflow-y: hidden; }
  
  /* Diagrams */
  figure.diagram {
    text-align: center;
    margin: 1.5em 0;
    page-break-inside: avoid;
    border: 1px solid #ccc; /* Part 4 implied strict container? format shows text description */
    padding: 1em;
    background: #fafafa;
  }
  figure.diagram strong { display: block; margin-bottom: 1em; }
  
  figcaption { font-size: 0.9em; color: #666; margin-top: 0.5em; font-style: italic; text-align: center; }

  /* Print Specifics */
  @media print {
    body { padding: 0; margin: 0; width: 100%; max-width: none; }
    .page-break { page-break-before: always; }
  }
`;

export function wrapWithTemplate(htmlContent: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>HandScript Document</title>
  <link rel="stylesheet" href="${KATEK_CSS_URL}" crossorigin="anonymous">
  <style>
    ${ACADEMIC_CSS}
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
}
