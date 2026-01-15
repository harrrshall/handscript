import { z } from 'zod';

const LatexString = z.string().describe("Valid LaTeX math string. Do NOT use delimiters like $ or $$.");

export const ContentBlockSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("paragraph"),
        text: z.string().describe("Text content. Inline math in single $ allowed.")
    }),
    z.object({
        type: z.literal("heading"),
        level: z.number().int().min(1).max(3),
        text: z.string()
    }),
    z.object({
        type: z.literal("math"),
        latex: LatexString,
        display: z.boolean()
    }),
    z.object({
        type: z.literal("list"),
        items: z.array(z.string()),
        ordered: z.boolean()
    }),
    z.object({
        type: z.literal("container"),
        kind: z.enum(["theorem", "proof", "definition", "example", "note", "warning", "tip", "important"]),
        title: z.string().optional(),
        content: z.string()
    }),
    z.object({
        type: z.literal("diagram"),
        description: z.string(),
        label: z.string().optional()
    })
]);

export const PageSchema = z.object({
    pageIndex: z.number().int(),
    content: z.array(ContentBlockSchema)
});

export const BatchResponseSchema = z.object({
    metadata: z.object({
        title: z.string(),
        subject: z.string(),
        documentType: z.enum(["lecture", "problem-set", "summary", "other"]),
    }),
    pages: z.array(PageSchema)
});

export const DocumentSchema = z.object({
    metadata: BatchResponseSchema.shape.metadata,
    content: z.array(ContentBlockSchema),
});

// Schema for single page response (used in atomic processing)
export const SinglePageResponseSchema = z.object({
    metadata: z.object({
        title: z.string(),
        subject: z.string(),
        documentType: z.enum(["lecture", "problem-set", "summary", "other"]),
    }),
    content: z.array(ContentBlockSchema)
});

export type DocumentIR = z.infer<typeof DocumentSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type BatchResponse = z.infer<typeof BatchResponseSchema>;
export type Page = z.infer<typeof PageSchema>;
export type SinglePageResponse = z.infer<typeof SinglePageResponseSchema>;

