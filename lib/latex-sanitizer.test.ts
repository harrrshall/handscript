
import { sanitizeLatex } from './latex-sanitizer';
import assert from 'assert';

console.log('Running latex-sanitizer tests...');

try {
    // Test 1: textsuperscript
    const input1 = 'This is 2\\textsuperscript{nd} place.';
    const expected1 = 'This is 2^{nd} place.';
    assert.strictEqual(sanitizeLatex(input1), expected1, 'Failed textsuperscript replacement');
    console.log('PASS: textsuperscript');

    // Test 2: textsubscript
    const input2 = 'H\\textsubscript{2}O';
    const expected2 = 'H_{2}O';
    assert.strictEqual(sanitizeLatex(input2), expected2, 'Failed textsubscript replacement');
    console.log('PASS: textsubscript');

    // Test 3: phantom/hspace/vspace
    const input3 = 'A \\phantom{x} B \\hspace{1em} C \\vspace{10pt} D';
    const expected3 = 'A  B  C  D';
    assert.strictEqual(sanitizeLatex(input3), expected3, 'Failed spacing removal');
    console.log('PASS: phantom/hspace/vspace');

    // Test 4: ensuremath
    const input4 = 'Val = \\ensuremath{x^2}';
    const expected4 = 'Val = x^2';
    assert.strictEqual(sanitizeLatex(input4), expected4, 'Failed ensuremath removal');
    console.log('PASS: ensuremath');

    // Test 5: Multiple occurrences
    const input5 = '1\\textsuperscript{st}, 2\\textsuperscript{nd}';
    const expected5 = '1^{st}, 2^{nd}';
    assert.strictEqual(sanitizeLatex(input5), expected5, 'Failed multiple occurrences');
    console.log('PASS: Multiple occurrences');

    console.log('ALL TESTS PASSED');
} catch (error) {
    console.error('TEST FAILED:', error);
    process.exit(1);
}
