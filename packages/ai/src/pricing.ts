export interface ModelPricing {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

const DEFAULT_PRICING: ModelPricing = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

let pricingCache: Record<string, ModelPricing> = {};
let cacheLoaded = false;

function stripDateSuffix(id: string): string {
	return id.replace(/-\d{8}(-thinking)?$/, '').replace(/-20\d{6}$/, '');
}

function normalizeModelId(id: string): string {
	return stripDateSuffix(id).toLowerCase().replace(/[-_](thinking|chat|instruct|latest)$/, '');
}

export async function loadPricingFromModelsDev(): Promise<void> {
	if (cacheLoaded) return;

	try {
		const resp = await fetch('https://models.dev/api.json');
		if (!resp.ok) return;
		const data = await resp.json() as Record<string, any>;

		for (const [_providerId, provider] of Object.entries(data)) {
			if (!provider || typeof provider !== 'object') continue;
			const models = provider.models;
			if (!models || typeof models !== 'object') continue;

			for (const [modelId, modelData] of Object.entries(models)) {
				const cost = (modelData as any)?.cost;
				if (!cost) continue;

				pricingCache[normalizeModelId(modelId)] = {
					input: cost.input ?? 0,
					output: cost.output ?? 0,
					cacheRead: cost.cache_read ?? cost.cache?.read ?? 0,
					cacheWrite: cost.cache_write ?? cost.cache?.write ?? 0,
				};
			}
		}

		cacheLoaded = true;
	} catch {
		// Network unavailable or parse error — use hardcoded fallbacks
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

export function getModelPricing(modelId: string): ModelPricing | null {
	const normalized = normalizeModelId(modelId);

	// 1. Try live cache from models.dev
	if (pricingCache[normalized]) return pricingCache[normalized];

	// 2. Try partial match in live cache
	for (const [key, value] of Object.entries(pricingCache)) {
		if (normalized.startsWith(key) || key.startsWith(normalized)) return value;
	}

	// 3. Try hardcoded fallbacks
	if (HARDCODED_FALLBACKS[normalized]) return HARDCODED_FALLBACKS[normalized];

	for (const [key, value] of Object.entries(HARDCODED_FALLBACKS)) {
		if (normalized.startsWith(key) || key.startsWith(normalized)) return value;
	}

	return null;
}

export function isFreeModel(modelId: string): boolean {
	const pricing = getModelPricing(modelId);
	if (!pricing) return true;
	return pricing.input === 0 && pricing.output === 0;
}

export function calculateCost(
	modelId: string,
	usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } {
	const pricing = getModelPricing(modelId);
	if (!pricing) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

	const inputCost = (usage.input * pricing.input) / 1_000_000;
	const outputCost = (usage.output * pricing.output) / 1_000_000;
	const cacheReadCost = ((usage.cacheRead ?? 0) * pricing.cacheRead) / 1_000_000;
	const cacheWriteCost = ((usage.cacheWrite ?? 0) * pricing.cacheWrite) / 1_000_000;

	return {
		input: inputCost,
		output: outputCost,
		cacheRead: cacheReadCost,
		cacheWrite: cacheWriteCost,
		total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
	};
}

export function formatCost(cents: number): string {
	if (cents === 0) return 'Free';
	if (cents < 0.001) return '<$0.001';
	return `$${cents.toFixed(4)}`;
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}
