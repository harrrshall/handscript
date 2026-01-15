
import { Resend } from 'resend';
import * as dotenv from 'dotenv';
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

async function main() {
    if (!process.env.RESEND_API_KEY) {
        console.error('RESEND_API_KEY is missing');
        process.exit(1);
    }

    console.log('Testing Resend API Key...');

    try {
        const { data, error } = await resend.emails.send({
            from: 'HandScript <onboarding@resend.dev>',
            to: 'delivered@resend.dev',
            subject: 'Resend API Key Verification',
            html: '<p>If you see this, the API key works!</p>'
        });

        if (error) {
            console.error('Failed to send email:', error);
            process.exit(1);
        }

        console.log('Successfully sent test email:', data);
    } catch (err) {
        console.error('Unexpected error:', err);
        process.exit(1);
    }
}

main();
