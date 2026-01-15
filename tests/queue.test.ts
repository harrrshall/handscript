import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We will dynamically import these to allow resetting modules
// import { publishToQStash, queueEmailDelivery, queueErrorEmail } from '@/lib/queue';

// Hoisted mocks for QStash
const { mockPublishJSON } = vi.hoisted(() => {
    return { mockPublishJSON: vi.fn() };
});

vi.mock('@upstash/qstash', () => {
    return {
        Client: vi.fn().mockImplementation(function () {
            return {
                publishJSON: mockPublishJSON
            };
        })
    };
});

// Mock logger and metrics using relative path
vi.mock('@/lib/logger', () => {
    return {
        logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            logToRedis: vi.fn(),
        },
        metrics: {
            increment: vi.fn(),
            recordLatency: vi.fn(),
            gauge: vi.fn(),
        },
    };
});

// Mocking dependencies via relative path
vi.mock('../lib/utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/utils')>();
    return {
        ...actual,
        getBaseUrl: vi.fn().mockReturnValue('http://localhost:3000'),
        isLocalhost: vi.fn().mockReturnValue(true),
    };
});

describe('lib/queue.ts (Section 2.3)', () => {
    let mockFetch: any;
    let publishToQStash: any;
    let queueEmailDelivery: any;
    let queueErrorEmail: any;

    beforeEach(async () => {
        vi.resetModules(); // CRITICAL: Reset modules to handle re-imports and environment changes
        vi.clearAllMocks();

        process.env.QSTASH_TOKEN = 'mock_token';
        process.env.VERCEL_URL = 'test.vercel.app';

        mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);

        const utils = await import('../lib/utils');
        (utils.getBaseUrl as any).mockReturnValue('http://localhost:3000');
        (utils.isLocalhost as any).mockReturnValue(true);

        // Dynamic import after mocking
        const queueModule = await import('@/lib/queue');
        publishToQStash = queueModule.publishToQStash;
        queueEmailDelivery = queueModule.queueEmailDelivery;
        queueErrorEmail = queueModule.queueErrorEmail;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('QUE-001: publishToQStash localhost bypass', async () => {
        const localUrl = "http://localhost:3000/api/test";
        const payload = { data: 1 };

        const result = await publishToQStash(localUrl, payload);

        expect(mockPublishJSON).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(localUrl, expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(payload)
        }));
        expect(result.messageId).toBe("local-dev-mock-id");
    });

    it('QUE-002: publishToQStash 127.0.0.1 bypass', async () => {
        const localUrl = "http://127.0.0.1:3000/api/test";
        await publishToQStash(localUrl, {});
        expect(mockPublishJSON).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalled();
    });

    it('QUE-004: publishToQStash production call', async () => {
        const prodUrl = "https://myapp.com/api/test";
        const payload = { foo: 'bar' };
        mockPublishJSON.mockResolvedValue({ messageId: 'msg_123' });

        const utils = await import('../lib/utils');
        (utils.isLocalhost as any).mockReturnValue(false);

        const result = await publishToQStash(prodUrl, payload);

        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockPublishJSON).toHaveBeenCalledWith(expect.objectContaining({
            url: prodUrl,
            body: payload
        }));
        expect(result.messageId).toBe('msg_123');
    });

    it('QUE-006: queueEmail constructs correct URL', async () => {
        const prodUrl = 'https://my-app.vercel.app';
        const utils = await import('../lib/utils');
        (utils.getBaseUrl as any).mockReturnValue(prodUrl);
        (utils.isLocalhost as any).mockReturnValue(false);

        await queueEmailDelivery({ jobId: 'job_1', email: 'test@test.com', pdfUrl: 'http://pdf.url' });

        const expectedUrl = `${prodUrl}/api/send-email`;
        expect(mockPublishJSON).toHaveBeenCalledWith(expect.objectContaining({
            url: expectedUrl
        }));
    });

    it('QUE-007: queueErrorEmail constructs correct URL', async () => {
        const prodUrl = 'https://my-app.vercel.app';
        const utils = await import('../lib/utils');
        (utils.getBaseUrl as any).mockReturnValue(prodUrl);
        (utils.isLocalhost as any).mockReturnValue(false);

        await queueErrorEmail({ jobId: 'job_1', email: 'test@test.com', errorMessage: 'error msg' });

        const expectedUrl = `${prodUrl}/api/send-error-email`;
        expect(mockPublishJSON).toHaveBeenCalledWith(expect.objectContaining({
            url: expectedUrl
        }));
    });
});
