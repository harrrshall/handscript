/**
 * Redis client with in-memory fallback for local development
 * When UPSTASH_REDIS_REST_URL is not configured, uses a simple in-memory store
 */

import { env, LOCAL_DEV_MODE } from './env';

// Declare global type for in-memory stores (persists across Next.js HMR)
declare global {
  var __redisMemoryStore: Map<string, { value: any; expiry?: number }> | undefined;
  var __redisHashStore: Map<string, Map<string, any>> | undefined;
  var __redisSetStore: Map<string, Set<string>> | undefined;
  var __redisInitialized: boolean | undefined;
}

// Use globalThis to persist across Next.js dev mode hot module reloading
const memoryStore = globalThis.__redisMemoryStore ?? new Map<string, { value: any; expiry?: number }>();
const hashStore = globalThis.__redisHashStore ?? new Map<string, Map<string, any>>();
const setStore = globalThis.__redisSetStore ?? new Map<string, Set<string>>();

// Save references to globalThis for persistence
globalThis.__redisMemoryStore = memoryStore;
globalThis.__redisHashStore = hashStore;
globalThis.__redisSetStore = setStore;

// Helper to check expiry
const isExpired = (entry: { value: any; expiry?: number }) => {
  return entry.expiry && Date.now() > entry.expiry;
};

// Clean expired entries periodically (only set once)
if (!globalThis.__redisInitialized) {
  globalThis.__redisInitialized = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore) {
      if (entry.expiry && now > entry.expiry) {
        memoryStore.delete(key);
      }
    }
  }, 60000); // Clean every minute
}

/**
 * Redis-compatible interface for both Upstash Redis and in-memory fallback
 */
interface RedisInterface {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any, options?: { ex?: number }) => Promise<void>;
  del: (...keys: string[]) => Promise<void>;
  expire: (key: string, seconds: number) => Promise<void>;
  incr: (key: string) => Promise<number>;
  incrby: (key: string, amount: number) => Promise<number>;
  mget: (keys: string[]) => Promise<any[]>;
  mset: (obj: Record<string, any>) => Promise<void>;
  scan: (cursor: string, options?: { match?: string; count?: number }) => Promise<[string, string[]]>;
  sadd: (key: string, ...members: (string | number)[]) => Promise<void>;
  scard: (key: string) => Promise<number>;
  hset: (key: string, data: Record<string, any>) => Promise<void>;
  hgetall: (key: string) => Promise<Record<string, any> | null>;
  hincrby: (key: string, field: string, increment: number) => Promise<number>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  lpush: (key: string, ...values: string[]) => Promise<void>;
  ltrim: (key: string, start: number, stop: number) => Promise<void>;
}

// In-memory Redis implementation
const memoryRedis: RedisInterface = {
  async get(key: string) {
    const entry = memoryStore.get(key);
    if (!entry || isExpired(entry)) {
      memoryStore.delete(key);
      return null;
    }
    return entry.value;
  },

  async set(key: string, value: any, options?: { ex?: number }) {
    const expiry = options?.ex ? Date.now() + (options.ex * 1000) : undefined;
    memoryStore.set(key, { value, expiry });
  },

  async del(...keys: string[]) {
    for (const key of keys) {
      memoryStore.delete(key);
      hashStore.delete(key);
      setStore.delete(key);
    }
  },

  async expire(key: string, seconds: number) {
    const entry = memoryStore.get(key);
    if (entry) {
      entry.expiry = Date.now() + (seconds * 1000);
    }
  },

  async incr(key: string) {
    const entry = memoryStore.get(key);
    const current = (entry && !isExpired(entry)) ? (Number(entry.value) || 0) : 0;
    const newValue = current + 1;
    memoryStore.set(key, { value: newValue, expiry: entry?.expiry });
    return newValue;
  },

  async incrby(key: string, amount: number) {
    const entry = memoryStore.get(key);
    const current = (entry && !isExpired(entry)) ? (Number(entry.value) || 0) : 0;
    const newValue = current + amount;
    memoryStore.set(key, { value: newValue, expiry: entry?.expiry });
    return newValue;
  },

  async mget(keys: string[]) {
    return keys.map(key => {
      const entry = memoryStore.get(key);
      if (!entry || isExpired(entry)) return null;
      return entry.value;
    });
  },

  async mset(obj: Record<string, any>) {
    for (const [key, value] of Object.entries(obj)) {
      memoryStore.set(key, { value });
    }
  },

  async scan(cursor: string, options?: { match?: string; count?: number }) {
    const pattern = options?.match?.replace(/\*/g, '.*') || '.*';
    const regex = new RegExp(`^${pattern}$`);
    const keys = Array.from(memoryStore.keys()).filter(k => regex.test(k));
    return ['0', keys] as [string, string[]];
  },

  async sadd(key: string, ...members: (string | number)[]) {
    let set = setStore.get(key);
    if (!set) {
      set = new Set();
      setStore.set(key, set);
    }
    for (const member of members) {
      set.add(String(member));
    }
  },

  async hset(key: string, data: Record<string, any>) {
    let hash = hashStore.get(key);
    if (!hash) {
      hash = new Map();
      hashStore.set(key, hash);
    }
    for (const [field, value] of Object.entries(data)) {
      hash.set(field, value);
    }
  },

  async hgetall(key: string) {
    const hash = hashStore.get(key);
    if (!hash || hash.size === 0) return null;
    return Object.fromEntries(hash);
  },

  async hincrby(key: string, field: string, increment: number) {
    let hash = hashStore.get(key);
    if (!hash) {
      hash = new Map();
      hashStore.set(key, hash);
    }
    const current = Number(hash.get(field) || 0);
    const newValue = current + increment;
    hash.set(field, newValue);
    return newValue;
  },

  async scard(key: string) {
    const set = setStore.get(key);
    return set?.size || 0;
  },

  async lrange(key: string, start: number, stop: number) {
    const list = memoryStore.get(`list:${key}`);
    if (!list || !Array.isArray(list.value)) return [];
    const arr = list.value as string[];
    const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
    return arr.slice(start, end);
  },

  async lpush(key: string, ...values: string[]) {
    const existing = memoryStore.get(`list:${key}`);
    const list = (existing && Array.isArray(existing.value)) ? existing.value as string[] : [];
    list.unshift(...values);
    memoryStore.set(`list:${key}`, { value: list });
  },

  async ltrim(key: string, start: number, stop: number) {
    const existing = memoryStore.get(`list:${key}`);
    if (!existing || !Array.isArray(existing.value)) return;
    const arr = existing.value as string[];
    const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
    memoryStore.set(`list:${key}`, { value: arr.slice(start, end) });
  },
};

// Create the appropriate Redis client
let redis: RedisInterface;

if (LOCAL_DEV_MODE) {
  redis = memoryRedis;
} else {
  // Use real Upstash Redis
  const { Redis } = require('@upstash/redis');
  redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

export { redis };
