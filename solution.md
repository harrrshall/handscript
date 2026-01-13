# Vercel Deployment Solution: Read-Only Filesystem Error

## Problem Diagnosis

The deployment fails with:
```
Error: ENOENT: no such file or directory, mkdir '/var/task/public/uploads'
```

**Root Cause**: Vercel serverless functions run in a **read-only filesystem**. The code in [`lib/blob.ts`](lib/blob.ts) and [`lib/typst.ts`](lib/typst.ts) attempts to create directories using `fs.mkdirSync()` at module initialization time. This works locally but fails on Vercel because:

1. `/var/task/` is the read-only deployment bundle
2. Only `/tmp` is writable in serverless environments
3. The `IS_LOCAL` check in `blob.ts` fails because `BLOB_READ_WRITE_TOKEN` may not be set during build/cold-start evaluation

---

## Why This Happens

### File: `lib/blob.ts` (lines 9-13)
```typescript
if (IS_LOCAL) {
    if (!fs.existsSync(LOCAL_UPLOAD_DIR)) {
        fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });  // ❌ Runs at import time
    }
}
```

### File: `lib/typst.ts` (lines 12-14)
```typescript
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });  // ❌ Runs at import time
}
```

These top-level statements execute when the module is **imported**, not when the function is invoked. During Vercel's build/bundle phase or cold-start, this triggers the ENOENT error.

---

## Solution Options (Minimal to No Architecture Changes)

### **Solution 1: Guard with Environment Detection (Recommended)**

Wrap filesystem operations in proper Vercel-aware checks:

**`lib/blob.ts`:**
```typescript
const IS_VERCEL = process.env.VERCEL === '1';
const IS_LOCAL = !IS_VERCEL && !process.env.BLOB_READ_WRITE_TOKEN;

// Move directory creation inside the function, not at module level
function ensureLocalDir() {
    if (IS_LOCAL && !fs.existsSync(LOCAL_UPLOAD_DIR)) {
        fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    }
}
```

Then call `ensureLocalDir()` at the start of `uploadFile()` when `IS_LOCAL` is true.

**`lib/typst.ts`:**
```typescript
const IS_VERCEL = process.env.VERCEL === '1';

// Don't create directories on Vercel - use /tmp or skip entirely
function ensureTempDir() {
    if (!IS_VERCEL && !fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
}
```

**Why this works:**
- `process.env.VERCEL` is always `'1'` on Vercel deployments
- No directory creation happens during import on Vercel
- Local development continues working unchanged

---

### **Solution 2: Use `/tmp` for Vercel (If Local Typst Fallback Needed)**

If you need local Typst compilation as a fallback on Vercel (not just Modal):

**`lib/typst.ts`:**
```typescript
const IS_VERCEL = process.env.VERCEL === '1';
const TEMP_DIR = IS_VERCEL 
    ? '/tmp/handscript' 
    : path.join(process.cwd(), 'tmp');

// Lazy initialization
let tempDirCreated = false;
function ensureTempDir() {
    if (!tempDirCreated) {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
        tempDirCreated = true;
    }
}
```

Call `ensureTempDir()` at the start of `compileTypst()`.

**Caveats:**
- `/tmp` on Vercel is ephemeral (cleared between invocations)
- Limited to ~500MB
- Typst binary would need to be bundled or this fallback should be disabled on Vercel

---

### **Solution 3: Disable Local Fallback on Vercel (Simplest)**

Since you're using Modal for PDF generation in production, remove the filesystem dependency entirely:

**`lib/typst.ts`:**
```typescript
const IS_VERCEL = process.env.VERCEL === '1';

export async function compileTypst(markdownContent: string, jobId: string): Promise<string> {
    if (IS_VERCEL) {
        throw new Error('Local Typst compilation not available on Vercel. Configure MODAL_TYPST_ENDPOINT.');
    }
    // ... existing local compilation logic
}
```

**`lib/blob.ts`:**
```typescript
const IS_VERCEL = process.env.VERCEL === '1';

if (!IS_VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    if (!fs.existsSync(LOCAL_UPLOAD_DIR)) {
        fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    }
}
```

**Why this works:**
- Your architecture already uses Modal for production PDF generation
- Vercel Blob handles file storage in production
- Local filesystem is only needed for development

---

## Recommended Fix

**Solution 1 or 3** depending on your needs:

| Scenario | Recommended Solution |
|----------|---------------------|
| Modal always available in production | **Solution 3** - simplest, fail-fast |
| Need local Typst fallback on Vercel | **Solution 2** - use `/tmp` |
| Just want it to work | **Solution 1** - proper env detection |

---

## Implementation Checklist

1. **Update `lib/blob.ts`:**
   - Add `const IS_VERCEL = process.env.VERCEL === '1';`
   - Move `fs.mkdirSync` inside function or guard with `!IS_VERCEL`

2. **Update `lib/typst.ts`:**
   - Add `const IS_VERCEL = process.env.VERCEL === '1';`
   - Either skip local compilation on Vercel OR use `/tmp` path
   - Move directory creation to lazy initialization

3. **Verify environment variables:**
   - Ensure `BLOB_READ_WRITE_TOKEN` is set in Vercel project settings
   - Ensure `MODAL_TYPST_ENDPOINT` is set in Vercel project settings

---

## Verification

After deploying, the finalize endpoint should:
- Use Modal for PDF generation (not local Typst)
- Use Vercel Blob for file storage (not local filesystem)
- No `ENOENT` errors in logs
