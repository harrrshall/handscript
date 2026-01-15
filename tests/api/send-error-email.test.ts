import { POST } from '../../app/api/send-error-email/route';
import { NextRequest } from 'next/server';
import { Resend } from 'resend';
import { redis } from '../../lib/redis';

// Mock dependencies
jest.mock('resend');
jest.mock('../../lib/redis', () => ({
    redis: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));
jest.mock('../../lib/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn(),
    },
    metrics: {
        increment: jest.fn(),
    },
}));
jest.mock('../../lib/env', () => ({
    env: {
        RESEND_API_KEY: 'test_key',
        EMAIL_FROM: 'test@example.com',
    },
}));
jest.mock('../../lib/utils', () => ({
    getBaseUrl: jest.fn().mockReturnValue('http://localhost:3000'),
}));

describe('POST /api/send-error-email', () => {
    let mockSend: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSend = jest.fn();
        (Resend as unknown as jest.Mock).mockImplementation(() => ({
            emails: {
                send: mockSend,
            },
        }));
        process.env.NODE_ENV = 'test';
    });

    it('API-ERR-001: Sends error email successfully', async () => {
        mockSend.mockResolvedValue({ data: { id: 'email_err_123' }, error: null });
        (redis.get as jest.Mock).mockResolvedValue({ id: 'job123' });

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

        expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
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
