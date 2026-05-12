import type { RateLimiter, RateLimitResult, RedisClient } from "./types.js";

export interface RedisRateLimiterConfig {
  requestsPerWindow: number;
  windowMs: number;
  keyPrefix: string;
  burstAllowance?: number;
}

export class RedisRateLimiter implements RateLimiter {
  private redis: RedisClient;
  private config: RedisRateLimiterConfig;

  constructor(redis: RedisClient, config?: Partial<RedisRateLimiterConfig>) {
    this.redis = redis;
    this.config = {
      requestsPerWindow: config?.requestsPerWindow ?? 60,
      windowMs: config?.windowMs ?? 60000,
      keyPrefix: config?.keyPrefix ?? "rl",
      burstAllowance: config?.burstAllowance ?? 0,
    };
  }

  async checkLimit(userId: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const key = `${this.config.keyPrefix}:user:${userId}`;

    const limit = this.config.requestsPerWindow + (this.config.burstAllowance ?? 0);

    await this.redis.zremrangebyscore(key, 0, windowStart);
    const count = await this.redis.zcard(key);

    const allowed = count < limit;

    if (allowed) {
      await this.redis.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
      await this.redis.expire(key, Math.ceil(this.config.windowMs / 1000) * 2);
    }

    return {
      allowed,
      remaining: Math.max(0, limit - count - (allowed ? 1 : 0)),
      resetAt: new Date(windowStart + this.config.windowMs),
    };
  }
}
