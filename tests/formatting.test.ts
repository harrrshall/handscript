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
        { type: "paragraph", text: "Hello $x$ world." },
        { type: "math", display: true, latex: "E = mc^2" },
        { type: "container", kind: "theorem", title: "Pythagoras", content: "a^2 + b^2 = c^2" },
        { type: "list", ordered: true, items: ["First", "Second"] }
    ]
};

const output = renderToHtml(mockDoc);

// Basic checks for structure
assert.ok(output.includes("<h1>Introduction</h1>"), "Heading failed");
assert.ok(output.includes("<p>Hello"), "Paragraph start failed");
// Inline math should have katex class
assert.ok(output.includes("katex"), "KaTeX class missing (math failed in paragraph)");
// Display math should be there (KaTeX usually puts it in a span/div with class katex-display or similar)
assert.ok(output.includes("katex-display"), "KaTeX display class missing");
assert.ok(output.includes("E"), "Math content 'E' missing");

// Container
assert.ok(output.includes('<div class="theorem">'), "Container div failed");
assert.ok(output.includes("<h4>Pythagoras</h4>"), "Container title failed");

// List
assert.ok(output.includes("<ol><li>First</li><li>Second</li></ol>"), "List failed");

console.log("✔ Document Rendering passed");
console.log("All tests passed!");
