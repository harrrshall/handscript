export function sanitizeLatex(markdown: string): string {
    if (!markdown) return markdown;

    // 1. Replace \textsuperscript{x} with ^{x}
    let sanitized = markdown.replace(/\\textsuperscript\{([^{}]+)\}/g, '^{$1}');

    // 2. Replace \textsubscript{x} with _{x}
    sanitized = sanitized.replace(/\\textsubscript\{([^{}]+)\}/g, '_{$1}');

    // 3. Replace \textbf{} inside math mode is tricky with regex, 
    // but we can try to catch common cases or just replace all \textbf if it doesn't break text.
    // Typst's mitex might generally handle \textbf in text, but in math it fails.
    // However, global replacement might be too aggressive.
    // Let's stick to the specific crashers known: \textsuperscript and \textsubscript.

    // 4. Remove \phantom, \hspace, \vspace
    sanitized = sanitized.replace(/\\(phantom|hspace|vspace)(\[[^\]]*\])?\{[^{}]*\}/g, '');

    // 5. Remove \ensuremath
    sanitized = sanitized.replace(/\\ensuremath\{([^{}]+)\}/g, '$1');

    // 6. Handle nested braces for super/subscripts (recursion is hard with regex, but we can do one level deep)
    // Rerunning the replacement a couple of times can help with simple nesting
    sanitized = sanitized.replace(/\\textsuperscript\{([^{}]+)\}/g, '^{$1}');
    sanitized = sanitized.replace(/\\textsubscript\{([^{}]+)\}/g, '_{$1}');

    return sanitized;
}
