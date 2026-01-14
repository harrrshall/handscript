# Migrating from Vercel Blob to Backblaze B2: Integration Guide

This document provides a comprehensive guide for replacing **Vercel Blob** with **Backblaze B2** in your existing HandScript architecture. Backblaze B2 offers a more scalable and cost-effective solution for high-traffic applications while maintaining compatibility with the S3 API.

---

## 1. Prerequisites and Setup

Before modifying the code, you must configure your Backblaze B2 environment.

### 1.1 Backblaze B2 Configuration
1.  **Create a Bucket**: Log in to your Backblaze account and create a new bucket.
    *   **Bucket Name**: Must be globally unique (e.g., `handscript-storage-v1`).
    *   **Files are**: Set to **Private** for enhanced security. This means files will not be directly accessible via public URLs; instead, you will use pre-signed URLs for temporary access.
2.  **Get Endpoint and Region**:
    *   In the **Buckets** list, locate your bucket and copy the **Endpoint** (e.g., `s3.us-west-004.backblazeb2.com`).
    *   The **Region** is the part between `s3.` and `.backblazeb2.com` (e.g., `us-west-004`).
3.  **Generate Application Keys**:
    *   Go to **App Keys** and click **Add a New Application Key**.
    *   Ensure it has access to the specific bucket.
    *   **Important**: Copy the `keyID` and `applicationKey` immediately.

### 1.2 CORS Configuration
To allow your Next.js frontend to interact with B2 (e.g., for direct uploads or fetching images), you must set CORS rules:
1.  Go to **Buckets** > **Bucket Settings** > **CORS Rules**.
2.  Add a rule for your domain (e.g., `https://handscriptnotes.vercel.app` and `http://localhost:3000`):
    *   **Allowed Origins**: `["https://handscriptnotes.vercel.app", "http://localhost:3000"]`
    *   **Allowed Methods**: `["GET", "PUT", "POST", "DELETE", "HEAD"]`
    *   **Allowed Headers**: `["*"]`
    *   **Expose Headers**: `["ETag"]`

---

## 2. Implementation Details

### 2.1 Install Dependencies
Replace `@vercel/blob` with the AWS SDK for JavaScript V3.

```bash
npm uninstall @vercel/blob
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### 2.2 Environment Variables
Update your `.env.local` and Vercel project settings:

```env
# Remove Vercel Blob variables
# BLOB_READ_WRITE_TOKEN=...

# Add Backblaze B2 variables
B2_KEY_ID=your_key_id
B2_APPLICATION_KEY=your_application_key
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
B2_BUCKET_NAME=handscript-storage-v1
```

### 2.3 New Storage Library (`lib/s3.ts`)
Create a new wrapper to replace `lib/blob.ts`. This preserves the existing interface while using B2.

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region: process.env.B2_REGION,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID!,
    secretAccessKey: process.env.B2_APPLICATION_KEY!,
  },
});

const BUCKET_NAME = process.env.B2_BUCKET_NAME;

export async function uploadFile(key: string, body: Buffer | string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3Client.send(command);
  
  // For private buckets, we return the key, which can then be used to generate a pre-signed URL.
  return key;
}

export async function getDownloadUrl(key: string, expiresSec = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  // Returns a pre-signed URL valid for the specified duration (default 1 hour)
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

export async function deleteFile(key: string) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  await s3Client.send(command);
}
```

---

## 3. Integration with Existing Architecture

### 3.1 Updating API Routes
You need to update routes that previously used `put` or `del` from `@vercel/blob`.

**Example: `app/api/upload/route.ts` (Server-side upload)**
```typescript
// Before:
// import { put } from "@vercel/blob";
// const blob = await put(filename, file, { access: 'public' });

// After (server-side upload):
import { uploadFile } from "@/lib/s3";
const fileKey = `uploads/${Date.now()}-${filename}`;
await uploadFile(fileKey, fileBuffer, "application/pdf");
// If you need a URL for immediate use, generate a pre-signed URL:
const downloadUrl = await getDownloadUrl(fileKey);
```

**Example: Client-side direct upload using a pre-signed URL**
For direct client-side uploads (e.g., from `Upload.tsx`), you would first request a pre-signed upload URL from your API.

**`app/api/get-presigned-upload-url/route.ts` (New API Route)**
```typescript
import { NextResponse } from 'next/server';
import { getUploadPresignedUrl } from '@/lib/s3';

export async function POST(request: Request) {
  const { filename, contentType } = await request.json();
  const fileKey = `uploads/${Date.now()}-${filename}`;
  const presignedUrl = await getUploadPresignedUrl(fileKey, contentType);
  return NextResponse.json({ presignedUrl, fileKey });
}
```

**`app/components/Upload.tsx` (Client-side usage)**
```typescript
// ... inside your upload logic ...
const response = await fetch('/api/get-presigned-upload-url', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filename: file.name, contentType: file.type }),
});
const { presignedUrl, fileKey } = await response.json();

await fetch(presignedUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type },
});

// Now you have the fileKey, which you can send to your /api/process-batch
// or store in Redis for later retrieval.
```

### 3.2 Updating PDF Finalization (`app/api/jobs/[jobId]/finalize/route.ts`)
When Modal.com finishes rendering the PDF, it should upload to B2. The download URL will now be a pre-signed URL.

```typescript
// In the finalize logic:
const pdfBuffer = await responseFromModal.arrayBuffer();
const pdfKey = `outputs/${jobId}.pdf`;
await uploadFile(pdfKey, Buffer.from(pdfBuffer), "application/pdf");

// Generate a pre-signed URL for download
const downloadUrl = await getDownloadUrl(pdfKey);

// Update Redis state with the new B2 URL
await redis.hset(`job:${jobId}`, { status: "completed", downloadUrl: downloadUrl });
```

### 3.3 Updating Download Route (`GET /api/download`)
Your download route will now need to generate a pre-signed URL for the client.

```typescript
// Before:
// import { get } from "@vercel/blob";
// const blob = await get(url);

// After:
import { getDownloadUrl } from "@/lib/s3";
// Assuming your download route receives a 'key' parameter for the file
const fileKey = req.query.key as string; 
const presignedDownloadUrl = await getDownloadUrl(fileKey);

// Redirect the client to the pre-signed URL or send it back in the response
res.redirect(presignedDownloadUrl);
```

---

## 4. Error Handling and Best Practices

### 4.1 Error Handling
B2/S3 operations can fail due to network issues or credential errors. Wrap calls in try-catch blocks:

```typescript
try {
  await uploadFile(key, body, type);
} catch (error: any) {
  console.error("B2 Upload Error:", error);
  if (error.name === "EntityTooLarge") {
    // Handle large file error
  }
  throw new Error("Failed to store file in Backblaze B2");
}
```

### 4.2 Preserving Features with Private Buckets
*   **Security**: Using a **Private** B2 bucket with pre-signed URLs is the recommended approach for sensitive data. It ensures that only authorized users with a valid, time-limited URL can access your files.
*   **Pre-signed URLs**: These URLs grant temporary access to a specific object. They can be generated for both uploads (`getUploadPresignedUrl`) and downloads (`getDownloadUrl`). You control their expiration time, adding a layer of security.
*   **Performance**: B2 is highly performant. For extremely high read volumes, especially for static assets, consider using a CDN (like Cloudflare) in front of your B2 bucket, even with private files. The CDN can cache the content after the first pre-signed URL access.

### 4.3 Migration Strategy
1.  **Dual Write (Optional)**: For a zero-downtime migration of existing data, you can write to both Vercel Blob and B2 for a short period.
2.  **Data Transfer**: Use the `rclone` tool to move existing files from Vercel Blob to Backblaze B2 if you have a large amount of legacy data.

---

## 5. Summary of Changes

| Feature | Vercel Blob | Backblaze B2 (Private Bucket) |
| :--- | :--- | :--- |
| **SDK** | `@vercel/blob` | `@aws-sdk/client-s3` |
| **Auth** | Token-based | KeyID + ApplicationKey |
| **Limits** | 1,000 ops/month (Free) | Virtually unlimited (Pay-as-you-go) |
| **Cost** | High for scale | $6/TB (Storage), $0/GB (Egress via Cloudflare) |
| **API** | Proprietary | S3-Compatible |
| **Access** | Public URLs | Pre-signed URLs for temporary access |

By following this guide, you will successfully transition your storage layer to a more robust and cost-effective platform without disrupting the HandScript pipeline, while enhancing security with private buckets and pre-signed URLs.
