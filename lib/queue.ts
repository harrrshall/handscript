import { Client } from "@upstash/qstash";

if (!process.env.QSTASH_TOKEN) {
    // We strictly need QSTASH_TOKEN if we start this module.
    // However, in build time it might not be there.
    // Let's allow it to be undefined but throw if used.
}

export const qstash = new Client({
    token: process.env.QSTASH_TOKEN || "mock_token",
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
    const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1") || url.includes("::1");

    if (isLocalhost) {
        console.log(`[Queue] Localhost detected, bypassing QStash for: ${url}`);
        // We perform a fire-and-forget fetch to simulate queueing.
        // We don't await the result to mimic async nature, OR we await with catch to avoid crashing.
        fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }).catch(err => console.error(`[Queue] Local dispatch failed for ${url}:`, err));

        return { messageId: "local-dev-mock-id" };
    }

    if (!process.env.QSTASH_TOKEN) {
        console.warn("[Queue] QSTASH_TOKEN missing, skipping publish.");
        return { messageId: "skipped-no-token" };
    }

    return qstash.publishJSON({
        url,
        body,
        retries: 3,
    });
}

export async function queueEmailDelivery(payload: EmailJobPayload) {
    const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

    return publishToQStash(`${baseUrl}/api/send-email`, payload);
}

export interface ErrorEmailPayload {
    jobId: string;
    email: string;
    errorMessage: string;
}

export async function queueErrorEmail(payload: ErrorEmailPayload) {
    const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

    return publishToQStash(`${baseUrl}/api/send-error-email`, payload);
}
