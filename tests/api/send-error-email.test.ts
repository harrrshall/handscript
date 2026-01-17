import { POST } from '../../app/api/send-error-email/route';
import { NextRequest } from 'next/server';
import { redis } from '../../lib/redis';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';

// Mock dependencies
vi.mock('../../lib/mailer', () => ({
    sendEmail: vi.fn(),
}));

vi.mock('../../lib/redis', () => ({
    redis: {
        get: vi.fn(),
        set: vi.fn(),
    },
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
        GMAIL_USER: 'test@example.com',
        GMAIL_APP_PASSWORD: 'test_password',
    },
}));
vi.mock('../../lib/utils', () => ({
    getBaseUrl: vi.fn().mockReturnValue('http://localhost:3000'),
}));

import { sendEmail } from '../../lib/mailer';

describe('POST /api/send-error-email', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NODE_ENV = 'test';
    });

    it('API-ERR-001: Sends error email successfully', async () => {
        (sendEmail as Mock).mockResolvedValue({ success: true, messageId: 'email_err_123' });
        (redis.get as Mock).mockResolvedValue({ id: 'job123' });

        const body = {
            jobId: 'job123',
            email: 'user@example.com',
            errorMessage: 'Something went wrong',
        };

        const req = new NextRequest('http://localhost:3000/api/send-error-email', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        const res = await POST(req);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.emailId).toBe('email_err_123');

        expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'user@example.com',
            subject: expect.stringContaining('Issue'),
            html: expect.stringContaining('Something went wrong'),
        }));

        expect(redis.set).toHaveBeenCalledWith(
            'job:job123',
            expect.objectContaining({
                errorEmailSent: true,
            })
        );
    });
});
