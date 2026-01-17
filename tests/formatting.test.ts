import { renderToHtml, sanitizeLatex } from '@/lib/formatting';
import { wrapWithTemplate } from '@/lib/html-template';
import { DocumentIR } from '@/lib/schema';
import { describe, it, expect } from 'vitest';

describe('lib/formatting.ts (Section 2.2)', () => {
    it('FMT-009: sanitizeLatex removes delimiters', () => {
        const dirtyLatex = "\\textsuperscript{2} + \\textsubscript{i}";
        const cleanLatex = sanitizeLatex(dirtyLatex);
        expect(cleanLatex).toBe("^{2} + _{i}");
    });

    describe('renderToHtml', () => {
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

        it('FMT-002: renderToHtml heading levels', () => {
            expect(output).toContain("<h1>Introduction</h1>");
        });

        it('FMT-012/FMT-013: processContent bold/italic text', () => {
            expect(output).toContain("<strong>world</strong>");
            expect(output).toContain("<em>italic</em>");
        });

        it('FMT-010: processContent inline math', () => {
            // Inline math $x^2$ -> likely contains <span class="katex">...x^2...</span>
            // We look for katex class generally
            expect(output).toContain("katex");
        });

        it('mixed markdown and math', () => {
            expect(output).toContain("<strong>bold math</strong>");
        });

        it('FMT-003: renderToHtml math display mode', () => {
            expect(output).toContain("katex-display");
            expect(output).toContain("E");
        });

        it('FMT-007: renderToHtml container types', () => {
            expect(output).toContain('<div class="theorem">');
            expect(output).toContain("<strong>Theorem: Pythagoras</strong>");

            expect(output).toContain('<div class="proof">');
            expect(output).not.toContain("<strong>Proof</strong>"); // Proof title handled by CSS usually
        });

        it('FMT-005/006: renderToHtml lists', () => {
            // ordered list with 2 items
            expect(output).toContain("<ol>");
            expect(output).toContain("<li>First</li>");
            expect(output).toContain("<li>Second</li>");
        });

        it('FMT-015: Table rendering', () => {
            expect(output).toContain("<table>");
            expect(output).toContain("<thead>");
            expect(output).toContain('<th style="text-align: right">Header 2</th>');
            expect(output).toContain("Cell 1");
        });

        it('FMT-001: renderToHtml paragraph block', () => {
            const pDoc: DocumentIR = { metadata: { title: "", subject: "", documentType: "lecture" }, content: [{ type: 'paragraph', text: 'Hello world' }] };
            const pOut = renderToHtml(pDoc);
            expect(pOut).toContain("<p>Hello world</p>");
        });

        it('FMT-014: KaTeX error handling', () => {
            // We simulate invalid latex. The function should not throw but return error span
            const badDoc: DocumentIR = { metadata: { title: "", subject: "", documentType: "lecture" }, content: [{ type: 'math', display: true, latex: '\\invalidcommand{x}' }] };
            // Assuming renderToHtml catches katex errors and outputs valid HTML with error class
            const out = renderToHtml(badDoc);
            expect(out).toContain("color:#cc0000");
        });

        it('Watermark: wrapWithTemplate includes watermark', () => {
            const wrapped = wrapWithTemplate(output);
            expect(wrapped).toContain('<div id="watermark">https://handscriptnotes.vercel.app/</div>');
            expect(wrapped).toContain('#watermark {');
        });
    });
});
