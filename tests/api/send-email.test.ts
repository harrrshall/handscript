import { POST } from '../../app/api/send-email/route';
import { NextRequest } from 'next/server';
import { redis } from '../../lib/redis';
import { getDownloadUrl } from '../../lib/s3';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';

// Mock dependencies
vi.mock('@/lib/mailer', () => ({
    sendEmail: vi.fn(),
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
        warn: vi.fn(), // Added warn to logger mock
    },
    metrics: {
        increment: vi.fn(),
    },
}));
vi.mock('../../lib/env', () => ({
    env: {
        GMAIL_USER: 'test@example.com',
        GMAIL_APP_PASSWORD: 'test_password',
    },
}));

import { sendEmail } from '@/lib/mailer';

describe('POST /api/send-email', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (getDownloadUrl as Mock).mockResolvedValue('https://b2.com/refreshed.pdf');
    });

    it('API-EML-001: Sends email successfully', async () => {
        (sendEmail as Mock).mockResolvedValue({ success: true, messageId: 'email_123' });
        (redis.get as Mock).mockResolvedValue({ id: 'job123' });

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
        expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'user@example.com',
            subject: expect.stringContaining('Ready'),
        }));

        expect(redis.set).toHaveBeenCalledWith(
            'job:job123',
            expect.objectContaining({
                emailStatus: 'sent',
                emailId: 'email_123',
            })
        );
    });
});
