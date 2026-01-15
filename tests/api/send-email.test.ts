import { POST } from '../../app/api/send-email/route';
import { NextRequest } from 'next/server';
import { Resend } from 'resend';
import { redis } from '../../lib/redis';
import { getDownloadUrl } from '../../lib/s3';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('resend', () => ({
    Resend: vi.fn(),
}));

vi.mock('../../lib/redis', () => ({
    redis: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));
vi.mock('../../lib/s3', () => ({
    getDownloadUrl: vi.fn(),
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
vi.mock('../../lib/env', () => ({
    env: {
        RESEND_API_KEY: 'test_key',
        EMAIL_FROM: 'test@example.com',
    },
}));

describe('POST /api/send-email', () => {
    let mockSend: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSend = vi.fn();
        (Resend as any).mockImplementation(() => ({
            emails: {
                send: mockSend,
            },
        }));
        (getDownloadUrl as any).mockResolvedValue('https://b2.com/refreshed.pdf');
    });

    it('API-EML-001: Sends email successfully', async () => {
        mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null });
        (redis.get as any).mockResolvedValue({ id: 'job123' });

        const body = {
            jobId: 'job123',
            email: 'user@example.com',
            pdfUrl: 'https://b2.com/old.pdf',
            pdfKey: 'outputs/job123.pdf',
        };

        const req = new NextRequest('http://localhost:3000/api/send-email', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.emailId).toBe('email_123');

        expect(getDownloadUrl).toHaveBeenCalledWith('outputs/job123.pdf', 86400, 'handscript-notes.pdf');
        expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
            to: 'user@example.com',
            subject: expect.stringContaining('PDF is Ready'),
        }));

        expect(redis.set).toHaveBeenCalledWith(
            'job:job123',
            expect.objectContaining({
                emailStatus: 'sent',
                emailId: 'email_123',
            }),
            expect.anything()
        );
    });
});
