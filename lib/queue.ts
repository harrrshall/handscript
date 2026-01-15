import { Client } from "@upstash/qstash";
import { env } from './env';
import { getBaseUrl, isLocalhost } from './utils';
import { logger, metrics } from './logger';

export const qstash = new Client({
    token: env.QSTASH_TOKEN || "mock_token",
});

export interface EmailJobPayload {
    jobId: string;
    email: string;
    pdfUrl: string;
    pdfKey?: string;
}

// Helper to bypass QStash in local development or if not configured
export async function publishToQStash(url: string, body: any) {
    // If URL is localhost, we can't use QStash (it can't reach us).
    // Bypassing logic for local dev:
    if (isLocalhost(url)) {
        logger.info(`QueueLocalBypass`, { url });
        // We perform a fire-and-forget fetch to simulate queueing.
        // We don't await the result to mimic async nature, OR we await with catch to avoid crashing.
        fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }).catch(err => logger.error(`QueueLocalDispatchFailed`, { metadata: { url }, error: String(err) }));

        return { messageId: "local-dev-mock-id" };
    }

    if (!env.QSTASH_TOKEN) {
        logger.warn("QueueSkippedNoToken", { url });
        return { messageId: "skipped-no-token" };
    }

    const result = await qstash.publishJSON({
        url,
        body,
        retries: 3,
    });

    await metrics.increment("qstash_published");
    logger.info('QStashPublish', {
        url,
        messageId: result.messageId,
    });
    return result;
}

export async function queueEmailDelivery(payload: EmailJobPayload) {
    const baseUrl = getBaseUrl();

    return publishToQStash(`${baseUrl}/api/send-email`, payload);
}

export interface ErrorEmailPayload {
    jobId: string;
    email: string;
    errorMessage: string;
}

export async function queueErrorEmail(payload: ErrorEmailPayload) {
    const baseUrl = getBaseUrl();

    return publishToQStash(`${baseUrl}/api/send-error-email`, payload);
}
