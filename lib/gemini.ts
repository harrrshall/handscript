import { GoogleGenerativeAI } from '@google/generative-ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BatchResponseSchema, BatchResponse } from './schema';
import { env } from './env';
import { withRetry, withTimeout } from './utils';
import { logger, metrics } from './logger';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// IMPORTANT: Gemini 2.0 does NOT support external URLs
// Must use 2.5+ or 1.5 models. current: gemini-2.5-flash
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

export const geminiModel = genAI.getGenerativeModel({
    model: ACTIVE_MODEL_NAME,
    generationConfig: {
        responseMimeType: "application/json",
        responseSchema: cleanedSchema as any
    }
});

export const SYSTEM_PROMPT = `
You are an expert academic transcription system.
Your goal is to transcribe handwritten notes into a structured format.

INPUT:
- A batch of images (pages of notes).

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
        // OPTIMIZED: Use fileData with fileUri instead of inlineData
        // Gemini fetches directly from B2, bypassing Vercel bandwidth
        const imageParts = signedUrls.map((url) => ({
            fileData: {
                fileUri: url,
                mimeType: "image/png",
            },
        }));

        logger.info("GeminiRequest", {
            metadata: {
                method: "fileUri",
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
                25000,
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
                    error.message?.includes("Invalid file_uri"),
            }
        });
        throw error;
    }
}
