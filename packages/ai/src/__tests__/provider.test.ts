import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerProvider, getProvider, listProviders, stream, getModels } from '../registry.js';
import { createAnthropicProvider } from '../providers/anthropic.js';
import {
	createOpenAICodexResponsesProvider,
	OPENAI_CODEX_PROVIDER_CONFIG,
	OPENAI_CODEX_RESPONSES_BASE_URL,
	parseOpenAICodexModels,
} from '../providers/openai-codex-responses.js';
import { mergeOpenAIResponsesHeaders } from '../providers/openai-responses.js';
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

	it('uses the dedicated ChatGPT Codex Responses transport configuration', () => {
		const provider = createOpenAICodexResponsesProvider();

		expect(provider.name).toBe('openai-codex');
		expect(OPENAI_CODEX_PROVIDER_CONFIG).toEqual({
			name: 'openai-codex',
			modelProvider: 'openai-codex',
			baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
		});
		expect(OPENAI_CODEX_RESPONSES_BASE_URL).toBe('https://chatgpt.com/backend-api/codex');
	});

	it('forwards request headers and lets account-scoped values override model defaults', () => {
		expect(mergeOpenAIResponsesHeaders(
			{ 'ChatGPT-Account-Id': 'stale-account', 'X-Model': 'model' },
			{ 'ChatGPT-Account-Id': 'account-123', 'X-Request': 'request' },
		)).toEqual({
			'ChatGPT-Account-Id': 'account-123',
			'X-Model': 'model',
			'X-Request': 'request',
		});
	});

	it('normalizes only visible API-supported Codex discovery models', () => {
		expect(parseOpenAICodexModels({ models: [
			{
				slug: 'gpt-codex',
				display_name: 'GPT Codex',
				visibility: 'list',
				supported_in_api: true,
				context_window: 272_000,
				input_modalities: ['text', 'image'],
			},
			{ slug: 'hidden', display_name: 'Hidden', visibility: 'hide', supported_in_api: true },
			{ slug: 'unsupported', display_name: 'Unsupported', visibility: 'list', supported_in_api: false },
		] })).toEqual([{
			id: 'gpt-codex',
			name: 'GPT Codex',
			contextWindow: 272_000,
			supportedInputs: ['text', 'image'],
		}]);
	});

	it('should return a non-empty model list for openai-codex', async () => {
		const models = await getModels('openai-codex');
		expect(models.length).toBeGreaterThan(0);
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
