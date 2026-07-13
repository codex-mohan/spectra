import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerProvider, getProvider, listProviders, stream, getModels } from '../registry.js';
import { createAnthropicProvider } from '../providers/anthropic.js';
import type { Model, Context } from '../types.js';
import '../providers/register-builtins.js';

describe('Provider Registry', () => {
	beforeEach(() => {
		registerProvider(createAnthropicProvider());
	});

	it('should register and retrieve provider', () => {
		const provider = getProvider('anthropic');
		expect(provider).toBeDefined();
		expect(provider?.name).toBe('anthropic');
	});

	it('should list all registered providers', () => {
		const providers = listProviders();
		expect(providers).toContain('anthropic');
	});

	it('should return undefined for unknown provider', () => {
		const provider = getProvider('unknown');
		expect(provider).toBeUndefined();
	});
});

	it('registers OAuth-backed OpenAI-compatible providers', () => {
		for (const provider of ['github-copilot', 'xai', 'digitalocean', 'snowflake-cortex']) {
			expect(getProvider(provider)).toBeDefined();
		}
	});

describe('openai-codex model catalog', () => {
	it('should have openai-codex registered as a provider', () => {
		const provider = getProvider('openai-codex');
		expect(provider).toBeDefined();
		expect(provider?.name).toBe('openai-codex');
	});

	it('should return a non-empty model list for openai-codex', async () => {
		const models = await getModels('openai-codex');
		expect(models.length).toBeGreaterThan(0);
	});

	it('should include codex models in the catalog', async () => {
		const models = await getModels('openai-codex');
		const codexModels = models.filter((m) => m.id.includes('codex'));
		expect(codexModels.length).toBeGreaterThan(0);
	});


});

describe('Anthropic Provider', () => {
	it('should create provider with correct name', () => {
		const provider = createAnthropicProvider();
		expect(provider.name).toBe('anthropic');
	});

	it('should create stream that emits error without API key', async () => {
		const provider = createAnthropicProvider();
		const model: Model = {
			id: 'claude-sonnet-4-20250514',
			name: 'Claude Sonnet 4',
			provider: 'anthropic',
			api: 'anthropic-messages',
		};
		const context: Context = { messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] };

		const stream = provider.stream(model, context);

		const events: string[] = [];
		for await (const event of stream) {
			events.push(event.type);
		}

		expect(events).toContain('start');
		expect(events).toContain('error');
	});

	it('should list models from provider', async () => {
		const provider = createAnthropicProvider();
		const models = await provider.listModels?.();
		expect(models).toBeDefined();
		expect(Array.isArray(models)).toBe(true);
	});
});

describe('Anthropic Provider thinkingEffort', () => {
	it('should error without API key regardless of thinkingEffort', async () => {
		const provider = createAnthropicProvider();
		const model: Model = {
			id: 'claude-sonnet-4-20250514',
			name: 'Claude Sonnet 4',
			provider: 'anthropic',
			api: 'anthropic-messages',
		};
		const context: Context = { messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] };

		const stream = provider.stream(model, context, { thinkingEffort: 'high' });

		const events: string[] = [];
		for await (const event of stream) {
			events.push(event.type);
		}

		expect(events).toContain('error');
	});

});
