import { GET } from '../../app/api/jobs/[jobId]/status/route';
import { NextRequest } from 'next/server';
import { redis } from '../../lib/redis';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Mock dependencies
vi.mock('../../lib/redis', () => ({
    redis: {
        get: vi.fn(),
        lrange: vi.fn(),
        scard: vi.fn().mockResolvedValue(0), // Mock scard for failing test
    },
}));

describe('GET /api/jobs/[jobId]/status', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('API-STS-001: Returns job status', async () => {
        (redis.get as Mock)
            .mockResolvedValueOnce({
                id: 'job123',
                status: 'processing',
                totalPages: 10,
                completedPages: 5,
            });

        // Mock scard to return 5 (the source of truth for progress)
        (redis.scard as Mock).mockResolvedValueOnce(5);

        (redis.lrange as Mock).mockResolvedValue([]);

        const req = new NextRequest('http://localhost:3000/api/jobs/job123/status');
        const params = Promise.resolve({ jobId: 'job123' });

        const res = await GET(req, { params });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.status).toBe('processing');
        expect(data.progress).toEqual({
            total: 10,
            completed: 5,
            failed: 0,
        });
    });

    it('API-STS-002: Non-existent job returns 404', async () => {
        // Ensure no leftover mocks
        vi.clearAllMocks();
        (redis.get as Mock).mockResolvedValue(null);

        const req = new NextRequest('http://localhost:3000/api/jobs/unknown/status');
        const params = Promise.resolve({ jobId: 'unknown' });

        const res = await GET(req, { params });
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.error).toBe('Job not found');
    });

    it('API-STS-004: Complete job has finalPdfUrl', async () => {
        (redis.get as Mock)
            .mockResolvedValueOnce({
                id: 'job123',
                status: 'complete',
                totalPages: 5,
                completedPages: 5,
                finalPdfUrl: 'https://b2.com/pdf.pdf',
            });

        (redis.lrange as Mock).mockResolvedValue([]);

        const req = new NextRequest('http://localhost:3000/api/jobs/job123/status');
        const params = Promise.resolve({ jobId: 'job123' });
        const res = await GET(req, { params });
        const data = await res.json();

        expect(data.status).toBe('complete');
        expect(data.finalPdfUrl).toBe('https://b2.com/pdf.pdf');
    });

    it('API-STS-005: Failed job has error', async () => {
        (redis.get as Mock)
            .mockResolvedValueOnce({
                id: 'job123',
                status: 'failed',
                totalPages: 5,
                error: 'Processing failed',
            });

        (redis.lrange as Mock).mockResolvedValue([]);

        const req = new NextRequest('http://localhost:3000/api/jobs/job123/status');
        const params = Promise.resolve({ jobId: 'job123' });
        const res = await GET(req, { params });
        const data = await res.json();

        expect(data.status).toBe('failed');
        expect(data.error).toBe('Processing failed');
    });
});
