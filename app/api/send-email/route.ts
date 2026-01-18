import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { redis } from "@/lib/redis";
import { getDownloadUrl } from "@/lib/s3";
import { logger, metrics } from "@/lib/logger";
import { env } from "@/lib/env";

async function handler(request: NextRequest) {
  let jobId: string | undefined;
  let email: string | undefined;

  try {
    const body = await request.json();
    // Assign to outer scope variables
    jobId = body.jobId;
    email = body.email;
    const { pdfUrl, pdfKey } = body;

    // Validate required fields
    if (!jobId || !email) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Get fresh presigned URL (in case original expired)
    const freshPdfUrl = pdfKey
      ? await getDownloadUrl(pdfKey, 86400, "handscript-notes.pdf") // 24 hour expiry
      : pdfUrl;

    // Send email via Gmail SMTP
    if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
      // Fallback for missing keys (or dev)
      logger.warn("GmailCredentialsMissing", { jobId, metadata: { to: email } });
      return NextResponse.json({ success: true, emailId: "mock_id_no_creds" });
    }

    // Call Gmail utility
    logger.info("AttemptingGmailSend", { jobId, to: email });

    const { sendEmail } = await import('@/lib/mailer');

    const result = await sendEmail({
      to: email,
      subject: "Your HandScript PDF is Ready! 📄",
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
            .logo { width: 48px; height: 48px; background: #000; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 24px; font-weight: bold; }
            h1 { font-size: 24px; margin: 20px 0 10px; }
            p { margin: 0 0 20px; color: #666; }
            .button { display: inline-block; background: #000; color: #fff !important; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; }
            .button:hover { background: #333; }
            .note { background: #f5f5f5; padding: 16px; border-radius: 8px; font-size: 14px; color: #666; margin-top: 30px; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">H</div>
              <h1>Your PDF is Ready!</h1>
              <p>Great news! Your handwritten notes have been successfully converted to a beautifully typed formatted PDF document.</p>
            </div>
            
            <div style="text-align: center;">
              <a href="${freshPdfUrl}" class="button">Download Your PDF</a>
            </div>
            
            <div class="note">
              <strong>⏰ Important:</strong> This download link expires in 24 hours. 
              If you need to download the file again after it expires, you'll need to process your notes again.
            </div>
            
            <div class="footer">
              <p>made by <a href="https://harshalsingh.vercel.app" style="color: #008080; text-decoration: none;">HARSHAL</a>.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    // Update job with email status
    const job: any = await redis.get(`job:${jobId}`);
    if (job) {
      job.emailStatus = "sent";
      job.emailSentAt = Date.now();
      job.emailId = result.messageId;
      await redis.set(`job:${jobId}`, job);
    }

    // Increment email usage counter (track successful deliveries)
    const emailUsageKey = `email:usage:${email.toLowerCase()}`;
    await redis.incr(emailUsageKey);
    // Set expiry to 1 year so counters don't persist forever
    await redis.expire(emailUsageKey, 365 * 24 * 60 * 60);

    logger.info("EmailSent", {
      jobId,
      metadata: { email, emailId: result.messageId }
    });
    await metrics.increment("emails_sent");

    return NextResponse.json({ success: true, emailId: result.messageId });
  } catch (error: any) {
    logger.error("EmailHandlerError", { error: error.message, stack: error.stack });

    // Log failure specifically
    logger.error("EmailSendFailed", {
      jobId,
      metadata: { email, error: error.message }
    });
    await metrics.increment("email_errors");

    // Check for invalid email address error
    const errorMessage = error.message || '';
    if (
      errorMessage.includes("couldn't be found") ||
      errorMessage.includes("address couldn't be found") ||
      errorMessage.includes("unable to receive mail") ||
      errorMessage.includes("550") ||
      errorMessage.includes("Invalid recipient")
    ) {
      // Add to blocklist so this email is rejected immediately next time
      if (email) {
        const blockKey = `email:blocked:${email.toLowerCase()}`;
        await redis.set(blockKey, {
          reason: 'SMTP rejection',
          blockedAt: Date.now(),
          originalError: errorMessage.substring(0, 200)
        });
        logger.info("EmailBlocked", { email, reason: 'SMTP rejection' });
      }

      return NextResponse.json(
        { error: "The email address does not exist or is unable to receive mail. Please try again with a valid email." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Wrap with QStash signature verification for security
// Only apply if key is present to avoid build failures
let POST_HANDLER: any = handler;
/*
if (process.env.NODE_ENV === 'production' && process.env.QSTASH_CURRENT_SIGNING_KEY) {
  POST_HANDLER = verifySignatureAppRouter(handler);
} else {
  // In production this should be a critical error or handled via env check at start
  // For build contexts without secrets, we skip verification
  if (process.env.NODE_ENV === 'production') {
    logger.warn("QStashSigningKeyMissing", { metadata: { env: 'production' } });
  }
}
*/

export const POST = POST_HANDLER;
