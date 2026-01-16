import { z } from 'zod';

const envSchema = z.object({
    // Gemini
    GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

    // Redis
    UPSTASH_REDIS_REST_URL: z.string().url('Invalid Redis URL'),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

    // Backblaze B2 / S3
    B2_ENDPOINT: z.string().min(1, 'B2_ENDPOINT is required'),
    B2_REGION: z.string().min(1, 'B2_REGION is required'),
    B2_KEY_ID: z.string().min(1, 'B2_KEY_ID is required'),
    B2_APPLICATION_KEY: z.string().min(1, 'B2_APPLICATION_KEY is required'),
    B2_BUCKET_NAME: z.string().min(1, 'B2_BUCKET_NAME is required'),

    // QStash
    QSTASH_TOKEN: z.string().optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().optional(),

    // Email
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    GMAIL_USER: z.string().optional(),
    GMAIL_APP_PASSWORD: z.string().optional(),

    // PDF Rendering
    MODAL_PDF_ENDPOINT: z.string().url().optional(),

    // Vercel / Misc
    VERCEL_URL: z.string().optional(),
    PRODUCTION_URL: z.string().optional(),
    CRON_SECRET: z.string().optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
    // If we're during build time, we might want to skip strict validation
    // OR we might want to ensure everything is there. 
    // Given Priority 1 is "Create env validation module", we should be strict
    // but maybe allow missing optional ones.

    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        result.error.issues.forEach((issue) => {
            console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
        });

        // In production, we should probably crash if critical vars are missing.
        // In development, we can be slightly more lenient but still warn.
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Invalid environment configuration. See logs for details.');
        }
    }

    return (result.success ? result.data : process.env) as Env;
}

export const env = validateEnv();
