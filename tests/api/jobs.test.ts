import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Hoisted mocks
const { mockBatchPublishToQStash, mockRedisSet, mockRedisExpire, mockRedisScan, mockRedisSadd, mockRedisGet } = vi.hoisted(() => {
    return {
        mockBatchPublishToQStash: vi.fn(),
        mockRedisSet: vi.fn(),
        mockRedisExpire: vi.fn(),
        mockRedisScan: vi.fn().mockResolvedValue([0, []]),
        mockRedisSadd: vi.fn(),
        mockRedisGet: vi.fn(),
    };
});

// Mock dependencies
vi.mock('../../lib/redis', () => ({
    redis: {
        get: mockRedisGet,
        set: mockRedisSet,
        expire: mockRedisExpire,
        scan: mockRedisScan,
        sadd: mockRedisSadd,
    },
}));
vi.mock('../../lib/queue', () => ({
    batchPublishToQStash: mockBatchPublishToQStash,
}));
vi.mock('../../lib/logger', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
    },
    metrics: {
        increment: vi.fn(),
    },
}));
vi.mock('../../lib/utils', () => ({
    getBaseUrl: vi.fn().mockReturnValue('http://localhost:3000'),
}));

describe('POST /api/jobs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('API-JOB-001: Creates job successfully', async () => {
        mockBatchPublishToQStash.mockResolvedValue({ results: [{ messageId: 'msg_123' }, { messageId: 'msg_124' }] });

        // Dynamic import to pick up mocks
        const { POST } = await import('../../app/api/jobs/route');

        const body = {
            pageCount: 2,
            pageManifest: ['key1', 'key2'],
            email: 'test@example.com'
        };

        const req = new NextRequest('http://localhost:3000/api/jobs', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data).toHaveProperty('jobId');
        expect(data.status).toBe('processing');
        expect(data.estimatedTime).toBe(10); // Math.max(10, 2 * 1) = 10
    });

    it('API-JOB-002: Job stored in Redis', async () => {
        mockBatchPublishToQStash.mockResolvedValue({ results: [{ messageId: 'msg_123' }] });

        const { POST } = await import('../../app/api/jobs/route');

        const body = {
            pageCount: 1,
            pageManifest: ['key1'],
        };

        const req = new NextRequest('http://localhost:3000/api/jobs', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        await POST(req);

        expect(mockRedisSet).toHaveBeenCalledWith(
            expect.stringMatching(/^job:/),
            expect.objectContaining({
                status: 'processing',
                totalPages: 1,
                pageManifest: ['key1'],
            })
        );
        expect(mockRedisExpire).toHaveBeenCalled();
    });

    it('API-JOB-003: QStash batch triggered with fan-out', async () => {
        mockBatchPublishToQStash.mockResolvedValue({ results: [{ messageId: 'msg_123' }] });

        const { POST } = await import('../../app/api/jobs/route');

        const body = {
            pageCount: 1,
            pageManifest: ['key1'],
        };
        const req = new NextRequest('http://localhost:3000/api/jobs', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        await POST(req);

        // Should be called with array of messages for fan-out pattern
        expect(mockBatchPublishToQStash).toHaveBeenCalledWith([
            expect.objectContaining({
                destination: 'http://localhost:3000/api/internal/process-image',
                body: expect.objectContaining({
                    imageKey: 'key1',
                    index: 0
                })
            })
        ]);
    });

    it('API-JOB-004: Page count mismatch rejected', async () => {
        const { POST } = await import('../../app/api/jobs/route');

        const body = {
            pageCount: 5,
            pageManifest: ['key1'], // Mismatch
        };
        const req = new NextRequest('http://localhost:3000/api/jobs', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(400);
        expect(data.error).toBe('Page count does not match manifest length');
    });

    it('API-JOB-005: Zero/exceeds pages rejected', async () => {
        const { POST } = await import('../../app/api/jobs/route');

        // Zero pages (Zod min 1)
        let body: any = { pageCount: 0, pageManifest: [] };
        let req = new NextRequest('http://localhost:3000/api/jobs', { method: 'POST', body: JSON.stringify(body) });
        let res = await POST(req);
        expect(res.status).toBe(400);

        // Exceeds 200 (Zod max 200)
        body = { pageCount: 201, pageManifest: new Array(201).fill('key') };
        req = new NextRequest('http://localhost:3000/api/jobs', { method: 'POST', body: JSON.stringify(body) });
        res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('API-JOB-012: Invalid JSON body', async () => {
        const { POST } = await import('../../app/api/jobs/route');

        const body = {
            // missing pageCount
            pageManifest: ['key1']
        };
        const req = new NextRequest('http://localhost:3000/api/jobs', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        const res = await POST(req);
        expect(res.status).toBe(400);
    });
});


