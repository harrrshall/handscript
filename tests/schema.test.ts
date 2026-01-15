
import { describe, it, expect } from 'vitest';
import {
    ContentBlockSchema,
    BatchResponseSchema
} from '@/lib/schema';
import { z } from 'zod';

describe('lib/schema.ts (Section 2.5)', () => {

    it('SCH-001: ContentBlockSchema paragraph', () => {
        const validPara = { type: 'paragraph', text: 'hello' };
        expect(() => ContentBlockSchema.parse(validPara)).not.toThrow();

        const invalidPara = { type: 'paragraph' }; // missing text
        expect(() => ContentBlockSchema.parse(invalidPara)).toThrow();
    });

    it('SCH-002: ContentBlockSchema heading', () => {
        const validHeading = { type: 'heading', level: 1, text: 'Title' };
        expect(() => ContentBlockSchema.parse(validHeading)).not.toThrow();
    });

    it('SCH-009: Heading level bounds', () => {
        const level0 = { type: 'heading', level: 0, text: 'Title' };
        expect(() => ContentBlockSchema.parse(level0)).toThrow(); // assuming level >= 1

        const level4 = { type: 'heading', level: 4, text: 'Title' };
        // If schema limits to 1-3 or 1-6. test.md implies logic about bounds.
        // Use logic from schema definition if known. Assuming standard 1-6 or specific limits.
        // If SCH-009 says "Level 0 and 4 are rejected", then max must be 3?
        // Let's verify. If it doesn't throw, maybe the bound is different. 
        // We will assert behavior matches the requirement.
        expect(() => ContentBlockSchema.parse(level4)).toThrow();
    });

    it('SCH-003: ContentBlockSchema math', () => {
        const validMath = { type: 'math', latex: 'x^2', display: true };
        expect(() => ContentBlockSchema.parse(validMath)).not.toThrow();
    });

    it('SCH-004: ContentBlockSchema list', () => {
        const validList = { type: 'list', ordered: true, items: ['a', 'b'] };
        expect(() => ContentBlockSchema.parse(validList)).not.toThrow();
    });

    it('SCH-005/010: ContentBlockSchema container', () => {
        const validContainer = { type: 'container', kind: 'theorem', title: 'T', content: 'c' };
        expect(() => ContentBlockSchema.parse(validContainer)).not.toThrow();

        const invalidContainer = { type: 'container', kind: 'invalid', content: 'c' };
        expect(() => ContentBlockSchema.parse(invalidContainer)).toThrow();
    });

    it('SCH-006: ContentBlockSchema diagram', () => {
        const validDiagram = { type: 'diagram', description: 'desc' };
        expect(() => ContentBlockSchema.parse(validDiagram)).not.toThrow();
    });

    it('SCH-007: BatchResponseSchema complete', () => {
        const validResponse = {
            metadata: { title: 'T', subject: 'S', documentType: 'lecture' },
            pages: [
                { pageIndex: 0, content: [{ type: 'paragraph', text: 'p' }] }
            ]
        };
        expect(() => BatchResponseSchema.parse(validResponse)).not.toThrow();
    });

    it('SCH-008: Invalid type discriminator rejected', () => {
        const invalidBlock = { type: 'unknown_type', text: 'foo' };
        expect(() => ContentBlockSchema.parse(invalidBlock)).toThrow();
    });
});
