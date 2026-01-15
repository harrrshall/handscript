import { loadEnvConfig } from '@next/env';
import { vi } from 'vitest';

// Verify if global.jest is already defined to avoid conflicts, though safely setting it is fine.
// @ts-ignore
global.jest = vi;

// Load env vars if available (e.g. from .env.local), but don't crash if missing
const projectDir = process.cwd();
try {
    loadEnvConfig(projectDir);
} catch (e) {
    console.warn('Failed to load next env config', e);
}

// Fallback/Mock environment variables for testing
// These ensure tests pass even if .env.test cannot be written to disk
if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = 'test_gemini_key_12345';
if (!process.env.UPSTASH_REDIS_REST_URL) process.env.UPSTASH_REDIS_REST_URL = 'https://test-redis.upstash.io';
if (!process.env.UPSTASH_REDIS_REST_TOKEN) process.env.UPSTASH_REDIS_REST_TOKEN = 'test_redis_token';
if (!process.env.QSTASH_TOKEN) process.env.QSTASH_TOKEN = 'mock_qstash_token';
if (!process.env.B2_ENDPOINT) process.env.B2_ENDPOINT = 'https://s3.us-west-002.backblazeb2.com';
if (!process.env.B2_REGION) process.env.B2_REGION = 'us-west-002';
if (!process.env.B2_KEY_ID) process.env.B2_KEY_ID = 'test_key_id';
if (!process.env.B2_APPLICATION_KEY) process.env.B2_APPLICATION_KEY = 'test_app_key';
if (!process.env.B2_BUCKET_NAME) process.env.B2_BUCKET_NAME = 'test-bucket';
if (!process.env.RESEND_API_KEY) process.env.RESEND_API_KEY = 're_test_12345';
if (!process.env.MODAL_PDF_ENDPOINT) process.env.MODAL_PDF_ENDPOINT = 'https://example.com/modal-pdf';
if (!process.env.VERCEL_URL) process.env.VERCEL_URL = 'localhost:3000';
if (!process.env.CRON_SECRET) process.env.CRON_SECRET = 'test_cron_secret';
