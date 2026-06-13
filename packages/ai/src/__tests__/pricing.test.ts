import { describe, it, expect } from 'vitest';
import {
	calculateCost,
	formatCost,
	formatTokens,
	isFreeModel,
	getModelPricing,
} from '../pricing.js';

describe('Pricing — calculateCost', () => {
	it('calculates cost for known model', () => {
		const cost = calculateCost('claude-sonnet-4-5', { input: 1_000_000, output: 1_000_000 });
		expect(cost.input).toBeCloseTo(3, 2);
		expect(cost.output).toBeCloseTo(15, 2);
		expect(cost.total).toBeCloseTo(18, 2);
	});

	it('returns zero for unknown model', () => {
		const cost = calculateCost('nonexistent-model', { input: 1000, output: 1000 });
		expect(cost.total).toBe(0);
	});

	it('calculates partial token usage', () => {
		const cost = calculateCost('gpt-4o', { input: 500_000, output: 250_000 });
		expect(cost.input).toBeCloseTo(1.25, 2);
		expect(cost.output).toBeCloseTo(2.5, 2);
	});

	it('handles zero tokens', () => {
		const cost = calculateCost('claude-sonnet-4-5', { input: 0, output: 0 });
		expect(cost.total).toBe(0);
	});

	it('calculates cache read/write costs', () => {
		const cost = calculateCost('claude-sonnet-4-5', {
			input: 0,
			output: 0,
			cacheRead: 1_000_000,
			cacheWrite: 1_000_000,
		});
		expect(cost.cacheRead).toBeCloseTo(0.3, 2);
		expect(cost.cacheWrite).toBeCloseTo(3.75, 2);
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
	it('formats small numbers', () => {
		expect(formatTokens(500)).toBe('500');
	});

	it('formats thousands', () => {
		expect(formatTokens(1500)).toBe('1.5K');
	});

	it('formats millions', () => {
		expect(formatTokens(2_500_000)).toBe('2.5M');
	});

	it('formats exact thousand', () => {
		expect(formatTokens(1000)).toBe('1.0K');
	});

	it('formats exact million', () => {
		expect(formatTokens(1_000_000)).toBe('1.0M');
	});
});

describe('Pricing — isFreeModel', () => {
	it('returns false for paid models', () => {
		expect(isFreeModel('claude-sonnet-4-5')).toBe(false);
		expect(isFreeModel('gpt-4o')).toBe(false);
	});

	it('returns true for unknown models (no pricing)', () => {
		expect(isFreeModel('nonexistent-model')).toBe(true);
	});
});

describe('Pricing — getModelPricing', () => {
	it('returns pricing for hardcoded models', () => {
		const pricing = getModelPricing('claude-sonnet-4-5');
		expect(pricing).not.toBeNull();
		expect(pricing!.input).toBe(3);
		expect(pricing!.output).toBe(15);
	});

	it('returns pricing for gpt-4o', () => {
		const pricing = getModelPricing('gpt-4o');
		expect(pricing).not.toBeNull();
		expect(pricing!.input).toBe(2.5);
		expect(pricing!.output).toBe(10);
	});

	it('matches model IDs with date suffixes', () => {
		const pricing = getModelPricing('claude-sonnet-4-5-20250514');
		expect(pricing).not.toBeNull();
		expect(pricing!.input).toBe(3);
	});

	it('returns null for unknown models', () => {
		const pricing = getModelPricing('totally-unknown-model');
		expect(pricing).toBeNull();
	});

	it('handles partial matches', () => {
		const pricing = getModelPricing('claude-opus-4');
		expect(pricing).not.toBeNull();
	});
});
