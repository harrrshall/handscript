## Additional Feature: Error Notification via Email

### Requirement

When processing fails at any stage (Gemini API error, Modal.com timeout, or any unrecoverable error), send an email to the user notifying them to try again.

### Current Error Handling Analysis

| Location                      | Current Behavior                      | Change Needed                                         |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `/api/internal/process-batch` | Returns 500, QStash retries 3x        | After exhausted retries, mark job failed + send email |
| `/api/jobs/[jobId]/finalize`  | Returns 500 on critical errors        | Catch errors, mark job failed + send email            |
| Job status in Redis           | `status: 'failed'` with `error` field | Already implemented, need to trigger email            |

### Implementation Plan

#### Change 1: Create Error Email Template

**File**: `app/api/send-error-email/route.ts` (New File)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { Resend } from "resend";
import { redis } from "@/lib/redis";

const resend = new Resend(process.env.RESEND_API_KEY || "re_mock");

async function handler(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, email, errorMessage } = body;

    if (!jobId || !email) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      console.log(
        "Mocking Error Email Send",
        JSON.stringify({ to: email, jobId })
      );
      return NextResponse.json({ success: true, emailId: "mock_id" });
    }

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "HandScript <noreply@handscript.com>",
      to: email,
      subject: "Your HandScript Conversion Encountered an Issue ⚠️",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { width: 48px; height: 48px; background: #ef4444; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 24px; font-weight: bold; }
            h1 { font-size: 24px; margin: 20px 0 10px; color: #ef4444; }
            p { margin: 0 0 20px; color: #666; }
            .button { display: inline-block; background: #000; color: #fff !important; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; }
            .error-box { background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; font-size: 14px; color: #991b1b; margin: 20px 0; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">!</div>
              <h1>Conversion Failed</h1>
              <p>We're sorry, but there was an issue processing your handwritten notes.</p>
            </div>
            
            <div class="error-box">
              <strong>What happened:</strong><br/>
              ${
                errorMessage ||
                "An unexpected error occurred during processing."
              }
            </div>
            
            <p>Don't worry – this can happen occasionally due to complex handwriting, image quality issues, or temporary service disruptions.</p>
            
            <div style="text-align: center;">
              <a href="${
                process.env.VERCEL_URL
                  ? `https://${process.env.VERCEL_URL}`
                  : "https://handscript.app"
              }" class="button">Try Again</a>
            </div>
            
            <p style="margin-top: 30px; font-size: 14px;">
              <strong>Tips for better results:</strong>
              <ul style="color: #666;">
                <li>Ensure your PDF pages are clear and well-lit</li>
                <li>Try scanning at higher resolution if possible</li>
                <li>Avoid uploading more than 200 pages at once</li>
              </ul>
            </p>
            
            <div class="footer">
              <p>Job ID: ${jobId}</p>
              <p>© 2026 HandScript. Powered by Gemini AI.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error(
        JSON.stringify({
          event: "ErrorEmailSendFailed",
          jobId,
          email,
          error: error.message,
          timestamp: new Date().toISOString(),
        })
      );
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update job with error email status
    const job: any = await redis.get(`job:${jobId}`);
    if (job) {
      job.errorEmailSent = true;
      job.errorEmailSentAt = Date.now();
      await redis.set(`job:${jobId}`, job);
    }

    console.log(
      JSON.stringify({
        event: "ErrorEmailSent",
        jobId,
        email,
        emailId: data?.id,
        timestamp: new Date().toISOString(),
      })
    );

    return NextResponse.json({ success: true, emailId: data?.id });
  } catch (error) {
    console.error("Error email handler error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Wrap with QStash signature verification
let POST_HANDLER: any = handler;
if (process.env.QSTASH_CURRENT_SIGNING_KEY) {
  POST_HANDLER = verifySignatureAppRouter(handler);
}

export const POST = POST_HANDLER;
```

#### Change 2: Add Error Email Queue Helper

**File**: `lib/queue.ts` (Add new function)

```typescript
export interface ErrorEmailPayload {
  jobId: string;
  email: string;
  errorMessage: string;
}

export async function queueErrorEmail(payload: ErrorEmailPayload) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  return publishToQStash(`${baseUrl}/api/send-error-email`, payload);
}
```

#### Change 3: Update Finalize Route to Send Error Emails

**File**: `app/api/jobs/[jobId]/finalize/route.ts`

Add error email sending in the catch block:

```typescript
// At the top of the file, add import:
import { queueErrorEmail } from '@/lib/queue';

// In the main catch block (around line 356):
} catch (error) {
    console.error(JSON.stringify({
        event: 'FinalizeFailed',
        jobId,
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
    }));

    // Mark job as failed and send error email
    try {
        const job: any = await redis.get(`job:${jobId}`);
        if (job && job.email) {
            job.status = 'failed';
            job.error = String(error);
            await redis.set(`job:${jobId}`, job);

            // Queue error notification email
            await queueErrorEmail({
                jobId,
                email: job.email,
                errorMessage: "PDF generation failed. This may be due to complex content or a temporary issue."
            });
        }
    } catch (emailError) {
        console.error("Failed to queue error email:", emailError);
    }

    return NextResponse.json({ error: 'Finalize failed', details: String(error) }, { status: 500 });
}
```

#### Change 4: Update Batch Processing for Exhausted Retries

**File**: `app/api/internal/process-batch/route.ts`

QStash automatically retries 3 times. When all retries are exhausted, we need to detect this and notify the user. Add a header check:

```typescript
// At the top of handler function:
async function handler(request: NextRequest) {
    const retryCount = parseInt(request.headers.get('Upstash-Retried') || '0');
    const maxRetries = 3;

    // ... existing code ...

    } catch (error: any) {
        console.error("Batch processing error", error);

        // If this is the last retry, mark job as failed and notify user
        if (retryCount >= maxRetries) {
            try {
                const body = await request.clone().json();
                const { jobId, manifest } = body;
                const job: any = await redis.get(`job:${jobId}`);

                if (job && job.email) {
                    job.status = 'failed';
                    job.error = `Processing failed after ${maxRetries} retries: ${error.message}`;
                    await redis.set(`job:${jobId}`, job);

                    await queueErrorEmail({
                        jobId,
                        email: job.email,
                        errorMessage: "We couldn't process your notes after multiple attempts. Please try again with a clearer scan."
                    });
                }
            } catch (notifyError) {
                console.error("Failed to notify user of error:", notifyError);
            }
        }

        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
```

### Summary of Error Email Changes

| File                                      | Change                         | Lines      |
| ----------------------------------------- | ------------------------------ | ---------- |
| `app/api/send-error-email/route.ts`       | New file                       | ~120 lines |
| `lib/queue.ts`                            | Add `queueErrorEmail` function | ~15 lines  |
| `app/api/jobs/[jobId]/finalize/route.ts`  | Add error email in catch block | ~20 lines  |
| `app/api/internal/process-batch/route.ts` | Add retry exhaustion check     | ~25 lines  |

---

## Additional Feature: Vercel Analytics Integration

### Overview

Vercel Web Analytics provides privacy-friendly page view tracking with **50,000 free events/month** on the Hobby plan.

### Free Tier Limits

| Feature        | Hobby (Free) | Pro                       |
| -------------- | ------------ | ------------------------- |
| Events/month   | 50,000       | 100,000 included          |
| Data retention | 1 month      | 12 months                 |
| Custom events  | ❌           | ✅                        |
| Cost           | Free         | $0.00003/event over limit |

### Implementation Steps

#### Step 1: Install the Package

```bash
npm install @vercel/analytics
```

#### Step 2: Add Analytics Component to Layout

**File**: `app/layout.tsx`

```typescript
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HandScript - Convert Handwritten Notes to PDF",
  description:
    "AI-powered conversion of handwritten notes to beautifully formatted academic PDFs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

#### Step 3: Enable Analytics in Vercel Dashboard

1. Go to your project in [Vercel Dashboard](https://vercel.com/dashboard)
2. Click on the **Analytics** tab
3. Click **Enable** to activate Web Analytics
4. Deploy your changes

Speed Insights provides Core Web Vitals monitoring (10,000 free data points/month).

```bash
npm install @vercel/speed-insights
```

**File**: `app/layout.tsx`

```typescript
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
```

### What Gets Tracked (Automatically)

| Metric          | Description                   |
| --------------- | ----------------------------- |
| Page Views      | Every page navigation         |
| Unique Visitors | De-duplicated by session      |
| Top Pages       | Most visited routes           |
| Referrers       | Where traffic comes from      |
| Countries       | Geographic distribution       |
| Devices         | Desktop vs Mobile vs Tablet   |
| Browsers        | Chrome, Safari, Firefox, etc. |

### Custom Events (Pro Plan Only)

If you upgrade to Pro, you can track custom events:

```typescript
import { track } from "@vercel/analytics";

// Track conversion start
track("conversion_started", {
  pageCount: totalPages,
  hasEmail: !!email,
});

// Track successful download
track("pdf_downloaded", {
  jobId: jobId,
});
```

### Privacy Considerations

Vercel Analytics is:

- ✅ GDPR compliant
- ✅ Cookie-free (no consent banner needed)
- ✅ Privacy-focused (no personal data collected)
- ✅ Lightweight (~1KB script)

### Updated Package.json Dependencies

```json
{
  "dependencies": {
    "@vercel/analytics": "^1.4.1",
    "@vercel/speed-insights": "^1.1.0"
  }
}
```

### Testing Analytics

1. Deploy to Vercel (Analytics only works on deployed sites, not localhost)
2. Visit your site and navigate between pages
3. Check the Analytics tab in Vercel dashboard (data appears within minutes)
4. Verify events are being captured in the "Live" view

---

## Updated Summary of All Changes

### Changes Summary Table

| Category            | File                                      | Change                               | Effort |
| ------------------- | ----------------------------------------- | ------------------------------------ | ------ |
| **UI Optimization** | `app/components/Status.tsx`               | Stop polling when email provided     | 5 min  |
| **UI Optimization** | `app/components/Status.tsx`               | Improve email confirmation UI        | 15 min |
| **Error Emails**    | `app/api/send-error-email/route.ts`       | New endpoint for error notifications | 30 min |
| **Error Emails**    | `lib/queue.ts`                            | Add `queueErrorEmail` helper         | 5 min  |
| **Error Emails**    | `app/api/jobs/[jobId]/finalize/route.ts`  | Send error email on failure          | 10 min |
| **Error Emails**    | `app/api/internal/process-batch/route.ts` | Send error email on retry exhaustion | 15 min |
| **Analytics**       | `npm install`                             | Install @vercel/analytics            | 2 min  |
| **Analytics**       | `app/layout.tsx`                          | Add Analytics component              | 5 min  |
| **Analytics**       | Vercel Dashboard                          | Enable Analytics                     | 2 min  |

**Total Estimated Effort**: ~90 minutes

---

## Conclusion

The HandScript system is **already architected correctly** for async email-based PDF delivery. The queue-based architecture using Upstash QStash ensures all processing happens in the background, and email delivery is already integrated via Resend.

**Changes required**:

1. **UI Optimization**: Stop polling when email is provided, improve confirmation UI (~20 lines)
2. **Error Notifications**: Add error email endpoint and integrate into failure paths (~180 lines)
3. **Vercel Analytics**: Install package and add component (~10 lines + dashboard config)

The system operates comfortably within free tier limits:

- ✅ Vercel Hobby: Function timeouts handled via QStash chaining + 50K analytics events
- ✅ Upstash QStash: ~75-250 documents/day capacity
- ✅ Resend: 100 emails/day sufficient for small-scale use (includes error emails)
- ✅ Backblaze B2: Self-cleaning storage within 10GB
- ✅ Gemini Tier 1: Batching optimizes API usage
