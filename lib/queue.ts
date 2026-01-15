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

// Batch message interface for QStash batch API
export interface BatchMessage {
    destination: string;
    body: any;
    headers?: Record<string, string>;
}

/**
 * Publish multiple messages to QStash in a single API call (fan-out pattern).
 * Uses QStash's batch endpoint for efficiency.
 * For localhost, dispatches each message individually with fire-and-forget.
 */
export async function batchPublishToQStash(messages: BatchMessage[]) {
    if (messages.length === 0) {
        return { results: [] };
    }

    // Check if first destination is localhost (all should be same host)
    if (isLocalhost(messages[0].destination)) {
        logger.info(`QueueBatchLocalBypass`, { messageCount: messages.length });

        // Fire-and-forget each message for local development
        const results = messages.map((msg, index) => {
            fetch(msg.destination, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...msg.headers
                },
                body: JSON.stringify(msg.body),
            }).catch(err =>
                logger.error(`QueueLocalDispatchFailed`, {
                    metadata: { url: msg.destination, index },
                    error: String(err)
                })
            );
            return { messageId: `local-dev-mock-id-${index}` };
        });

        return { results };
    }

    if (!env.QSTASH_TOKEN) {
        logger.warn("QueueBatchSkippedNoToken", { messageCount: messages.length });
        return { results: messages.map((_, i) => ({ messageId: `skipped-no-token-${i}` })) };
    }

    // Use QStash batch API
    const batchMessages = messages.map(msg => ({
        destination: msg.destination,
        body: JSON.stringify(msg.body),
        headers: {
            "Content-Type": "application/json",
            ...msg.headers
        },
        retries: 3,
    }));

    const results = await qstash.batchJSON(batchMessages);

    await metrics.increment("qstash_batch_published");
    logger.info('QStashBatchPublish', {
        messageCount: messages.length,
        metadata: { resultCount: Array.isArray(results) ? results.length : 1 },
    });

    return { results };
}
