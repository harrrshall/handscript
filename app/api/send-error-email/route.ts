import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/redis";
import { logger, metrics } from "@/lib/logger";
import { env } from "@/lib/env";
import { getBaseUrl } from "@/lib/utils";

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

    // Send email via Gmail SMTP
    if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
      // Fallback for missing keys (or dev)
      logger.warn("GmailCredentialsMissing", { jobId, metadata: { to: email } });
      return NextResponse.json({ success: true, emailId: "mock_id_no_creds" });
    }

    // Call Gmail utility
    const { sendEmail } = await import('@/lib/mailer');
    const baseUrl = getBaseUrl();

    // Note: error handling is slightly different as sendEmail throws on error, 
    // whereas Resend returns { error } object. We wrap in try block (already done at top level).

    const result = await sendEmail({
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
              ${errorMessage || "An unexpected error occurred during processing."}
            </div>
            
            <p>Don't worry – this can happen occasionally due to complex handwriting, image quality issues, or temporary service disruptions.</p>
            
            <div style="text-align: center;">
              <a href="${baseUrl}" class="button">Try Again</a>
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
      `
    });

    // Code below handles success case naturally
    // If sendEmail throws, it goes to catch block at line 114


    // Update job with error email status
    const job: any = await redis.get(`job:${jobId}`);
    if (job) {
      job.errorEmailSent = true;
      job.errorEmailSentAt = Date.now();
      await redis.set(`job:${jobId}`, job);
    }

    logger.info("ErrorEmailSent", {
      jobId,
      metadata: { email, emailId: result.messageId }
    });
    await metrics.increment("error_emails_sent");

    return NextResponse.json({ success: true, emailId: result.messageId });
  } catch (error: any) {
    logger.error("ErrorEmailHandlerError", { error: error.message, stack: error.stack });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Wrap with QStash signature verification
let POST_HANDLER: any = handler;
if (process.env.NODE_ENV === 'production' && env.QSTASH_CURRENT_SIGNING_KEY) {
  POST_HANDLER = verifySignatureAppRouter(handler);
} else {
  if (process.env.NODE_ENV === 'production') {
    logger.warn("QStashSigningKeyMissing", { metadata: { env: 'production', route: 'error-email' } });
  }
}

export const POST = POST_HANDLER;
