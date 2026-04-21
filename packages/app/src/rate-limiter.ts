import type { RateLimiter, RateLimitResult } from "./types.js";

export class SimpleRateLimiter implements RateLimiter {
  private requests = new Map<string, number[]>();

  constructor(
    private requestsPerMinute: number = 60,
    private windowMs: number = 60000
  ) {}

  async checkLimit(userId: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get user's requests within window
    let userRequests = this.requests.get(userId) ?? [];
    userRequests = userRequests.filter((time) => time > windowStart);

    const count = userRequests.length;
    const allowed = count < this.requestsPerMinute;

    if (allowed) {
      userRequests.push(now);
      this.requests.set(userId, userRequests);
    }

    return {
      allowed,
      remaining: Math.max(0, this.requestsPerMinute - count - 1),
      resetAt: new Date(windowStart + this.windowMs),
    };
  }
}
