
import { config } from 'dotenv';
config();

const BASE_URL = 'http://localhost:3000';

const TEST_EMAILS = {
    DISPOSABLE: 'test@tempmail.com',
    PROTON: 'ilovetolkiensworks@protonmail.com',
    GMAIL: `test.automation.${Date.now()}@gmail.com`,
    INVALID_GMAIL: 'vvnvhgfh@gmail.com'
};

async function testEmailRestrictions() {
    // Dynamic import to ensure env is loaded
    const { redis } = await import('../lib/redis');

    console.log('🧪 Starting Email Restriction Tests...\n');

    // 1. Test Non-Gmail Rejection (Loop through multiple types)
    console.log('1. Testing Non-Gmail Rejection...');
    for (const email of [TEST_EMAILS.DISPOSABLE, TEST_EMAILS.PROTON]) {
        try {
            const res = await fetch(`${BASE_URL}/api/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageCount: 1,
                    pageManifest: ['dummy-key'],
                    email: email
                })
            });

            const data = await res.json();

            if (res.status === 400 && JSON.stringify(data).includes('Only Gmail addresses are supported')) {
                console.log(`✅ Passed: ${email} rejected with correct error.`);
            } else {
                console.error(`❌ Failed: ${email} not rejected correctly.`);
                console.log('Status:', res.status);
                console.log('Response:', data);
            }
        } catch (err) {
            console.error(`❌ Error testing ${email}:`, err);
        }
    }

    // 2. Test Gmail Acceptance
    console.log('\n2. Testing Gmail Acceptance...');
    let jobId = '';
    try {
        const res = await fetch(`${BASE_URL}/api/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pageCount: 1,
                pageManifest: ['dummy-key'],
                email: TEST_EMAILS.GMAIL
            })
        });

        const data = await res.json();

        if (res.ok && data.jobId) {
            console.log('✅ Passed: Gmail email accepted.');
            jobId = data.jobId;
        } else {
            console.error('❌ Failed: Gmail email rejected.');
            console.log('Status:', res.status);
            console.log('Response:', data);
        }
    } catch (err) {
        console.error('❌ Error testing Gmail:', err);
    }

    // 3. Test 3-File Limit
    console.log('\n3. Testing 3-File Limit...');
    try {
        // Manually set usage to 3 in Redis for this test email
        const redisKey = `email:usage:${TEST_EMAILS.GMAIL.toLowerCase()}`;
        await redis.set(redisKey, 3);
        console.log(`Set Redis key ${redisKey} to 3 manually for testing.`);

        const res = await fetch(`${BASE_URL}/api/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pageCount: 1,
                pageManifest: ['dummy-key'],
                email: TEST_EMAILS.GMAIL
            })
        });

        const data = await res.json();

        if (res.status === 429 && data.error && data.error.includes('limit for this email')) {
            console.log('✅ Passed: Limit enforced correctly.');
            console.log(`Error Message: "${data.error}"`);
        } else {
            console.error('❌ Failed: Limit not enforced.');
            console.log('Status:', res.status);
            console.log('Response:', data);
        }

        // Cleanup
        await redis.del(redisKey);
    } catch (err) {
        console.error('❌ Error testing limit:', err);
    }

    // 4. Test Invalid Gmail Address (SMTP Check)
    console.log('\n4. Testing Invalid Gmail (SMTP Check)...');
    try {
        // We hit the send-email endpoint directly
        const res = await fetch(`${BASE_URL}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId: 'test-job-id',
                email: TEST_EMAILS.INVALID_GMAIL,
                pdfUrl: 'https://example.com/dummy.pdf'
            })
        });

        const data = await res.json();

        // We expect a 400 error due to invalid recipient (if SMTP check works)
        // Note: This relies on Gmail SMTP rejecting it immediately or our code caching the error.

        if (res.status === 400 && data.error && (
            data.error.includes('does not exist') ||
            data.error.includes('unable to receive mail')
        )) {
            console.log(`✅ Passed: Invalid email ${TEST_EMAILS.INVALID_GMAIL} detected.`);
            console.log(`Error: "${data.error}"`);
        } else if (res.ok) {
            console.log(`⚠️ Warning: Email ${TEST_EMAILS.INVALID_GMAIL} was accepted by SMTP. It might be valid or SMTP didn't reject immediately.`);
        } else {
            console.log(`ℹ️ Result for ${TEST_EMAILS.INVALID_GMAIL}: Status ${res.status}`);
            console.log('Response:', data);
        }
    } catch (err) {
        console.error('❌ Error testing invalid email:', err);
    }

    // 5. Test Blocked Email Rejection
    console.log('\n5. Testing Blocked Email Rejection...');
    const blockedTestEmail = 'blocked.test@gmail.com';
    try {
        // First, manually block the email via Redis
        const blockKey = `email:blocked:${blockedTestEmail.toLowerCase()}`;
        await redis.set(blockKey, { reason: 'Test block', blockedAt: Date.now() });
        console.log(`Set Redis key ${blockKey} to blocked for testing.`);

        // Now try to create a job with this email
        const res = await fetch(`${BASE_URL}/api/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pageCount: 1,
                pageManifest: ['dummy-key'],
                email: blockedTestEmail
            })
        });

        const data = await res.json();

        if (res.status === 400 && data.error && data.error.includes('blocked')) {
            console.log(`✅ Passed: Blocked email ${blockedTestEmail} rejected.`);
            console.log(`Error: "${data.error}"`);
        } else {
            console.error(`❌ Failed: Blocked email ${blockedTestEmail} not rejected.`);
            console.log('Status:', res.status);
            console.log('Response:', data);
        }

        // Cleanup
        await redis.del(blockKey);
    } catch (err) {
        console.error('❌ Error testing blocked email:', err);
    }
}

testEmailRestrictions();
