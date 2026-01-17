import { POST } from '../../app/api/internal/process-batch/route';
import { NextRequest } from 'next/server';
import { redis } from '../../lib/redis';
import { publishToQStash, queueErrorEmail } from '../../lib/queue';
import { generateBatchNotes } from '../../lib/gemini';
import * as s3Presigner from "@aws-sdk/s3-request-presigner";
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Mock dependencies
vi.mock('../../lib/redis', () => ({
    redis: {
        mset: vi.fn(),
        incrby: vi.fn(),
        get: vi.fn(),
        set: vi.fn(), // for error handling status update
        del: vi.fn(),
        sadd: vi.fn(), // Likely needed
        expire: vi.fn(),
    },
}));
vi.mock('../../lib/queue', () => ({
    publishToQStash: vi.fn(),
    queueErrorEmail: vi.fn(),
}));
vi.mock('../../lib/gemini', () => ({
    generateBatchNotes: vi.fn(),
}));
vi.mock('../../lib/formatting', () => ({
    renderToHtml: vi.fn().mockImplementation((ir) => `<p>${ir.content}</p>`),
}));
vi.mock('../../lib/logger', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        logToRedis: vi.fn(),
    },
    metrics: {
        increment: vi.fn(),
        recordLatency: vi.fn(),
    },
}));
// Mock S3
vi.mock('@aws-sdk/client-s3');
vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn(),
}));

vi.mock('../../lib/utils', () => ({
    getBaseUrl: vi.fn().mockReturnValue('http://localhost:3000'),
}));

const getSignedUrlMock = s3Presigner.getSignedUrl as Mock;

describe('POST /api/internal/process-batch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSignedUrlMock.mockResolvedValue('https://s3.example.com/signed-url');
        process.env.NODE_ENV = 'test'; // Ensure handler is not wrapped
    });

    it('API-BAT-001: Processes batch successfully and triggers next batch', async () => {
        // Mock Gemini response
        (generateBatchNotes as Mock).mockResolvedValue({
            metadata: {},
            pages: [
                { pageIndex: 0, content: 'Page 1 content' },
                { pageIndex: 1, content: 'Page 2 content' },
                { pageIndex: 2, content: 'Page 3 content' },
            ],
        });

        // 5 page manifest, processing batch 0 (size 3) => indices 0, 1, 2
        const body = {
            jobId: 'job123',
            batchIndex: 0,
            manifest: ['key1', 'key2', 'key3', 'key4', 'key5'],
        };
        const req = new NextRequest('http://localhost:3000/api/internal/process-batch', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.processed).toBe(3);

        // Verify Redis Storage
        expect(redis.mset).toHaveBeenCalledWith(expect.objectContaining({
            'job:job123:page:0': expect.stringContaining('Page 1 content'),
            'job:job123:page:1': expect.stringContaining('Page 2 content'),
            'job:job123:page:2': expect.stringContaining('Page 3 content'),
        }));

        // Verify Next Batch Trigger
        expect(publishToQStash).toHaveBeenCalledWith(
            'http://localhost:3000/api/internal/process-batch',
            expect.objectContaining({
                jobId: 'job123',
                batchIndex: 1,
            })
        );
    });

    it('API-BAT-006: Final batch triggers finalize', async () => {
        // Manifest size 5, batch 1 (indices 3, 4) -> End of manifest
        (generateBatchNotes as Mock).mockResolvedValue({
            metadata: {},
            pages: [
                { pageIndex: 0, content: 'Page 4 content' }, // relative index in batch
                { pageIndex: 1, content: 'Page 5 content' },
            ],
        });

        const body = {
            jobId: 'job123',
            batchIndex: 1, // Second batch (first was 0)
            manifest: ['key1', 'key2', 'key3', 'key4', 'key5'],
        };

        const req = new NextRequest('http://localhost:3000/api/internal/process-batch', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        await POST(req);

        // Should NOT trigger next batch
        expect(publishToQStash).not.toHaveBeenCalledWith(
            expect.stringContaining('process-batch'),
            expect.anything()
        );

        // Should trigger FINALIZE
        expect(publishToQStash).toHaveBeenCalledWith(
            'http://localhost:3000/api/jobs/job123/finalize',
            {}
        );
    });

    it('API-BAT-009: Gemini failure returns 500', async () => {
        (generateBatchNotes as Mock).mockRejectedValue(new Error('Gemini Overloaded'));

        const body = {
            jobId: 'job123',
            batchIndex: 0,
            manifest: ['key1'],
        };
        const req = new NextRequest('http://localhost:3000/api/internal/process-batch', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(500);
        expect(data.error).toBe('Gemini Overloaded');
    });
});
