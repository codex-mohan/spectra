import type { Model, Usage } from './types.js';

/** Per-million-token rates; `longContext` applies once the whole prompt crosses the threshold. */
export interface ModelPricing {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	longContext?: {
		inputThreshold: number;
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
}

export type PricingStatus = 'fixed' | 'free' | 'included' | 'variable' | 'unknown';

/** Spectra provider ids whose rates live under a different models.dev key. */
const PRICING_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
	'openai-codex': 'openai',
	'opencode-zen': 'opencode',
};

const pricingCache = new Map<string, ModelPricing>();
let cacheLoaded = false;

function stripDateSuffix(id: string): string {
	return id.replace(/-\d{8}(-thinking)?$/, '').replace(/-20\d{6}$/, '');
}

function normalizeModelId(id: string): string {
	return stripDateSuffix(id).toLowerCase().replace(/[-_](thinking|chat|instruct|latest)$/, '');
}

function pricingKey(providerId: string, modelId: string): string {
	const normalizedProvider = providerId.trim().toLowerCase();
	const provider = PRICING_PROVIDER_ALIASES[normalizedProvider] ?? normalizedProvider;
	return `${provider}\u0000${normalizeModelId(modelId)}`;
}

/**
 * Load per-provider pricing from models.dev once per process. A failed attempt
 * leaves the hardcoded fallbacks in place and can be retried by the next caller
 * because `cacheLoaded` only latches on success.
 */
export async function loadPricingFromModelsDev(fetchImpl: typeof fetch = fetch): Promise<void> {
	if (cacheLoaded) return;
	try {
		const resp = await fetchImpl('https://models.dev/api.json', { signal: AbortSignal.timeout(5000) });
		if (!resp.ok) return;
		const data = await resp.json() as Record<string, {
			models?: Record<string, {
				cost?: {
					input?: number;
					output?: number;
					cache_read?: number;
					cache_write?: number;
					cache?: { read?: number; write?: number };
				};
			}>;
		}>;

		for (const [providerId, provider] of Object.entries(data)) {
			const models = provider?.models;
			if (!models || typeof models !== 'object') continue;
			for (const [modelId, modelData] of Object.entries(models)) {
				const cost = modelData?.cost;
				if (!cost) continue;
				pricingCache.set(pricingKey(providerId, modelId), {
					input: cost.input ?? 0,
					output: cost.output ?? 0,
					cacheRead: cost.cache_read ?? cost.cache?.read ?? 0,
					cacheWrite: cost.cache_write ?? cost.cache?.write ?? 0,
				});
			}
		}

		cacheLoaded = true;
	} catch {
		// Network unavailable or parse error — hardcoded fallbacks remain.
	}
}

const HARDCODED_FALLBACKS: Record<string, ModelPricing> = {
	'claude-opus-4-7': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
	'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
	'claude-opus-4-5': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
	'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
	'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
	'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
	'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
	'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
	'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
	'o3': { input: 10, output: 40, cacheRead: 2.5, cacheWrite: 10 },
	'o3-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1 },
	'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1 },
	'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.315, cacheWrite: 1.25 },
	'gemini-2.5-flash': { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0.15 },
	'gemini-2.0-flash': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
	'deepseek-chat': { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
	'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.055, cacheWrite: 0.55 },
};

/**
 * Resolve the rate card for a model. Provider-scoped lookup wins; the hardcoded
 * table is a last-resort, provider-agnostic fallback for offline first runs.
 */
export function getModelPricing(providerId: string, modelId: string): ModelPricing | null {
	return pricingCache.get(pricingKey(providerId, modelId))
		?? HARDCODED_FALLBACKS[normalizeModelId(modelId)]
		?? null;
}

/** `unknown` means no rate card exists — never render that as free. */
export function getPricingStatus(model: Pick<Model, 'provider' | 'id' | 'cost'>): PricingStatus {
	const pricing = model.cost ?? getModelPricing(model.provider, model.id);
	if (!pricing) return 'unknown';
	const free = pricing.input === 0 && pricing.output === 0 && pricing.cacheRead === 0 && pricing.cacheWrite === 0;
	return free ? 'free' : 'fixed';
}

export interface UsagePricingInput {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	inputUncached?: number;
}

/**
 * Price one assistant turn. `inputUncached` disambiguates providers whose
 * reported `input` includes cached tokens (OpenAI) from those that report them
 * separately (Anthropic); without it `input` is treated as uncached.
 */
export function calculateUsageCost(
	model: Pick<Model, 'provider' | 'id' | 'cost'>,
	usage: UsagePricingInput,
): NonNullable<Usage['cost']> {
	const pricing = model.cost ?? getModelPricing(model.provider, model.id);
	if (!pricing) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

	const cacheReadTokens = usage.cacheRead ?? 0;
	const cacheWriteTokens = usage.cacheWrite ?? 0;
	const uncachedInput = usage.inputUncached ?? usage.input;
	const promptTokens = uncachedInput + cacheReadTokens + cacheWriteTokens;
	const rates = pricing.longContext && promptTokens > pricing.longContext.inputThreshold
		? pricing.longContext
		: pricing;

	const input = (uncachedInput * rates.input) / 1_000_000;
	const output = (usage.output * rates.output) / 1_000_000;
	const cacheRead = (cacheReadTokens * rates.cacheRead) / 1_000_000;
	const cacheWrite = (cacheWriteTokens * rates.cacheWrite) / 1_000_000;

	return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

export function formatCost(dollars: number): string {
	if (dollars === 0) return 'Free';
	if (dollars < 0.001) return '<$0.001';
	return `$${dollars.toFixed(4)}`;
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}
