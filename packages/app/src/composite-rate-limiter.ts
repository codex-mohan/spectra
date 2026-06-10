import type { RateLimiter, RateLimitResult } from './types.js';

export interface CompositeLimit {
	limiter: RateLimiter;
	key: string;
}

export class CompositeRateLimiter implements RateLimiter {
	private limits: CompositeLimit[];

	constructor(limits: CompositeLimit[]) {
		this.limits = limits;
	}

	addLimit(limiter: RateLimiter, key: string): void {
		this.limits.push({ limiter, key });
	}

	async checkLimit(userId: string): Promise<RateLimitResult> {
		const results: RateLimitResult[] = [];

		for (const { limiter, key } of this.limits) {
			const compositeKey = `${key}:${userId}`;
			const result = await limiter.checkLimit(compositeKey);
			results.push(result);

			if (!result.allowed) {
				return {
					allowed: false,
					remaining: 0,
					resetAt: result.resetAt,
				};
			}
		}

		return {
			allowed: true,
			remaining: Math.min(...results.map((r) => r.remaining)),
			resetAt: new Date(Math.min(...results.map((r) => r.resetAt.getTime()))),
		};
	}
}
