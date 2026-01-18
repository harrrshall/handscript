/**
 * S3/B2 Storage client with local filesystem fallback for development
 * When B2_BUCKET_NAME is not configured, uses local public/uploads directory
 */

import { env, LOCAL_DEV_MODE } from './env';
import { promises as fs } from 'fs';
import path from 'path';

// Local storage directory for development
const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'public', 'uploads');

// Ensure local storage directory exists
async function ensureLocalStorageDir() {
    try {
        await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
    } catch (e) {
        // Directory might already exist
    }
}

// ============ LOCAL FILESYSTEM IMPLEMENTATION ============

async function localUploadFile(
    key: string,
    body: Buffer | string | Uint8Array,
    contentType: string
): Promise<string> {
    await ensureLocalStorageDir();
    const filePath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, '_'));
    console.log(`[Local S3] Writing to: ${filePath}`);
    const buffer = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
    await fs.writeFile(filePath, buffer);
    return key;
}

async function localDeleteFile(keyOrUrl: string | string[]) {
    const keys = Array.isArray(keyOrUrl) ? keyOrUrl : [keyOrUrl];
    for (const key of keys) {
        try {
            const filePath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, '_'));
            await fs.unlink(filePath);
        } catch (e) {
            // File might not exist
        }
    }
}

async function localListFiles(options?: { limit?: number; cursor?: string }) {
    await ensureLocalStorageDir();
    try {
        const files = await fs.readdir(LOCAL_STORAGE_DIR);
        const stats = await Promise.all(
            files.map(async (filename) => {
                const filePath = path.join(LOCAL_STORAGE_DIR, filename);
                const stat = await fs.stat(filePath);
                return {
                    url: filename,
                    pathname: filename,
                    uploadedAt: stat.mtime,
                };
            })
        );
        return {
            blobs: stats.slice(0, options?.limit || 1000),
            hasMore: false,
            cursor: undefined,
        };
    } catch (e) {
        return { blobs: [], hasMore: false, cursor: undefined };
    }
}

async function localGetDownloadUrl(key: string, expiresSec = 3600, downloadName?: string): Promise<string> {
    // Return a full absolute URL that Next.js can serve from public/uploads
    // This is needed because server-side fetch() requires absolute URLs
    const filename = key.replace(/\//g, '_');
    const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';
    return `${baseUrl}/uploads/${filename}`;
}

async function localGetUploadPresignedUrl(key: string, contentType: string, expiresSec = 3600): Promise<string> {
    // For local dev, we'll use the direct upload API endpoint
    // The client will need to POST to /api/upload instead
    return `/api/upload?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}`;
}

// Raw file read for local storage
async function localReadFile(key: string): Promise<Buffer | null> {
    try {
        const filePath = path.join(LOCAL_STORAGE_DIR, key.replace(/\//g, '_'));
        return await fs.readFile(filePath);
    } catch (e) {
        return null;
    }
}

// ============ S3/B2 IMPLEMENTATION ============

let s3Client: any = null;
let BUCKET_NAME: string = '';

// Only initialize S3 if we have B2 credentials
if (!LOCAL_DEV_MODE) {
    const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

    const cleanToken = (token: string | undefined) => {
        if (!token) return undefined;
        return token.trim().replace(/['"]/g, '');
    };

    s3Client = new S3Client({
        endpoint: env.B2_ENDPOINT!.startsWith("http")
            ? env.B2_ENDPOINT
            : `https://${env.B2_ENDPOINT}`,
        region: env.B2_REGION,
        credentials: {
            accessKeyId: cleanToken(env.B2_KEY_ID)!,
            secretAccessKey: cleanToken(env.B2_APPLICATION_KEY)!,
        },
    });

    BUCKET_NAME = env.B2_BUCKET_NAME!;
}

// ============ EXPORTED FUNCTIONS ============

export async function uploadFile(
    key: string,
    body: Buffer | string | Uint8Array,
    contentType: string
): Promise<string> {
    if (LOCAL_DEV_MODE) {
        return localUploadFile(key, body, contentType);
    }

    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
    });
    await s3Client.send(command);
    return key;
}

export async function deleteFile(keyOrUrl: string | string[]) {
    if (LOCAL_DEV_MODE) {
        return localDeleteFile(keyOrUrl);
    }

    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const keys = Array.isArray(keyOrUrl) ? keyOrUrl : [keyOrUrl];
    const endpointHost = env.B2_ENDPOINT!.replace("https://", "");

    const parsedKeys = keys.map(k => {
        if (k.startsWith("http")) {
            try {
                const url = new URL(k);
                return url.pathname.substring(1);
            } catch (e) { return k; }
        }
        return k;
    });

    await Promise.all(
        parsedKeys.map(async (key) => {
            try {
                const command = new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: key,
                });
                await s3Client.send(command);
            } catch (e) {
                console.warn(`Failed to delete ${key}`, e);
            }
        })
    );
}

export async function listFiles(options?: { limit?: number; cursor?: string }) {
    if (LOCAL_DEV_MODE) {
        return localListFiles(options);
    }

    const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
    const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        MaxKeys: options?.limit || 1000,
        ContinuationToken: options?.cursor,
    });

    const response = await s3Client.send(command);
    const blobs = (response.Contents || []).map((obj: any) => ({
        url: obj.Key || "",
        pathname: obj.Key || "",
        uploadedAt: obj.LastModified || new Date(),
    }));

    return {
        blobs,
        hasMore: !!response.IsTruncated,
        cursor: response.NextContinuationToken,
    };
}

export async function getDownloadUrl(key: string, expiresSec = 3600, downloadName?: string): Promise<string> {
    if (LOCAL_DEV_MODE) {
        return localGetDownloadUrl(key, expiresSec, downloadName);
    }

    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName}"` : undefined,
    });
    return await getSignedUrl(s3Client, command, { expiresIn: expiresSec });
}

export async function getUploadPresignedUrl(key: string, contentType: string, expiresSec = 3600): Promise<string> {
    if (LOCAL_DEV_MODE) {
        return localGetUploadPresignedUrl(key, contentType, expiresSec);
    }

    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });
    return await getSignedUrl(s3Client, command, { expiresIn: expiresSec });
}

/**
 * Download a file's contents directly (for internal processing)
 * In local mode, reads from filesystem. In production, downloads from S3.
 */
export async function downloadFile(key: string): Promise<Buffer> {
    if (LOCAL_DEV_MODE) {
        const content = await localReadFile(key);
        if (!content) {
            throw new Error(`File not found: ${key}`);
        }
        return content;
    }

    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
    });

    const response = await s3Client.send(command);
    const chunks: Uint8Array[] = [];

    // @ts-ignore - Body is a readable stream
    for await (const chunk of response.Body) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

// Export local file read for the upload endpoint
export { localReadFile as readLocalFile };
