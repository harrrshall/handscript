
import nodemailer from 'nodemailer';
import { env } from './env';
import { logger } from './logger';

// Create a singleton transporter
// Note: We create it lazily to avoid errors if env vars aren't set yet during build
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
    if (!transporter) {
        if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
            throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD');
        }

        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: env.GMAIL_USER,
                pass: env.GMAIL_APP_PASSWORD,
            },
        });
    }
    return transporter;
}

interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
}

export async function sendGmail(params: SendEmailParams) {
    try {
        const mailer = getTransporter();
        const info = await mailer.sendMail({
            from: `HandScript <${env.GMAIL_USER}>`,
            to: params.to,
            subject: params.subject,
            html: params.html,
        });

        logger.info('GmailSent', { messageId: info.messageId, to: params.to });
        return { success: true, messageId: info.messageId };
    } catch (error: any) {
        logger.error('GmailSendFailed', { error: error.message });
        throw error;
    }
}
