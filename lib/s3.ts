
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const cleanToken = (token: string | undefined) => {
    if (!token) return undefined;
    const cleaned = token.trim().replace(/['"]/g, '');
    console.log(`Token '${token.substring(0, 4)}...' raw len: ${token.length}, cleaned len: ${cleaned.length}`);
    return cleaned;
};

const s3Client = new S3Client({
    endpoint: process.env.B2_ENDPOINT?.startsWith("http")
        ? process.env.B2_ENDPOINT
        : `https://${process.env.B2_ENDPOINT}`,
    region: process.env.B2_REGION,
    credentials: {
        accessKeyId: cleanToken(process.env.B2_KEY_ID)!,
        secretAccessKey: cleanToken(process.env.B2_APPLICATION_KEY)!,
    },
});

const BUCKET_NAME = process.env.B2_BUCKET_NAME!;

export async function uploadFile(
    key: string,
    body: Buffer | string | Uint8Array,
    contentType: string
): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Backblaze buckets configuration determines public access.
    });

    await s3Client.send(command);

    // For private buckets, we return the key
    return key;
}

export async function deleteFile(keyOrUrl: string | string[]) {
    const keys = Array.isArray(keyOrUrl) ? keyOrUrl : [keyOrUrl];

    // Handle URLs by extracting keys (if someone passes a full URL by mistake)
    // For private buckets, we primarily expect keys now.
    const endpointHost = process.env.B2_ENDPOINT?.replace("https://", "");
    const baseUrl = `https://${BUCKET_NAME}.${endpointHost}/`;

    const parsedKeys = keys.map(k => {
        // Simple heuristic: if it looks like a URL, try to strip host
        if (k.startsWith("http")) {
            try {
                const url = new URL(k);
                // pathname includes /key. remove leading /
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
    const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        MaxKeys: options?.limit || 1000,
        ContinuationToken: options?.cursor,
    });

    const response = await s3Client.send(command);

    // We return keys as 'url' for compatibility with existing loop logic, 
    // or we should update logic. But the type expects 'url'. 
    // Let's return the key as the "url" property for now, knowing it needs signing to be useful.
    // Or better: keep returning s3:// style or just the key.

    const blobs = (response.Contents || []).map((obj) => ({
        url: obj.Key || "", // In private mode, the "URL" is just the key reference
        pathname: obj.Key || "",
        uploadedAt: obj.LastModified || new Date(),
    }));

    return {
        blobs,
        hasMore: !!response.IsTruncated,
        cursor: response.NextContinuationToken,
    };
}

export async function getDownloadUrl(key: string, expiresSec = 3600, downloadName?: string) {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName}"` : undefined,
    });
    return await getSignedUrl(s3Client, command, { expiresIn: expiresSec });
}

export async function getUploadPresignedUrl(key: string, contentType: string, expiresSec = 3600) {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType,
    });
    return await getSignedUrl(s3Client, command, { expiresIn: expiresSec });
}
