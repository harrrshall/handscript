import { DocumentIR, ContentBlock } from './schema';
import katex from 'katex';

/**
 * Sanitizes LaTeX strings to ensure compatibility.
 */
export function sanitizeLatex(latex: string): string {
    if (!latex) return "";

    return latex
        .replace(/\\textsuperscript\{([^\}]+)\}/g, "^{$1}")
        .replace(/\\textsubscript\{([^\}]+)\}/g, "_{$1}")
        .replace(/\\(vspace|hspace|phantom)(\[[^\]]*\])?\{[^{}]*\}/g, "")
        .replace(/\\ensuremath\{([^{}]+)\}/g, '$1')
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
 * Process text content to replace Markdown and LaTeX.
 * Strategy: Extract Math -> Process Markdown -> Restore (Render) Math.
 */
function processContent(text: string): string {
    if (!text) return "";

    const mathPlaceholders: string[] = [];

    // 1. Extract Display Math $$...$$
    let temp = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
        mathPlaceholders.push(renderMath(latex, true));
        return `__MATH_DISP_${mathPlaceholders.length - 1}__`;
    });

    // 2. Extract Inline Math $...$
    temp = temp.replace(/\$([^$]+?)\$/g, (match, latex) => {
        mathPlaceholders.push(renderMath(latex, false));
        return `__MATH_INLINE_${mathPlaceholders.length - 1}__`;
    });

    // 3. Process Markdown Tables
    // Look for table blocks: lines starting with | (ignoring leading whitespace)
    // We need to handle this carefully. A table is a chunk of lines.
    // Since 'text' here is from a paragraph block, it might contains newlines.

    // Simple table parser strategy:
    // Split by double newline to identify potential blocks, or process line by line?
    // Given the input is likely a single "text" string from JSON, let's look for the patterns.

    if (temp.includes('|')) {
        temp = processTables(temp);
    }

    // 4. Process Basic Formats (Bold, Italic)
    // **bold**
    temp = temp.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // *italic*
    temp = temp.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 5. Convert remaining newlines to <br> if proper, but usually paragraphs handle flow.
    // However, if there are explicit newlines in the text json, we should preserve them?
    // Markdown ignores single newlines. Double newlines are paragraphs. 
    // But here we are IN a paragraph block usually. 
    // Let's replace single newlines with spaces or just leave them for HTML to collapse.
    // BUT if the user wants a line break? Two spaces + newline?
    // For now, let's treat it as standard HTML whitespace (collapsing) unless we see explicit <br> intent.

    // 6. Restore Math
    temp = temp.replace(/__MATH_DISP_(\d+)__/g, (_, index) => mathPlaceholders[parseInt(index)] || "");
    temp = temp.replace(/__MATH_INLINE_(\d+)__/g, (_, index) => mathPlaceholders[parseInt(index)] || "");

    return temp;
}

function renderMath(latex: string, displayMode: boolean): string {
    const cleaned = sanitizeLatex(latex);
    try {
        return katex.renderToString(cleaned, {
            displayMode,
            throwOnError: false, // Per Rule 13.1
            output: "html",
        });
    } catch (e) {
        const errorTag = displayMode ? "div" : "span";
        return `<${errorTag} class="katex-error" style="color:red;">${cleaned}</${errorTag}>`;
    }
}

function processTables(text: string): string {
    // Regex for a table structure
    const lines = text.trim().split('\n');
    let inTable = false;
    let tableBuffer: string[] = [];
    let output: string[] = [];

    const flushTable = () => {
        if (tableBuffer.length > 0) {
            output.push(renderTable(tableBuffer));
            tableBuffer = [];
        }
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            inTable = true;
            tableBuffer.push(trimmed);
        } else {
            if (inTable) {
                flushTable();
                inTable = false;
            }
            output.push(line);
        }
    }
    if (inTable) flushTable();

    return output.join('\n');
}

function renderTable(lines: string[]): string {
    if (lines.length < 2) return lines.join('\n'); // Not a valid table

    // Check second line for separator
    const headerRow = lines[0];
    const separatorRow = lines[1];

    if (!separatorRow.includes('---')) return lines.join('\n'); // Basic check

    // Parse alignment from separator |:---|:---:|---:|
    const alignments = separatorRow.split('|')
        .slice(1, -1)
        .map(cell => {
            const c = cell.trim();
            if (c.startsWith(':') && c.endsWith(':')) return 'center';
            if (c.endsWith(':')) return 'right';
            return 'left';
        });

    let html = '<table>\n';

    // Header
    html += '<thead><tr>';
    const headers = headerRow.split('|').slice(1, -1);
    headers.forEach((h, i) => {
        html += `<th style="text-align: ${alignments[i] || 'left'}">${processContent(h.trim())}</th>`;
    });
    html += '</tr></thead>\n';

    // Body
    html += '<tbody>\n';
    for (let i = 2; i < lines.length; i++) {
        const row = lines[i];
        const cells = row.split('|').slice(1, -1);
        html += '<tr>';
        cells.forEach((c, index) => {
            html += `<td style="text-align: ${alignments[index] || 'left'}">${processContent(c.trim())}</td>`;
        });
        html += '</tr>\n';
    }
    html += '</tbody></table>';

    return html;
}

function getBlockTitleHtml(kind: string, title?: string): string {
    // Rule: "Theorem" or "Theorem: [Name]"
    if (kind === 'proof') return ''; // Handled by CSS ::before

    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const displayKind = capitalize(kind);

    if (title) {
        return `<strong>${displayKind}: ${title}</strong>`;
    }
    return `<strong>${displayKind}</strong>`;
}

function renderBlock(block: ContentBlock): string {
    switch (block.type) {
        case "paragraph":
            return `<p>${processContent(block.text)}</p>`;

        case "heading":
            const level = Math.min(Math.max(block.level, 1), 6);
            return `<h${level}>${processContent(block.text)}</h${level}>`;

        case "math":
            return renderMath(block.latex, block.display);

        case "list":
            const tag = block.ordered ? "ol" : "ul";
            const items = block.items
                .map(item => `<li>${processContent(item)}</li>`)
                .join("");
            return `<${tag}>${items}</${tag}>`;

        case "container":
            const titleHtml = getBlockTitleHtml(block.kind, block.title);
            // Maps types to CSS classes
            return `<div class="${block.kind}">
                ${titleHtml}
                <div>${processContent(block.content)}</div>
            </div>`;

        case "diagram":
            // Rule Part 4: Structured diagram description
            return `<figure class="diagram">
                <div style="text-align:left; display: inline-block;">
                    <strong>${block.label ? `Diagram: ${block.label}` : "Diagram"}</strong>
                    <div>${processContent(block.description)}</div>
                </div>
            </figure>`;

        default:
            return "";
    }
}


