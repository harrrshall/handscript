import { renderToTypst, sanitizeLatex } from '../lib/formatting';
import { DocumentIR } from '../lib/schema';
import assert from 'assert';

console.log("Running Formatting Tests...");

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

const output = renderToTypst(mockDoc);
const expected = `= Introduction

Hello #mitex("x") world.

#align(center)[#mitex("E = mc^2")]

#theorem("Pythagoras")[
a^2 + b^2 = c^2
]

1. First
2. Second`;

// Normalize newlines for comparison
const normalize = (s: string) => s.replace(/\n+/g, "\n").trim();

if (normalize(output) === normalize(expected)) {
    console.log("✔ Document Rendering passed");
} else {
    console.error("✘ Document Rendering failed");
    console.error("Expected:\n" + expected);
    console.error("Actual:\n" + output);
    process.exit(1);
}

console.log("All tests passed!");
