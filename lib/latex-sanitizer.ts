export function sanitizeLatex(markdown: string): { sanitized: string, replacements: number } {
    if (!markdown) return { sanitized: markdown, replacements: 0 };

    let replacements = 0;
    let sanitized = markdown;

    // Helper for replacement with counting
    const replaceWithCount = (regex: RegExp, replacement: string) => {
        const matches = sanitized.match(regex);
        if (matches) {
            replacements += matches.length;
            sanitized = sanitized.replace(regex, replacement);
        }
    };

    // 1. Replace \textsuperscript{x} with ^{x}
    replaceWithCount(/\\textsuperscript\{([^{}]+)\}/g, '^{$1}');

    // 2. Replace \textsubscript{x} with _{x}
    replaceWithCount(/\\textsubscript\{([^{}]+)\}/g, '_{$1}');

    // 4. Remove \phantom, \hspace, \vspace
    replaceWithCount(/\\(phantom|hspace|vspace)(\[[^\]]*\])?\{[^{}]*\}/g, '');

    // 5. Remove \ensuremath
    replaceWithCount(/\\ensuremath\{([^{}]+)\}/g, '$1');

    // 6. Handle nested braces for super/subscripts (recursion is hard with regex, but we can do one level deep)
    replaceWithCount(/\\textsuperscript\{([^{}]+)\}/g, '^{$1}');
    replaceWithCount(/\\textsubscript\{([^{}]+)\}/g, '_{$1}');

    return { sanitized, replacements };
}
