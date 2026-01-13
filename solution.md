# Vercel Deployment Solution

## Problem Diagnosis

The deployment fails with:
```
Error: The Vercel Function "api/jobs/[jobId]/assemble" is 519.02mb which exceeds the maximum size limit of 300mb.
```

**Root Cause**: The `public/uploads/` directory contains ~500+ MB of image files that were **committed to git** before the `.gitignore` entry was added. When Vercel builds, it bundles the entire `public/` directory into each serverless function, causing them to exceed the 250 MB (uncompressed) / 300 MB (compressed) limit.

Key insight: Your codebase already correctly uses `@vercel/blob` for production (see `lib/blob.ts`), but these legacy committed files are polluting the build.

---

## Solution: Remove Tracked Files from Git

**Minimal change, no architecture modification required.**

Run these commands locally:

```bash
# Remove files from git tracking (keeps local copies)
git rm -r --cached public/uploads

# Commit the removal
git commit -m "Remove public/uploads from git tracking"

# Push to trigger new deployment
git push
```

**Why this works**:
- The files are already in `.gitignore` (line 44)
- Your `lib/blob.ts` already uses `@vercel/blob` in production (`!process.env.BLOB_READ_WRITE_TOKEN` check)
- Local development will continue working with `public/uploads/`
- Production will use Vercel Blob storage as intended

---

## Verification

After pushing, the Vercel build should show:
- Serverless functions < 50 MB each
- No `public/uploads/*.png` files in "Large Dependencies" list

---

## Alternative Solutions (If Above Doesn't Work)

### Option A: Force exclude via `vercel.json`

Create or update `vercel.json`:

```json
{
  "functions": {
    "app/api/**/*.ts": {
      "excludeFiles": "public/uploads/**"
    }
  }
}
```

### Option B: Move uploads outside public directory

If you need local static file serving during development, configure a separate path that isn't bundled:

1. Change `LOCAL_UPLOAD_DIR` in `lib/blob.ts` to `tmp/uploads`
2. Add a dev-only route to serve these files
3. Keep `tmp/` in `.gitignore`

### Option C: Use `outputFileTracingExcludes` in next.config.ts

```typescript
const nextConfig: NextConfig = {
  // ... existing config
  outputFileTracingExcludes: {
    '*': ['public/uploads/**'],
  },
};
```

---

## Recommended Action

**Execute the git rm solution** - it's the simplest fix that requires no code changes and aligns with your existing architecture (Vercel Blob for production).
