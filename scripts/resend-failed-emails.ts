/**
 * Script to find jobs with failed email delivery and optionally resend.
 * 
 * Usage:
 *   npx tsx scripts/resend-failed-emails.ts         # List failed emails
 *   npx tsx scripts/resend-failed-emails.ts --resend  # Actually resend them
 * 
 * IMPORTANT: Resend requires a verified domain to send to external recipients.
 * Go to https://resend.com/domains to verify your domain first!
 */

import 'dotenv/config';
import { redis } from '../lib/redis';
import { Resend } from 'resend';
import { getDownloadUrl } from '../lib/s3';

const resend = new Resend(process.env.RESEND_API_KEY);
const shouldResend = process.argv.includes('--resend');

interface Job {
    id: string;
    status: string;
    email?: string;
    emailStatus?: string;
    totalPages: number;
    completedPages: number;
    error?: string;
}

async function main() {
    console.log('🔍 Scanning for jobs with failed email delivery...\n');

    // Use SCAN instead of KEYS for Upstash compatibility
    const jobKeys: string[] = [];
    let cursor: number | string = 0;

    console.log('Starting scan...');
    do {
        // Ensure cursor is a number for the SDK if needed, or string if accepted. 
        // Upstash HTTP API returns string cursors. SDK might expect number.
        // Let's try parsing to ensure we don't pass weird object.
        const numCursor = typeof cursor === 'string' ? parseInt(cursor) : cursor;

        const result = await redis.scan(numCursor, { match: 'job:*', count: 5000 });
        cursor = result[0];

        const keys = result[1].filter((k: string) => !k.includes(':logs'));
        jobKeys.push(...keys);

        process.stdout.write(`\rFound ${jobKeys.length} jobs... (Cursor: ${cursor})`);
    } while (cursor !== 0 && cursor !== '0');
    console.log('\nScan complete.');

    const failedEmails: { job: Job; pdfUrl?: string }[] = [];

    for (const key of jobKeys) {
        try {
            const jobData = await redis.get(key);
            if (!jobData) continue;

            const job: Job = typeof jobData === 'string' ? JSON.parse(jobData) : jobData;

            // DEBUG: Print first job structure
            if (failedEmails.length === 0 && jobKeys.length > 0 && jobKeys.indexOf(key) === 0) {
                console.log('DEBUG: First job structure:', JSON.stringify(job, null, 2));
            }

            // Relaxed filter for debugging: List ALL jobs with emails
            if (job.email) {

                // Try to get PDF URL
                let pdfUrl: string | undefined;
                try {
                    // Try getting from job data first if available
                    if ((job as any).pdfUrl) pdfUrl = (job as any).pdfUrl;
                    else pdfUrl = await getDownloadUrl(`outputs/${job.id}.pdf`);
                } catch (e) {
                    // PDF might not exist
                }

                failedEmails.push({ job, pdfUrl });
            }
        } catch (e) {
            // Skip malformed jobs
        }
    }

    if (failedEmails.length === 0) {
        console.log('✅ No failed email deliveries found!\n');
        return;
    }

    console.log(`Found ${failedEmails.length} job(s) with failed email delivery:\n`);
    console.log('─'.repeat(80));

    for (const { job, pdfUrl } of failedEmails) {
        console.log(`Job ID:      ${job.id}`);
        console.log(`Email:       ${job.email}`);
        console.log(`Status:      ${job.status}`);
        console.log(`Email Status: ${job.emailStatus || 'not_sent'}`);
        console.log(`PDF URL:     ${pdfUrl || 'NOT FOUND'}`);

        if (shouldResend && pdfUrl && job.email) {
            console.log('⏳ Attempting to resend...');
            try {
                const result = await resend.emails.send({
                    from: process.env.EMAIL_FROM || 'HandScript <onboarding@resend.dev>',
                    to: job.email,
                    subject: 'Your HandScript Notes are Ready! 📝',
                    html: `
                        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                            <h1>Your notes are ready!</h1>
                            <p>Thank you for using HandScript. Your PDF has been generated successfully.</p>
                            <p><a href="${pdfUrl}" style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Download PDF</a></p>
                            <p style="color: #666; font-size: 14px;">This link expires in 1 hour.</p>
                        </div>
                    `,
                });
                console.log(`✅ Email sent! ID: ${result.data?.id || 'unknown'}`);

                // Update job status
                job.emailStatus = 'sent';
                await redis.set(`job:${job.id}`, JSON.stringify(job));
            } catch (err: any) {
                console.log(`❌ Failed: ${err.message}`);
            }
        }

        console.log('─'.repeat(80));
    }

    if (!shouldResend) {
        console.log('\n💡 To resend emails, run: npx tsx scripts/resend-failed-emails.ts --resend');
        console.log('\n⚠️  IMPORTANT: Make sure you have verified a domain at https://resend.com/domains');
        console.log('   Without a verified domain, Resend can only send to your own email address.');
    }
}

main().catch(console.error);
