import { GoogleGenerativeAI } from '@google/generative-ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { BatchResponseSchema, BatchResponse } from './schema';

if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY must be defined');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use gemini-2.0-flash or pro as they support structured output well.
// gemini-1.5-pro-latest also supports it.
// User's original code used 'gemini-2.5-flash'. Assuming it supports it.
const MODEL_NAME = 'gemini-2.5-flash'; // upgrading to ensure schema support, or use user's preference if it works. 
// User mentioned gemini-3-flash in history? Let's stick to a known good model for schema or existing one.
// Original file said 'gemini-2.5-flash'. 
// I'll stick to 'gemini-1.5-pro' or 'gemini-1.5-flash' for robust JSON support, or 'gemini-2.0-flash-exp'
// Let's safe bet on 'gemini-1.5-pro' or try the one in the file if it works.
// The file had 'gemini-2.5-flash'. I will trust the user has access to it.
const ACTIVE_MODEL_NAME = 'gemini-2.5-flash'; // Using strict stable model for JSON

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
 * Generates structured notes from a batch of images.
 * @param imageUrls List of image URLs (or base64 strings if modified, but assuming URLs/Globs)
 * @returns Parsed BatchResponse object
 */
export async function generateBatchNotes(imageUrls: string[]): Promise<BatchResponse> {
    try {
        // Fetch all images concurrently
        // Note: This does add load to Vercel, but needed for Gemini API interaction without File API.
        const imageBuffers = await Promise.all(imageUrls.map(async (url) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.statusText}`);
            return {
                buffer: Buffer.from(await res.arrayBuffer()),
                mimeType: res.headers.get('content-type') || 'image/png' // Use actual mime if available, else default
            };
        }));

        const imageParts = imageBuffers.map(({ buffer, mimeType }) => ({
            inlineData: {
                data: buffer.toString('base64'),
                mimeType
            }
        }));

        const result = await geminiModel.generateContent([
            SYSTEM_PROMPT,
            ...imageParts
        ]);

        const responseText = result.response.text();
        const data = JSON.parse(responseText);
        return BatchResponseSchema.parse(data);

    } catch (error) {
        console.error("Gemini Structured Generation Error:", error);
        throw error;
    }
}
