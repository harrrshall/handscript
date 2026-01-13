import { DocumentIR, ContentBlock } from './schema';

/**
 * Sanitizes LaTeX strings to ensure compatibility with Typst/Mitex.
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
 * Converts the Intermediate Representation (IR) into Typst code.
 */
export function renderToTypst(ir: DocumentIR): string {
    let code = "";

    for (const block of ir.content) {
        code += renderBlock(block) + "\n\n";
    }

    return code.trim();
}

/**
 * Process text content to replace LaTeX math delimiters with mitex calls.
 */
function processContent(text: string): string {
    // Replace block math $$ ... $$
    // We match non-greedy.
    // Note: LLM output might use \n inside math.
    let processed = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
        const cleaned = sanitizeLatex(latex);
        const safeLatex = JSON.stringify(cleaned);
        return `#align(center)[#mitex(${safeLatex})]`;
    });

    // Replace inline math $ ... $
    // Avoid double $$ match by negative lookaround if JS supported it well, 
    // but we already replaced $$ so mainly single $ remains.
    // One edge case: escaped \$? LLM usually doesn't escape.
    processed = processed.replace(/\$([^$]+?)\$/g, (match, latex) => {
        const cleaned = sanitizeLatex(latex);
        const safeLatex = JSON.stringify(cleaned);
        return `#mitex(${safeLatex})`;
    });

    return processed;
}

function renderBlock(block: ContentBlock): string {
    switch (block.type) {
        case "paragraph":
            return processContent(block.text); // Text with $math$ works in Typst

        case "heading":
            // Healings usually don't have math, but safe to process if they do.
            return `${"=".repeat(block.level)} ${processContent(block.text)}`;

        case "math":
            const cleaned = sanitizeLatex(block.latex);
            // Use mitex to convert LaTeX to Typst math. 
            // JSON.stringify safely quotes/escapes the string for Typst.
            const safeLatex = JSON.stringify(cleaned);
            if (block.display) {
                // Block level math
                return `#align(center)[#mitex(${safeLatex})]`;
            } else {
                // Inline math
                return `#mitex(${safeLatex})`;
            }

        case "list":
            return block.items
                .map((item, index) => {
                    const marker = block.ordered ? `${index + 1}.` : "-";
                    return `${marker} ${processContent(item)}`;
                })
                .join("\n");

        case "container":
            // Generate function call: #kind(title)[content]
            // or #kind[content] if no title
            const titleArg = block.title ? `("${block.title}")` : "";
            // Recursively formatted content? 
            // The content inside a block might be raw string from LLM which is Markdown-like.
            // But we inserted it into a #theorem[...]. Typst parses content mode inside [].
            // So paragraphs and math inside the string will work!
            return `#${block.kind}${titleArg}[\n${processContent(block.content)}\n]`;

        case "diagram":
            return `#figure(\n  rect(width: 100%, stroke: 1pt + gray, inset: 10pt)[\n    *Diagram: ${block.label || "Untitled"}*\n    \n    ${processContent(block.description)}\n  ]\n)`;

        default:
            return "";
    }
}
