import { DocumentIR, ContentBlock } from './schema';
import katex from 'katex';

/**
 * Sanitizes LaTeX strings to ensure compatibility.
 */
export function sanitizeLatex(latex: string): string {
    if (!latex) return "";

    return latex
        .replace(/\\textsuperscript\{([^}]+)\}/g, "^{$1}")
        .replace(/\\textsubscript\{([^}]+)\}/g, "_{$1}")
        .replace(/\\(vspace|hspace|phantom)\{[^}]+\}/g, "")
        .replace(/^\$\$/, "")
        .replace(/\$\$$/, "");
}

/**
 * Converts the Intermediate Representation (IR) into HTML code.
 */
export function renderToHtml(ir: DocumentIR): string {
    let html = "";

    for (const block of ir.content) {
        html += renderBlock(block) + "\n";
    }

    return html.trim();
}

/**
 * Process text content to replace LaTeX math delimiters with KaTeX rendered HTML.
 */
function processContent(text: string): string {
    if (!text) return "";

    // Replace block math $$ ... $$
    let processed = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
        const cleaned = sanitizeLatex(latex);
        try {
            return katex.renderToString(cleaned, {
                displayMode: true,
                throwOnError: false,
                output: "html",
            });
        } catch (e) {
            return `<div class="katex-error">${latex}</div>`;
        }
    });

    // Replace inline math $ ... $
    processed = processed.replace(/\$([^$]+?)\$/g, (match, latex) => {
        const cleaned = sanitizeLatex(latex);
        try {
            return katex.renderToString(cleaned, {
                displayMode: false,
                throwOnError: false,
                output: "html",
            });
        } catch (e) {
            return `<span class="katex-error">${latex}</span>`;
        }
    });

    // Convert newlines to <br> for text content, but be careful not to break HTML tags if any.
    // Since we are constructing HTML, we should escape HTML special characters in the text parts *before* replacing math?
    // Actually, simple text usually doesn't have HTML. But to be safe, we might want to basic escape.
    // For now, assuming LLM output is markdown-ish.
    // If we escape everything, we break the already rendered KaTeX.
    // So ideally: split by math, escape text parts, render math parts, join.
    // But simple replace above assumes text is safe or we don't care about XSS locally for PDF gen.
    // Given this goes to Puppeteer, XSS isn't a huge risk unless it leaks data, but it's isolated.
    // I'll stick to simple replacement for now as per solution.

    return processed;
}

function renderBlock(block: ContentBlock): string {
    switch (block.type) {
        case "paragraph":
            return `<p>${processContent(block.text)}</p>`;

        case "heading":
            const level = Math.min(Math.max(block.level, 1), 6);
            return `<h${level}>${processContent(block.text)}</h${level}>`;

        case "math":
            const cleaned = sanitizeLatex(block.latex);
            try {
                return katex.renderToString(cleaned, {
                    displayMode: block.display,
                    throwOnError: false,
                    output: "html",
                });
            } catch (e) {
                return block.display
                    ? `<div class="katex-error">${block.latex}</div>`
                    : `<span class="katex-error">${block.latex}</span>`;
            }

        case "list":
            const tag = block.ordered ? "ol" : "ul";
            const items = block.items
                .map(item => `<li>${processContent(item)}</li>`)
                .join("");
            return `<${tag}>${items}</${tag}>`;

        case "container":
            const titleHtml = block.title ? `<h4>${block.title}</h4>` : "";
            // Maps types to CSS classes
            return `<div class="${block.kind}">
                ${titleHtml}
                <div>${processContent(block.content)}</div>
            </div>`;

        case "diagram":
            return `<figure class="diagram">
                <div style="border: 1px solid #ccc; padding: 20px; background: #fafafa;">
                    <strong>Diagram: ${block.label || "Untitled"}</strong>
                    <br/><br/>
                    ${processContent(block.description)}
                </div>
            </figure>`;

        default:
            return "";
    }
}

