
import 'dotenv/config';
import { redis } from '../lib/redis';

interface JobData {
    jobId: string;
    email?: string;
    emailStatus?: "pending" | "sent" | "failed" | "queued" | "queue_failed";
    emailSentAt?: number;
    emailId?: string;
    errorEmailSent?: boolean;
    errorEmailSentAt?: number;
    status: string;
    createdAt: number;
    completedAt?: number;
    error?: string;
}

async function main() {
    console.log('🔍 Scanning all jobs for email history...\n');

    // Get all job keys from Redis
    const cursor = '0';
    const allKeys: string[] = [];
    let nextCursor = cursor;

    do {
        const result = await redis.scan(nextCursor, { match: 'job:*', count: 100 });
        nextCursor = result[0];
        const keys = result[1].filter((key: string) =>
            key.startsWith('job:') &&
            !key.includes(':') // Exclude nested keys like job:123:page:0
        );
        allKeys.push(...keys);
    } while (nextCursor !== '0');

    console.log(`Found ${allKeys.length} jobs in Redis\n`);

    const emailedJobs: JobData[] = [];
    const failedJobs: JobData[] = [];
    const pendingJobs: JobData[] = [];
    const queueFailedJobs: JobData[] = [];

    // Fetch all jobs
    for (const key of allKeys) {
        const jobData = await redis.get(key) as any;
        if (!jobData || !jobData.email) continue; // Skip jobs without email

        const job: JobData = {
            jobId: key.replace('job:', ''),
            email: jobData.email,
            emailStatus: jobData.emailStatus,
            emailSentAt: jobData.emailSentAt,
            emailId: jobData.emailId,
            errorEmailSent: jobData.errorEmailSent,
            errorEmailSentAt: jobData.errorEmailSentAt,
            status: jobData.status,
            createdAt: jobData.createdAt,
            completedAt: jobData.completedAt,
            error: jobData.error,
        };

        if (job.emailStatus === 'sent') {
            emailedJobs.push(job);
        } else if (job.emailStatus === 'failed') {
            failedJobs.push(job);
        } else if (job.emailStatus === 'queued') {
            pendingJobs.push(job);
        } else if (job.emailStatus === 'queue_failed') {
            queueFailedJobs.push(job);
        } else {
            // No explicit email status but has email field
            if (job.status === 'complete' && !job.emailStatus) {
                pendingJobs.push(job);
            }
        }
    }

    // Print Summary
    console.log('═══════════════════════════════════════════════');
    console.log('              EMAIL AUDIT REPORT               ');
    console.log('═══════════════════════════════════════════════\n');

    console.log(`✅ Successfully Sent:    ${emailedJobs.length}`);
    console.log(`❌ Failed to Send:       ${failedJobs.length}`);
    console.log(`⏳ Queued (Pending):     ${pendingJobs.length}`);
    console.log(`⚠️  Queue Failed:        ${queueFailedJobs.length}`);
    console.log(`📊 Total Jobs w/Email:   ${emailedJobs.length + failedJobs.length + pendingJobs.length + queueFailedJobs.length}\n`);

    // Detailed Reports
    if (emailedJobs.length > 0) {
        console.log('\n✅ SUCCESSFULLY SENT EMAILS');
        console.log('═══════════════════════════════════════════════');
        emailedJobs
            .sort((a, b) => (b.emailSentAt || 0) - (a.emailSentAt || 0))
            .forEach(job => {
                const sentDate = job.emailSentAt ? new Date(job.emailSentAt).toLocaleString() : 'Unknown';
                console.log(`\n📧 ${job.email}`);
                console.log(`   Job ID: ${job.jobId}`);
                console.log(`   Sent At: ${sentDate}`);
                console.log(`   Message ID: ${job.emailId || 'N/A'}`);
                console.log(`   Job Status: ${job.status}`);
            });
    }

    if (failedJobs.length > 0) {
        console.log('\n\n❌ FAILED EMAIL DELIVERIES');
        console.log('═══════════════════════════════════════════════');
        failedJobs.forEach(job => {
            console.log(`\n📧 ${job.email}`);
            console.log(`   Job ID: ${job.jobId}`);
            console.log(`   Job Status: ${job.status}`);
            console.log(`   Error: ${job.error || 'Unknown error'}`);
        });
    }

    if (queueFailedJobs.length > 0) {
        console.log('\n\n⚠️  QUEUE FAILED (Email Not Sent)');
        console.log('═══════════════════════════════════════════════');
        queueFailedJobs.forEach(job => {
            console.log(`\n📧 ${job.email}`);
            console.log(`   Job ID: ${job.jobId}`);
            console.log(`   Job Status: ${job.status}`);
        });
    }

    if (pendingJobs.length > 0) {
        console.log('\n\n⏳ PENDING/QUEUED EMAILS');
        console.log('═══════════════════════════════════════════════');
        pendingJobs.forEach(job => {
            console.log(`\n📧 ${job.email}`);
            console.log(`   Job ID: ${job.jobId}`);
            console.log(`   Job Status: ${job.status}`);
            console.log(`   Email Status: ${job.emailStatus || 'unknown'}`);
        });
    }

    console.log('\n═══════════════════════════════════════════════\n');
}

main().catch(e => {
    console.error('❌ Error:', e);
    process.exit(1);
});
