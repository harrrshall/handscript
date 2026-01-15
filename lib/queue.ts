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

export async function queueEmailDelivery(payload: EmailJobPayload) {
    if (!process.env.QSTASH_TOKEN) {
        throw new Error("QSTASH_TOKEN must be defined");
    }

    const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

    return qstash.publishJSON({
        url: `${baseUrl}/api/send-email`,
        body: payload,
        retries: 3,
        // Delay slightly to ensure PDF is fully available
        delay: "5s",
    });
}
