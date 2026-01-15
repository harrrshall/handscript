import { GET } from '../../app/api/jobs/[jobId]/status/route';
import { NextRequest } from 'next/server';
import { redis } from '../../lib/redis';

// Mock dependencies
jest.mock('../../lib/redis', () => ({
    redis: {
        get: jest.fn(),
        lrange: jest.fn(),
    },
}));

describe('GET /api/jobs/[jobId]/status', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('API-STS-001: Returns job status', async () => {
        (redis.get as jest.Mock)
            .mockResolvedValueOnce({
                id: 'job123',
                status: 'processing',
                totalPages: 10,
                // other fields...
            }) // first call for job:jobId
            .mockResolvedValueOnce('5'); // second call for completed count

        (redis.lrange as jest.Mock)
            .mockResolvedValueOnce([]) // failed list
            .mockResolvedValueOnce([]); // logs

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
        (redis.get as jest.Mock).mockResolvedValue(null);

        const req = new NextRequest('http://localhost:3000/api/jobs/unknown/status');
        const params = Promise.resolve({ jobId: 'unknown' });

        const res = await GET(req, { params });
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.error).toBe('Job not found');
    });

    it('API-STS-004: Complete job has finalPdfUrl', async () => {
        (redis.get as jest.Mock)
            .mockResolvedValueOnce({
                id: 'job123',
                status: 'complete',
                totalPages: 5,
                completedPages: 5,
                finalPdfUrl: 'https://b2.com/pdf.pdf',
            })
            .mockResolvedValueOnce('5');

        (redis.lrange as jest.Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        const req = new NextRequest('http://localhost:3000/api/jobs/job123/status');
        const params = Promise.resolve({ jobId: 'job123' });
        const res = await GET(req, { params });
        const data = await res.json();

        expect(data.status).toBe('complete');
        expect(data.finalPdfUrl).toBe('https://b2.com/pdf.pdf');
    });

    it('API-STS-005: Failed job has error', async () => {
        (redis.get as jest.Mock)
            .mockResolvedValueOnce({
                id: 'job123',
                status: 'failed',
                totalPages: 5,
                error: 'Processing failed',
            })
            .mockResolvedValueOnce('0');

        (redis.lrange as jest.Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        const req = new NextRequest('http://localhost:3000/api/jobs/job123/status');
        const params = Promise.resolve({ jobId: 'job123' });
        const res = await GET(req, { params });
        const data = await res.json();

        expect(data.status).toBe('failed');
        expect(data.error).toBe('Processing failed');
    });
});
