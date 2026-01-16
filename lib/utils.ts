
import { env } from './env';

/**
 * Retry logic with exponential backoff
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries: number;
        baseDelayMs: number;
        onRetry?: (attempt: number, error: Error) => void
    }
): Promise<T> {
    let lastError: Error;
    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error instanceof Error ? error : new Error(String(error));
            options.onRetry?.(attempt, lastError);

            if (attempt < options.maxRetries) {
                const delay = options.baseDelayMs * Math.pow(2, attempt - 1);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw lastError!;
}

/**
 * Get the base URL for the application, correctly handling Vercel and local dev.
 */
export function getBaseUrl() {
    if (env.PRODUCTION_URL) {
        return env.PRODUCTION_URL.startsWith('http')
            ? env.PRODUCTION_URL
            : `https://${env.PRODUCTION_URL}`;
    }

    // Force valid production URL if in production (ignores ephemeral Vercel URLs)
    if (process.env.NODE_ENV === 'production') {
        return 'https://handscriptnotes.vercel.app';
    }

    if (env.VERCEL_URL) {
        return `https://${env.VERCEL_URL}`;
    }

    return 'http://localhost:3000';
}

/**
 * Check if a URL refers to localhost
 */
export function isLocalhost(url: string) {
    return (
        url.includes("localhost") ||
        url.includes("127.0.0.1") ||
        url.includes("::1") ||
        url.includes("0.0.0.0")
    );
}

/**
 * Timeout wrapper for promises
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(errorMsg)), ms);
    });
    return Promise.race([promise, timeout]);
}
