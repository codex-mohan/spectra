import { beforeAll, describe, expect, it } from 'vitest';
import {
	calculateUsageCost,
	formatCost,
	formatTokens,
	getModelPricing,
	getPricingStatus,
	loadPricingFromModelsDev,
} from '../pricing.js';

const stubModelsDev = {
	providerA: { models: { 'shared-model': { cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 1 } } } },
	providerB: { models: { 'shared-model': { cost: { input: 10, output: 20, cache_read: 1, cache_write: 10 } } } },
	openai: { models: { 'gpt-test': { cost: { input: 2, output: 4, cache_read: 0.2, cache_write: 2 } } } },
};

beforeAll(async () => {
	await loadPricingFromModelsDev(async () => new Response(JSON.stringify(stubModelsDev), { status: 200 }));
});

describe('Pricing — provider scope', () => {
	it('prices the same model id differently per provider', () => {
		const usage = { input: 1_000_000, output: 1_000_000 };

		expect(calculateUsageCost({ provider: 'providerA', id: 'shared-model' }, usage).total).toBeCloseTo(3, 6);
		expect(calculateUsageCost({ provider: 'providerB', id: 'shared-model' }, usage).total).toBeCloseTo(30, 6);
	});

	it('resolves the openai-codex alias to openai rates', () => {
		expect(calculateUsageCost({ provider: 'openai-codex', id: 'gpt-test' }, { input: 1_000_000, output: 0 }).total)
			.toBeCloseTo(2, 6);
	});

	it('does not fuzzy-match a shorter id onto a longer one', () => {
		expect(getModelPricing('providerA', 'shared')).toBeNull();
	});

	it('falls back to the provider-agnostic table for offline first runs', () => {
		const pricing = getModelPricing('anthropic', 'claude-sonnet-4-5-20250514');

		expect(pricing?.input).toBe(3);
		expect(pricing?.output).toBe(15);
	});
});

describe('Pricing — calculateUsageCost', () => {
	it('prices cache reads and writes separately', () => {
		const cost = calculateUsageCost(
			{ provider: 'providerA', id: 'shared-model' },
			{ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
		);

		expect(cost.cacheRead).toBeCloseTo(0.1, 6);
		expect(cost.cacheWrite).toBeCloseTo(1, 6);
		expect(cost.total).toBeCloseTo(1.1, 6);
	});

	it('bills only the uncached portion of an OpenAI-style prompt at input rates', () => {
		const cost = calculateUsageCost(
			{ provider: 'providerA', id: 'shared-model' },
			{ input: 1_000_000, inputUncached: 100_000, output: 0, cacheRead: 900_000, cacheWrite: 0 },
		);

		expect(cost.input).toBeCloseTo(0.1, 6);
		expect(cost.cacheRead).toBeCloseTo(0.09, 6);
		expect(cost.total).toBeCloseTo(0.19, 6);
	});

	it('treats input as already uncached when inputUncached is absent', () => {
		const cost = calculateUsageCost(
			{ provider: 'providerA', id: 'shared-model' },
			{ input: 100_000, output: 0, cacheRead: 900_000, cacheWrite: 0 },
		);

		expect(cost.input).toBeCloseTo(0.1, 6);
		expect(cost.cacheRead).toBeCloseTo(0.09, 6);
		expect(cost.total).toBeCloseTo(0.19, 6);
	});

	it('uses the model row rate card when provided', () => {
		const model = {
			provider: 'anything',
			id: 'unlisted',
			cost: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		expect(calculateUsageCost(model, { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }).total)
			.toBeCloseTo(5, 6);
	});

	it('promotes the whole prompt to long-context rates past the threshold', () => {
		const model = {
			provider: 'anything',
			id: 'long-context',
			cost: {
				input: 1,
				output: 2,
				cacheRead: 0,
				cacheWrite: 0,
				longContext: { inputThreshold: 1_000, input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
			},
		};

		expect(calculateUsageCost(model, { input: 2_000, output: 0, cacheRead: 0, cacheWrite: 0 }).total)
			.toBeCloseTo(0.02, 6);
		expect(calculateUsageCost(model, { input: 500, output: 0, cacheRead: 0, cacheWrite: 0 }).total)
			.toBeCloseTo(0.0005, 6);
	});

	it('returns zero cost for unknown models', () => {
		const cost = calculateUsageCost({ provider: 'nobody', id: 'nonexistent-model' }, { input: 1_000, output: 1_000 });

		expect(cost.total).toBe(0);
	});
});

describe('Pricing — getPricingStatus', () => {
	it('reports fixed for priced models', () => {
		expect(getPricingStatus({ provider: 'providerA', id: 'shared-model' })).toBe('fixed');
	});

	it('reports free only for zero-rate cards', () => {
		expect(getPricingStatus({
			provider: 'providerA',
			id: 'free-model',
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		})).toBe('free');
	});

	it('reports unknown instead of free when no rate card exists', () => {
		expect(getPricingStatus({ provider: 'nobody', id: 'nonexistent-model' })).toBe('unknown');
	});
});

describe('Pricing — formatCost', () => {
	it('formats zero as Free', () => {
		expect(formatCost(0)).toBe('Free');
	});

	it('formats very small values', () => {
		expect(formatCost(0.0005)).toBe('<$0.001');
	});

	it('formats normal values', () => {
		expect(formatCost(0.1234)).toBe('$0.1234');
	});

	it('formats larger values', () => {
		expect(formatCost(1.5)).toBe('$1.5000');
	});
});

describe('Pricing — formatTokens', () => {
	it('formats millions, thousands, and small values', () => {
		expect(formatTokens(1_500_000)).toBe('1.5M');
		expect(formatTokens(1_500)).toBe('1.5K');
		expect(formatTokens(42)).toBe('42');
	});
});
