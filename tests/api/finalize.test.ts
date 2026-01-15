import { POST } from '../../app/api/jobs/[jobId]/finalize/route';
import { NextRequest } from 'next/server';
import { redis } from '../../lib/redis';
import { queueEmailDelivery } from '../../lib/queue';
import { uploadFile, getDownloadUrl } from '../../lib/s3';
import { PDFDocument } from 'pdf-lib';

// Mock dependencies
jest.mock('../../lib/redis', () => ({
    redis: {
        get: jest.fn(),
        mget: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
    },
}));
jest.mock('../../lib/queue', () => ({
    queueEmailDelivery: jest.fn(),
    queueErrorEmail: jest.fn(),
}));
jest.mock('../../lib/s3', () => ({
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    getDownloadUrl: jest.fn(),
}));
jest.mock('../../lib/html-template', () => ({
    wrapWithTemplate: (html: string) => `<html>${html}</html>`,
}));
jest.mock('../../lib/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        critical: jest.fn(),
        logToRedis: jest.fn(),
    },
    metrics: {
        increment: jest.fn(),
        recordLatency: jest.fn(),
    },
}));
jest.mock('../../lib/utils', () => ({
    withRetry: jest.fn((fn) => fn()),
    withTimeout: jest.fn((promise) => promise),
    getBaseUrl: jest.fn().mockReturnValue('http://localhost:3000'),
}));

// Mock Global Fetch for Modal
global.fetch = jest.fn() as jest.Mock;

describe('POST /api/jobs/[jobId]/finalize', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset PDFDocument mocks via spyOn if needed, or rely on pdf-lib actual implementation if simple enough.
        // Actually, we should probably mock PDFDocument to avoid heavy operations.
    });

    it('API-FIN-001: Generates merged PDF and uploads to B2', async () => {
        // Setup Metadata
        (redis.get as jest.Mock).mockResolvedValue({
            id: 'job123',
            totalPages: 2,
            pageManifest: ['key1', 'key2'],
            email: 'test@example.com',
        });
        (redis.mget as jest.Mock).mockResolvedValue([
            JSON.stringify({ html: '<p>Page 1</p>' }),
            JSON.stringify({ html: '<p>Page 2</p>' }),
        ]);

        // Mock Modal Response (Base64 PDF)
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ pdf: 'JVBERi0xLjcKCjEgMCBvYmogICUgZW50cnkgcG9pbnQKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgRlbmRvYmoKCjIgMCBvYmogCjw8CiAgL1R5cGUgL1BhZ2VzCiAgL01lZGlhQm94IFsgMCAwIDIwMCAyMDAgXQogIC9Db3VudCAxCiAgL0tpZHMgWyAzIDAgUiBdCj4+CmVuZG9iagoKMyAwIG9iago8PAogIC9UeXBlIC9QYWdlCiAgL1BhcmVudCAyIDAgUgogIC9SZXNvdXJjZXMgPDwKICAgIC9Gb250IDw8CiAgICAgIC9GMSA0IDAgUgogICAgPj4KICA+PgogIC9Db250ZW50cyA1IDAgUgo+PgRlbmRvYmoKCjQgMCBvYmoKPDwKICAvVHlwZSAvRm9udAogIC9TdWJ0eXBlIC9UeXBlMQogIC9CYXNlRm9udCAvVGltZXMtUm9tYW4KPj4KZW5kb2JqCgo1IDAgb2JqCjw8IC9MZW5ndGggNDQgPj4Kc3RyZWFtCkJUCjcwIDUwIFRECi9GMSAxMiBUZgooSGVsbG8sIHdvcmxkISkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNjAgMDAwMDAgbiAKMDAwMDAwMDE1NyAwMDAwMCBuIAowMDAwMDAwMjU1IDAwMDAwIG4gCjAwMDAwMDAzNDQgMDAwMDAgbiAKdHJhaWxlcgo8PAogIC9TaXplIDYKICAvUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKNDQxCjw4' }), // Valid minimal PDF base64
        });

        (uploadFile as jest.Mock).mockResolvedValue('outputs/job123.pdf');
        (getDownloadUrl as jest.Mock).mockResolvedValue('https://b2.com/final.pdf');

        const params = Promise.resolve({ jobId: 'job123' });
        const req = new NextRequest('http://localhost:3000/api/jobs/job123/finalize', { method: 'POST' });

        const res = await POST(req, { params });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.pdfUrl).toBe('https://b2.com/final.pdf');

        // Check Redis Status Update
        expect(redis.set).toHaveBeenCalledWith(
            'job:job123',
            expect.objectContaining({
                status: 'complete',
                finalPdfUrl: 'https://b2.com/final.pdf',
                emailStatus: 'queued',
            }),
            expect.anything()
        );

        // Check Email Queue
        expect(queueEmailDelivery).toHaveBeenCalledWith(expect.objectContaining({
            jobId: 'job123',
            email: 'test@example.com',
            pdfUrl: 'https://b2.com/final.pdf',
        }));
    });

    it('API-FIN-006: Non-existent job returns 404', async () => {
        (redis.get as jest.Mock).mockResolvedValue(null);

        const params = Promise.resolve({ jobId: 'unknown' });
        const req = new NextRequest('http://localhost:3000/api/jobs/unknown/finalize', { method: 'POST' });

        const res = await POST(req, { params });
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.error).toBe('Job not found');
    });
});
