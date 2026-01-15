import { GET } from '../../app/api/cron/cleanup/route';
import { NextRequest } from 'next/server';
import { listFiles, deleteFile } from '../../lib/s3';

// Mock dependencies
jest.mock('../../lib/s3', () => ({
    listFiles: jest.fn(),
    deleteFile: jest.fn(),
}));

describe('GET /api/cron/cleanup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CRON_SECRET = 'test_secret';
    });

    it('API-CRN-001: Unauthorized without secret', async () => {
        const req = new NextRequest('http://localhost:3000/api/cron/cleanup', {
            method: 'GET',
            headers: { Authorization: 'Bearer wrong_secret' },
        });

        const res = await GET(req);
        const data = await res.json();

        expect(res.status).toBe(401);
        expect(data.error).toBe('Unauthorized');
    });

    it('API-CRN-002: Deletes old input files', async () => {
        const now = Date.now();
        const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
        const oneMinuteAgo = new Date(now - 60 * 1000).toISOString();

        (listFiles as jest.Mock).mockResolvedValue({
            blobs: [
                { pathname: 'inputs/old.png', uploadedAt: twoHoursAgo },
                { pathname: 'outputs/old.pdf', uploadedAt: twoHoursAgo },
                { pathname: 'inputs/new.png', uploadedAt: oneMinuteAgo },
            ],
        });

        const req = new NextRequest('http://localhost:3000/api/cron/cleanup', {
            method: 'GET',
            headers: { Authorization: 'Bearer test_secret' },
        });

        const res = await GET(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.deletedCount).toBe(2);
        expect(deleteFile).toHaveBeenCalledWith(expect.arrayContaining(['inputs/old.png', 'outputs/old.pdf']));
        expect(deleteFile).not.toHaveBeenCalledWith(expect.arrayContaining(['inputs/new.png']));
    });

    it('API-CRN-005: Ignores recent files', async () => {
        const now = Date.now();
        const oneMinuteAgo = new Date(now - 60 * 1000).toISOString();

        (listFiles as jest.Mock).mockResolvedValue({
            blobs: [
                { pathname: 'inputs/recent.png', uploadedAt: oneMinuteAgo },
            ],
        });

        const req = new NextRequest('http://localhost:3000/api/cron/cleanup', {
            method: 'GET',
            headers: { Authorization: 'Bearer test_secret' },
        });

        await GET(req);

        expect(deleteFile).not.toHaveBeenCalled();
    });
});
