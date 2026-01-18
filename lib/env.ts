import { z } from 'zod';

// Helper to check if we're in local development mode (no external services)
const isLocalDevMode = () => {
    return !process.env.UPSTASH_REDIS_REST_URL || !process.env.B2_BUCKET_NAME;
};

// Base schema - only GEMINI_API_KEY is truly required for local dev
const baseEnvSchema = z.object({
    // Gemini - Required
    GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

    // Environment
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Vercel / Misc
    VERCEL_URL: z.string().optional(),
    PRODUCTION_URL: z.string().optional(),
    CRON_SECRET: z.string().optional(),

    // QStash - Optional (bypassed in local dev)
    QSTASH_TOKEN: z.string().optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().optional(),

    // Email - Optional
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    GMAIL_USER: z.string().optional(),
    GMAIL_APP_PASSWORD: z.string().optional(),

    // PDF Rendering - Optional
    MODAL_PDF_ENDPOINT: z.string().url().optional(),
});

// Production schema - requires external services
const productionEnvSchema = baseEnvSchema.extend({
    // Redis - Required in production
    UPSTASH_REDIS_REST_URL: z.string().url('Invalid Redis URL'),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

    // Backblaze B2 / S3 - Required in production
    B2_ENDPOINT: z.string().min(1, 'B2_ENDPOINT is required'),
    B2_REGION: z.string().min(1, 'B2_REGION is required'),
    B2_KEY_ID: z.string().min(1, 'B2_KEY_ID is required'),
    B2_APPLICATION_KEY: z.string().min(1, 'B2_APPLICATION_KEY is required'),
    B2_BUCKET_NAME: z.string().min(1, 'B2_BUCKET_NAME is required'),
});

// Development schema - external services are optional  
const developmentEnvSchema = baseEnvSchema.extend({
    // Redis - Optional in dev (uses in-memory fallback)
    UPSTASH_REDIS_REST_URL: z.string().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

    // Backblaze B2 / S3 - Optional in dev (uses local filesystem)
    B2_ENDPOINT: z.string().optional(),
    B2_REGION: z.string().optional(),
    B2_KEY_ID: z.string().optional(),
    B2_APPLICATION_KEY: z.string().optional(),
    B2_BUCKET_NAME: z.string().optional(),
});

type ProductionEnv = z.infer<typeof productionEnvSchema>;
type DevelopmentEnv = z.infer<typeof developmentEnvSchema>;
type Env = ProductionEnv | DevelopmentEnv;

function validateEnv(): Env {
    const isProduction = process.env.NODE_ENV === 'production';
    const schema = isProduction ? productionEnvSchema : developmentEnvSchema;

    const result = schema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        result.error.issues.forEach((issue) => {
            console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
        });

        if (isProduction) {
            throw new Error('Invalid environment configuration. See logs for details.');
        }

        // In development, warn but continue with partial env
        console.warn('⚠️ Running in LOCAL DEV MODE with minimal configuration');
    }

    return (result.success ? result.data : process.env) as Env;
}

export const env = validateEnv();

// Export helper for checking local dev mode
export const LOCAL_DEV_MODE = isLocalDevMode();

if (LOCAL_DEV_MODE && process.env.NODE_ENV !== 'test') {
    console.log('🏠 LOCAL DEV MODE: Using in-memory storage (no Redis/B2 required)');
}
