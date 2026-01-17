import { GoogleGenerativeAI } from '@google/generative-ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BatchResponseSchema, BatchResponse, SinglePageResponseSchema, SinglePageResponse, ContentBlockSchema } from './schema';
import { env } from './env';
import { withRetry, withTimeout } from './utils';
import { logger, metrics } from './logger';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// UPDATED: Use gemini-2.5-flash for external URL support
// Note: Gemini 2.0 family does NOT support external URLs
const ACTIVE_MODEL_NAME = 'gemini-2.5-flash';

function cleanSchema(schema: any): any {
    if (typeof schema !== 'object' || schema === null) return schema;
    if (Array.isArray(schema)) return schema.map(cleanSchema);

    const { additionalProperties, ...rest } = schema;
    const cleaned: any = { ...rest };

    if (cleaned.properties) {
        cleaned.properties = Object.fromEntries(
            Object.entries(cleaned.properties).map(([k, v]) => [k, cleanSchema(v)])
        );
    }
    if (cleaned.items) {
        cleaned.items = cleanSchema(cleaned.items);
    }
    if (cleaned.anyOf) {
        cleaned.anyOf = cleaned.anyOf.map(cleanSchema);
    }

    return cleaned;
}

const rawSchema = zodToJsonSchema(BatchResponseSchema, { target: "openApi3" });
const cleanedSchema = cleanSchema(rawSchema);

// Schema for single page response
const rawSinglePageSchema = zodToJsonSchema(SinglePageResponseSchema, { target: "openApi3" });
const cleanedSinglePageSchema = cleanSchema(rawSinglePageSchema);

export const geminiModel = genAI.getGenerativeModel({
    model: ACTIVE_MODEL_NAME,
    generationConfig: {
        responseMimeType: "application/json",
        responseSchema: cleanedSchema as any
    }
});

// Model configured for single-page responses
export const geminiSinglePageModel = genAI.getGenerativeModel({
    model: ACTIVE_MODEL_NAME,
    generationConfig: {
        responseMimeType: "application/json",
        responseSchema: cleanedSinglePageSchema as any
    }
});

export const SYSTEM_PROMPT = `
You are an expert academic transcription system.
Your goal is to transcribe handwritten notes into a structured format.

INPUT:
- A batch of images (pages of notes) from external URLs.

OUTPUT:
- A JSON object adhering strictly to the provided schema.
- The schema contains a 'pages' array. You must populate it with one entry per image in the input batch.
- 'pageIndex' must match the order of images (0, 1, 2...).

TRANSCRIPTION RULES:
- Transcribe EXACTLY what is written. Do not summarize or "fix" content.
- Use valid LaTeX for math.
- For semantic blocks (Theorems, Proofs, etc.), use the 'container' type.
- For diagrams, provide a detailed description in the 'diagram' type.
- If text is illegible, use "[UNCLEAR]" or [ILLEGIBLE].
`;

export const SINGLE_PAGE_PROMPT = `
You are an expert academic transcription system.
Your goal is to transcribe handwritten notes into a structured format.

INPUT:
- A single image (one page of notes) from an external URL.

OUTPUT:
- A JSON object adhering strictly to the provided schema.
- Return metadata about the document and an array of content blocks for this page.

TRANSCRIPTION RULES:
- Transcribe EXACTLY what is written. Do not summarize or "fix" content.
- Use valid LaTeX for math.
- For semantic blocks (Theorems, Proofs, etc.), use the 'container' type.
- For diagrams, provide a detailed description in the 'diagram' type.
- If text is illegible, use "[UNCLEAR]" or [ILLEGIBLE].
`;

/**
 * Generates structured notes from a batch of images using External URLs.
 * Gemini fetches images directly - no bandwidth through Vercel!
 *
 * @param signedUrls Pre-signed URLs to images in B2 (must be valid for processing duration)
 * @returns Parsed BatchResponse object
 */
// lib/gemini.ts

export async function generateBatchNotes(signedUrls: string[]): Promise<BatchResponse> {
    try {
        // FIXED: Fetch images and use inlineData instead of fileUri
        // fileUri only works with Gemini's File API, not external URLs
        const imageParts = await Promise.all(signedUrls.map(async (url) => {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch image from ${url}: ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            const mimeType = contentType.split(';')[0].trim();

            return {
                inlineData: {
                    data: base64,
                    mimeType: mimeType,
                },
            };
        }));

        logger.info("GeminiRequest", {
            metadata: {
                method: "inlineData-base64",
                imageCount: signedUrls.length,
            }
        });

        const startTime = Date.now();

        const result = await withRetry(
            () => withTimeout(
                geminiModel.generateContent([
                    SYSTEM_PROMPT,
                    ...imageParts
                ]),
                50000,
                "Gemini request timed out"
            ),
            {
                maxRetries: 3,
                baseDelayMs: 1000,
                onRetry: (attempt, err) => console.warn(`[Gemini] Retry ${attempt} after error: ${err.message}`)
            }
        );

        const duration = Date.now() - startTime;
        await metrics.increment("gemini_requests");
        await metrics.recordLatency("gemini_processing", duration);

        const responseText = result.response.text();
        const data = JSON.parse(responseText);
        return BatchResponseSchema.parse(data);

    } catch (error: any) {
        await metrics.increment("gemini_errors");
        logger.error("GeminiError", {
            error: error.message,
            metadata: {
                isUrlError:
                    error.message?.includes("url_retrieval") ||
                    error.message?.includes("Invalid file_uri") ||
                    error.message?.includes("fetch"),
            }
        });
        throw error;
    }
}


/**
 * Generates structured notes for a SINGLE image (atomic processing).
 * Designed for parallel fan-out pattern - each call handles exactly one page.
 * Uses a 40s timeout to stay well under Vercel's 60s limit.
 * 
 * UPDATED: Fetches image from URL and sends as base64 inlineData
 * because fileUri only works with Gemini's File API, not external URLs.
 *
 * @param signedUrl Pre-signed URL to single image in B2
 * @returns Parsed SinglePageResponse object
 */
export async function generateNotesForSingleImage(signedUrl: string): Promise<SinglePageResponse> {
    try {
        // Fetch image from signed URL and convert to base64
        const imageResponse = await fetch(signedUrl);
        if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
        }

        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');

        // Detect mime type from content-type header or default to png
        const contentType = imageResponse.headers.get('content-type') || 'image/png';
        const mimeType = contentType.split(';')[0].trim();

        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: mimeType,
            },
        };

        logger.info("GeminiSingleImageRequest", {
            metadata: {
                method: "inlineData-base64",
                imageSize: imageBuffer.byteLength,
            }
        });

        const startTime = Date.now();

        const result = await withRetry(
            () => withTimeout(
                geminiSinglePageModel.generateContent([
                    SINGLE_PAGE_PROMPT,
                    imagePart
                ]),
                55000, // 55s timeout - close to Vercel's 60s limit
                "Gemini single-image request timed out"
            ),
            {
                maxRetries: 2, // Fewer retries since QStash handles retries too
                baseDelayMs: 1000,
                onRetry: (attempt, err) => console.warn(`[Gemini-Single] Retry ${attempt}: ${err.message}`)
            }
        );

        const duration = Date.now() - startTime;
        await metrics.increment("gemini_single_requests");
        await metrics.recordLatency("gemini_single_processing", duration);

        const responseText = result.response.text();
        const data = JSON.parse(responseText);
        return SinglePageResponseSchema.parse(data);

    } catch (error: any) {
        await metrics.increment("gemini_single_errors");
        logger.error("GeminiSingleImageError", {
            error: error.message,
            metadata: {
                isUrlError:
                    error.message?.includes("url_retrieval") ||
                    error.message?.includes("Invalid file_uri") ||
                    error.message?.includes("fetch"),
            }
        });
        throw error;
    }
}


