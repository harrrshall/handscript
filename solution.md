# Root Cause Analysis: File Not Available on Site

## Issue Description
User encountered a "File not available on site" error when attempting to download the generated PDF. The error logs and browser history indicate the application attempted to fetch the file from a `localhost:3000` URL, despite running in a production environment (Vercel).

## Investigation Findings

### 1. Missing Configuration Triggering "Local Mode"
The investigation traces the issue to `lib/blob.ts`. The application determines whether to use Vercel Blob storage or local filesystem storage based on the presence of the `BLOB_READ_WRITE_TOKEN`.

```typescript
// lib/blob.ts
const IS_LOCAL = !process.env.BLOB_READ_WRITE_TOKEN;
```

**Finding**: The `BLOB_READ_WRITE_TOKEN` environment variable is likely missing in the Vercel deployment. This forces `IS_LOCAL` to `true`, causing the application to behave as if it were running locally.

### 2. Incorrect URL Generation for Production
When in "Local Mode", the `uploadFile` function generates a hardcoded URL pointing to `localhost:3000`, regardless of the actual environment.

```typescript
// lib/blob.ts
// Return a local URL (assuming standard Next.js public folder serving)
return `http://localhost:3000/uploads/${uniqueName}`;
```

**Finding**: This URL is returned to the frontend. When the user clicks download, the browser requests this URL. On a Vercel deployment, `localhost` refers to the server instance itself (or the user's machine context), which is unreachable or incorrect.

### 3. Storage Location Mismatch (The "Split Brain" Problem)
Even if the URL were correct, the file storage logic is fundamentally incompatible with serverless environments (like Vercel).

*   **Writer (`lib/blob.ts`)**: When running on Vercel (`process.env.VERCEL`), it writes the file to the system's temporary directory:
    ```typescript
    const LOCAL_UPLOAD_DIR = process.env.VERCEL
        ? path.join(os.tmpdir(), 'uploads')
        : path.join(process.cwd(), 'public/uploads');
    ```

*   **Reader (`app/api/download/route.ts`)**: The download endpoint attempts to read the file from the project's `public/uploads` directory:
    ```typescript
    const filePath = path.join(process.cwd(), 'public/uploads', filename);
    ```

**Finding**: The file is written to `/tmp/uploads` (by the finalizer) but the downloader looks in `public/uploads`. They are looking in different places.

### 4. Serverless Isolation (The "Ephemeral" Problem)
Even if the paths matched (e.g., both used `/tmp`), this architecture would still fail on Vercel.
*   The **Finalize** operation runs in one serverless function invocation.
*   The **Download** operation runs in a completely separate invocation.
*   Serverless functions do not share a persistent filesystem. The `/tmp` directory is ephemeral and isolated to a specific instance. A file written by one function is not accessible to another function later.

## Conclusion
The error is a cascade of failures starting from missing configuration:
1.  **Missing `BLOB_READ_WRITE_TOKEN`** forces "Local Mode".
2.  "Local Mode" writes to a temporary ephemeral location (`/tmp`) but generates a URL for `localhost`.
3.  The Download endpoint tries to read from a persistent location (`public/uploads`) which is empty.
4.  Even if paths matched, separate serverless invocations cannot share files via the filesystem.

## Recommendations
1.  **Immediate Fix:** Add the `BLOB_READ_WRITE_TOKEN` to the Vercel project environment variables. This will enable the Vercel Blob storage, which is the correct architecture for serverless file handling.
2.  **Code Improvement:** Modify `lib/blob.ts` to throw an explicit error if running in `process.env.VERCEL` without a Blob token, rather than silently falling back to a broken "local" implementation. Use a persistent storage solution (like S3 or Vercel Blob) for production.
