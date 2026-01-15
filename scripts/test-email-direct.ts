import { Resend } from 'resend';
import dotenv from 'dotenv';
import path from 'path';

// Load .env explicitly
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
    const email = "harshalsingh1223@gmail.com";
    const apiKey = process.env.RESEND_API_KEY;

    console.log("----------------------------------------");
    console.log("Testing Email Delivery Configuration");
    console.log("----------------------------------------");
    console.log(`Target Email: ${email}`);
    console.log(`API Key defined: ${!!apiKey}`);
    if (apiKey) {
        console.log(`API Key prefix: ${apiKey.substring(0, 4)}...`);
    } else {
        console.error("ERROR: RESEND_API_KEY is not set in .env");
        process.exit(1);
    }

    const resend = new Resend(apiKey);

    try {
        console.log("Attempting to send email...");
        const { data, error } = await resend.emails.send({
            from: process.env.EMAIL_FROM || "onboarding@resend.dev", // Default Resend testing sender
            to: email,
            subject: "HandScript Feature Test 🚀",
            html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h1>Feature Verification</h1>
          <p>This is a manual test to verify the Resend integration.</p>
          <p><strong>Status:</strong> Success ✅</p>
          <p>If you are reading this, the email credentials are correct!</p>
        </div>
      `
        });

        if (error) {
            console.error("Failed to send email:", error);
            process.exit(1);
        }

        console.log("Email sent successfully!");
        console.log("ID:", data?.id);
        console.log("----------------------------------------");

    } catch (e) {
        console.error("Exception during execution:", e);
        process.exit(1);
    }
}

main();
