
import { redis } from './redis';

export interface LogEntry {
    event: string;
    level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
    jobId?: string;
    batchIndex?: number;
    pageIndex?: number;
    timestamp: string;
    duration?: number;
    durationMs?: number; // Aliases for duration
    error?: string;
    stack?: string;
    metadata?: Record<string, any>;
    sessionId?: string;
    userId?: string;
    [key: string]: any; // Allow arbitrary fields for flexibility
}

class Logger {
    private format(level: LogEntry['level'], event: string, data: Partial<LogEntry>): LogEntry {
        return {
            level,
            event,
            timestamp: new Date().toISOString(),
            ...data,
        } as LogEntry;
    }

    private print(entry: LogEntry) {
        if (entry.level === 'debug' && process.env.NODE_ENV === 'production') return;
        console.log(JSON.stringify(entry));
    }

    debug(event: string, data: Partial<LogEntry> = {}) {
        this.print(this.format('debug', event, data));
    }

    info(event: string, data: Partial<LogEntry> = {}) {
        this.print(this.format('info', event, data));
    }

    warn(event: string, data: Partial<LogEntry> = {}) {
        this.print(this.format('warn', event, data));
    }

    error(event: string, data: Partial<LogEntry> = {}) {
        this.print(this.format('error', event, data));
    }

    critical(event: string, data: Partial<LogEntry> = {}) {
        this.print(this.format('critical', event, data));
    }

    /**
     * Logs a user-facing message to Redis for the job status UI.
     */
    async logToRedis(jobId: string, message: string) {
        try {
            const logMsg = `${new Date().toISOString()} ${message}`;
            await redis.lpush(`job:${jobId}:logs`, logMsg);
            await redis.ltrim(`job:${jobId}:logs`, 0, 49); // Keep last 50 logs
            await redis.expire(`job:${jobId}:logs`, 24 * 60 * 60); // 24h expiry
        } catch (e) {
            this.error('RedisLogFailed', { jobId, error: String(e) });
        }
    }
}

class Metrics {
    /**
     * Increment a Redis-based counter.
     */
    async increment(name: string, amount: number = 1) {
        try {
            await redis.incrby(`metrics:${name}`, amount);
        } catch (e) {
            // Don't let metrics failures crash the app
            console.error(`[Metrics] Failed to increment ${name}:`, e);
        }
    }

    /**
     * Record a timing metric (histograms can be complex in Redis, so we store avg/sum/count if needed, 
     * but for now let's just log it and maybe store the latest/max).
     */
    async recordLatency(name: string, durationMs: number) {
        try {
            // Simple: store last duration and atomic count/sum for averaging
            const key = `metrics:latency:${name}`;
            await redis.hset(key, {
                last: durationMs,
            });
            await redis.hincrby(key, 'count', 1);
            await redis.hincrby(key, 'sum', Math.round(durationMs));
        } catch (e) {
            console.error(`[Metrics] Failed to record latency for ${name}:`, e);
        }
    }
}

export const logger = new Logger();
export const metrics = new Metrics();
