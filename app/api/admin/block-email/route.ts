import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Admin endpoint to manually block an email address.
 * Protected by CRON_SECRET (reusing existing secret).
 * 
 * Usage: POST /api/admin/block-email
 * Body: { "email": "bad@gmail.com", "reason": "async bounce" }
 * Headers: { "Authorization": "Bearer <CRON_SECRET>" }
 */
export async function POST(request: NextRequest) {
    try {
        // Check authorization
        const authHeader = request.headers.get('Authorization');
        const expectedToken = `Bearer ${env.CRON_SECRET}`;

        if (!env.CRON_SECRET || authHeader !== expectedToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { email, reason } = body;

        if (!email || typeof email !== 'string') {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const blockKey = `email:blocked:${normalizedEmail}`;

        await redis.set(blockKey, {
            reason: reason || 'Manually blocked by admin',
            blockedAt: Date.now(),
        });

        logger.info("EmailManuallyBlocked", { email: normalizedEmail, reason });

        return NextResponse.json({
            success: true,
            message: `Email ${normalizedEmail} has been blocked.`
        });
    } catch (error: any) {
        logger.error("AdminBlockEmailError", { error: error.message });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * Admin endpoint to unblock an email address.
 */
export async function DELETE(request: NextRequest) {
    try {
        const authHeader = request.headers.get('Authorization');
        const expectedToken = `Bearer ${env.CRON_SECRET}`;

        if (!env.CRON_SECRET || authHeader !== expectedToken) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const email = searchParams.get('email');

        if (!email) {
            return NextResponse.json({ error: 'Email query param is required' }, { status: 400 });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const blockKey = `email:blocked:${normalizedEmail}`;

        await redis.del(blockKey);

        logger.info("EmailUnblocked", { email: normalizedEmail });

        return NextResponse.json({
            success: true,
            message: `Email ${normalizedEmail} has been unblocked.`
        });
    } catch (error: any) {
        logger.error("AdminUnblockEmailError", { error: error.message });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
