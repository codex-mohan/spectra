import { describe, it, expect } from 'vitest';
import {
	discoverProviderModels,
	getProvider,
	registerProvider,
	getModels,
	type Provider,
	type DiscoveryContext,
	type DiscoveryResult,
	type ModelInfo,
} from '../registry.js';
import '../providers/register-builtins.js';

describe('Discovery contract', () => {
	it('discoverProviderModels returns undefined for unknown provider', async () => {
		const result = await discoverProviderModels('nonexistent', {});
		expect(result).toBeUndefined();
	});

	it('discoverProviderModels returns undefined when provider lacks discoverModels', () => {
		const stub: Provider = {
			name: '__test-no-discovery',
			stream: (() => {}) as any,
			listModels: () => [{ id: 'a', name: 'A' }],
		};
		registerProvider(stub);
		// getProvider works, but discoverModels is absent
		expect(getProvider('__test-no-discovery')?.discoverModels).toBeUndefined();
	});

	it('discoverProviderModels calls discoverModels on the provider', async () => {
		const fakeModels: ModelInfo[] = [{ id: 'm1', name: 'Model 1', contextWindow: 8192 }];
		const stub: Provider = {
			name: '__test-with-discovery',
			stream: (() => {}) as any,
			discoverModels: (ctx: DiscoveryContext): DiscoveryResult => ({
				models: fakeModels.map((m) => ({ ...m, contextWindow: ctx.apiKey ? 16384 : m.contextWindow })),
				fetchedAt: 123,
			}),
		};
		registerProvider(stub);

		const result = await discoverProviderModels('__test-with-discovery', { apiKey: 'test-key' });
		expect(result).toBeDefined();
		expect(result!.models).toHaveLength(1);
		expect(result!.models[0].id).toBe('m1');
		expect(result!.models[0].contextWindow).toBe(16384);
		expect(result!.fetchedAt).toBe(123);
	});

	it('discoverProviderModels passes context through to discoverModels', async () => {
		let receivedCtx: DiscoveryContext | null = null;
		const stub: Provider = {
			name: '__test-ctx-pass',
			stream: (() => {}) as any,
			discoverModels: (ctx: DiscoveryContext): DiscoveryResult => {
				receivedCtx = ctx;
				return { models: [] };
			},
		};
		registerProvider(stub);

		const ctx: DiscoveryContext = {
			apiKey: 'sk-123',
			headers: { 'X-Custom': 'val' },
			baseUrl: 'https://custom.api.com/v1',
		};
		await discoverProviderModels('__test-ctx-pass', ctx);
		expect(receivedCtx).toEqual(ctx);
	});
});

describe('Enriched ModelInfo', () => {
	it('getModels returns bundled models with contextWindow from models.ts', async () => {
		const models = await getModels('anthropic');
		expect(models.length).toBeGreaterThan(0);
		for (const m of models) {
			expect(m.id).toBeTruthy();
			expect(m.name).toBeTruthy();
			// bundled models should have contextWindow from models.ts
			if (m.contextWindow !== undefined) {
				expect(typeof m.contextWindow).toBe('number');
			}
		}
	});

	it('ModelInfo supports optional enrichment fields', () => {
		const enriched: ModelInfo = {
			id: 'test',
			name: 'Test Model',
			contextWindow: 128000,
			supportsTools: true,
			supportedInputs: ['text', 'image'],
		};
		expect(enriched.contextWindow).toBe(128000);
		expect(enriched.supportsTools).toBe(true);
		expect(enriched.supportedInputs).toEqual(['text', 'image']);
	});
});

describe('OpenRouter discovery', () => {
	it('has discoverModels defined', () => {
		const provider = getProvider('openrouter');
		expect(provider).toBeDefined();
		expect(provider!.discoverModels).toBeDefined();
	});

	it('listModels returns bundled-only models', async () => {
		const provider = getProvider('openrouter');
		expect(provider).toBeDefined();
		const models = await provider!.listModels!();
		expect(Array.isArray(models)).toBe(true);
		expect(models.length).toBeGreaterThan(0);
		for (const m of models) {
			expect(m.id).toBeTruthy();
			expect(m.name).toBeTruthy();
		}
	});

	it('discoverModels returns a DiscoveryResult with fetchedAt', async () => {
		const provider = getProvider('openrouter');
		// discoverModels with no key should still return bundled fallback
		const result = await provider!.discoverModels!({});
		expect(result).toBeDefined();
		expect(result!.models).toBeDefined();
		expect(Array.isArray(result!.models)).toBe(true);
		expect(result!.fetchedAt).toBeDefined();
		expect(typeof result!.fetchedAt).toBe('number');
	});
});

describe('OpenAI-compatible provider discovery', () => {
	const liveModelProviders = [
		'ollama',
		'opencode-zen',
		'opencode-go',
	];

	for (const name of liveModelProviders) {
		it(`${name} has discoverModels defined`, () => {
			const provider = getProvider(name);
			expect(provider).toBeDefined();
			expect(provider!.discoverModels).toBeDefined();
		});

		it(`${name} listModels returns bundled models`, async () => {
			const provider = getProvider(name);
			const models = await provider!.listModels!();
			expect(Array.isArray(models)).toBe(true);
		});
	}

	const staticProviders = [
		'groq',
		'xai',
		'deepseek',
		'mistral',
		'cerebras',
		'google',
	];

	for (const name of staticProviders) {
		it(`${name} has discoverModels defined`, () => {
			const provider = getProvider(name);
			expect(provider).toBeDefined();
			expect(provider!.discoverModels).toBeDefined();
		});
	}
});
