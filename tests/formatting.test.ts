import { renderToHtml, sanitizeLatex } from '../lib/formatting';
import { DocumentIR } from '../lib/schema';
import assert from 'assert';

console.log("Running Formatting Tests (HTML)...");

// Test 1: Sanitize LaTeX
const dirtyLatex = "\\textsuperscript{2} + \\textsubscript{i}";
const cleanLatex = sanitizeLatex(dirtyLatex);
assert.strictEqual(cleanLatex, "^{2} + _{i}", "LaTeX sanitization failed");
console.log("✔ Sanitize LaTeX passed");

// Test 2: Full Document Rendering
const mockDoc: DocumentIR = {
    metadata: {
        title: "Test Document",
        subject: "Math",
        documentType: "lecture"
    },
    content: [
        { type: "heading", level: 1, text: "Introduction" },
        { type: "paragraph", text: "Hello **world**. This is *italic*." },
        { type: "paragraph", text: "Inline math $x^2$ and **bold math** $y$." },
        { type: "math", display: true, latex: "E = mc^2" },
        { type: "container", kind: "theorem", title: "Pythagoras", content: "a^2 + b^2 = c^2" },
        { type: "container", kind: "proof", content: "Assume left side..." },
        { type: "list", ordered: true, items: ["First", "Second"] },
        // Test Table
        { type: "paragraph", text: "Here is a table:\n| Header 1 | Header 2 |\n|:---|---:|\n| Cell 1 | Cell 2 |\n| Left | Right |" }
    ]
};

const output = renderToHtml(mockDoc);

// Basic checks for structure
assert.ok(output.includes("<h1>Introduction</h1>"), "Heading failed");

// Markdown checks
assert.ok(output.includes("<strong>world</strong>"), "Markdown bold failed");
assert.ok(output.includes("<em>italic</em>"), "Markdown italic failed");

// Math checks
assert.ok(output.includes("katex"), "KaTeX class missing (math failed in paragraph)");
// Check inline math extraction validity
// The Math should have been rendered. $x^2$ -> likely contains <span class="katex">...x^2...</span>
// and "bold math" -> <strong>bold math</strong>
assert.ok(output.includes("<strong>bold math</strong>"), "Markdown bold inside mixed text failed");

// Display math
assert.ok(output.includes("katex-display"), "KaTeX display class missing");
assert.ok(output.includes("E"), "Math content 'E' missing");

// Container checks
assert.ok(output.includes('<div class="theorem">'), "Container div failed");
// Specific title check
assert.ok(output.includes("<strong>Theorem: Pythagoras</strong>"), "Theorem title format failed: " + output.match(/<strong>Theorem.*?<\/strong>/));
// Proof check: Should NOT have generated title (CSS handles it)
assert.ok(!output.includes("<strong>Proof</strong>"), "Proof should not have generated title in HTML");
assert.ok(output.includes('<div class="proof">'), "Proof div failed");

// Table checks
assert.ok(output.includes("<table>"), "Table tag missing");
assert.ok(output.includes("<thead>"), "Thead missing");
assert.ok(output.includes('<th style="text-align: right">Header 2</th>'), "Header alignment failed");
assert.ok(output.includes("Cell 1"), "Table cell content missing");

console.log("✔ Document Rendering passed");
console.log("All tests passed!");
