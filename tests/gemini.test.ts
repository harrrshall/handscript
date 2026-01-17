import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateBatchNotes } from '@/lib/gemini';

// Mock generic @google/generative-ai library
const { mockGenerateContent } = vi.hoisted(() => {
    return { mockGenerateContent: vi.fn() };
});

vi.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: vi.fn().mockImplementation(function () {
            return {
                getGenerativeModel: () => ({
                    generateContent: mockGenerateContent
                })
            };
        }),
        SchemaType: { ARRAY: 'ARRAY', OBJECT: 'OBJECT', STRING: 'STRING', INTEGER: 'INTEGER' }
    };
});

// Mock global fetch for image download
global.fetch = vi.fn() as unknown as ReturnType<typeof vi.fn>;

describe('lib/gemini.ts (Section 2.1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default fetch mock to return success
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(8),
            headers: { get: () => 'image/png' },
        });
    });

    it('GEM-001: generateBatchNotes returns valid BatchResponse', async () => {
        // Mock successful response
        const mockResponse = {
            response: {
                text: () => JSON.stringify({
                    metadata: { title: "Test", subject: "Math", documentType: "lecture" },
                    pages: [{ pageIndex: 0, content: [] }]
                }),
                functionCall: () => null,
            }
        };
        mockGenerateContent.mockResolvedValue(mockResponse);

        const result = await generateBatchNotes(['http://example.com/img.png']);

        expect(result).toBeDefined();
        expect(result.metadata.title).toBe("Test");
        expect(result.pages).toHaveLength(1);
    });

    it('GEM-003: Invalid JSON response throws', async () => {
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => "Invalid JSON",
            }
        });

        await expect(generateBatchNotes(['http://example.com/img.png'])).rejects.toThrow();
    });

    it('GEM-004: Schema validation failure throws', async () => {
        mockGenerateContent.mockResolvedValue({
            response: {
                text: () => JSON.stringify({
                    metadata: { title: "Test" }, // Missing subject, etc.
                    pages: []
                }),
            }
        });

        // Should throw/reject because it doesn't match the Zod schema
        await expect(generateBatchNotes(['http://example.com/img.png'])).rejects.toThrow();
    });

    it('GEM-005: Empty URL array handled', async () => {
        try {
            await generateBatchNotes([]);
        } catch (e) {
            expect(e).toBeDefined();
        }
    });

    // Add a test case for Fetch Failure
    it('GEM-006: Fetch failure throws', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found'
        });
        await expect(generateBatchNotes(['http://example.com/missing.png'])).rejects.toThrow('Failed to fetch image');
    });
});
