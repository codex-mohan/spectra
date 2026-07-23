import { registerProvider } from '../registry.js';
import type { Provider, DiscoveryContext, DiscoveryResult, ModelInfo } from '../registry.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAICompletionsProvider, type OpenAICompletionsOptions } from './openai-completions.js';
import { createOpenAIResponsesProvider } from './openai-responses.js';
import { createOpenAICodexResponsesProvider } from './openai-codex-responses.js';
import { createOpenRouterProvider } from './openrouter.js';
import { getProviderModels } from '../models.js';
import type { Model, Context } from '../types.js';
import { AssistantMessageEventStream } from '../event-stream.js';

function envBaseUrl(envName: string, fallback: string): string {
	return process.env[envName]?.replace(/\/+$/, '') || fallback;
}

function bundledModels(providerName: string): ModelInfo[] {
	return getProviderModels(providerName).map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
}

interface LiveApiModel {
	id: string;
	name: string;
	context_length?: number;
	supported_parameters?: string[];
	supported_inputs?: string[];
}

async function fetchLiveModels(baseUrl: string, headers?: Record<string, string>): Promise<ModelInfo[]> {
	const res = await fetch(`${baseUrl}/models`, {
		signal: AbortSignal.timeout(5000),
		headers,
	});
	if (!res.ok) throw new Error(`Model discovery failed: ${res.status}`);
	const json = await res.json();
	const list = (json.data || []) as LiveApiModel[];
	return list
		.map((m) => ({
			id: m.id,
			name: m.name || m.id,
			contextWindow: m.context_length,
			supportsTools: m.supported_parameters?.includes('tools'),
			supportedInputs: m.supported_inputs,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function wrapOpenAIProvider(name: string, baseUrl: string): Provider {
	const inner = createOpenAICompletionsProvider();
	return {
		name,
		listModels: () => bundledModels(name),
		async discoverModels(context: DiscoveryContext): Promise<DiscoveryResult> {
			const headers: Record<string, string> = { ...context.headers };
			if (context.apiKey) {
				headers['Authorization'] = `Bearer ${context.apiKey}`;
			}
			const live = await fetchLiveModels(context.baseUrl || baseUrl, headers);
			return { models: live, fetchedAt: Date.now() };
		},
		stream(model: Model, context: Context, options?: OpenAICompletionsOptions): AssistantMessageEventStream {
			return inner.stream({ ...model, baseUrl: model.baseUrl || baseUrl }, context, options);
		},
	};
}

function wrapOpenAIProviderWithLiveModels(name: string, baseUrl: string): Provider {
	const inner = createOpenAICompletionsProvider();
	return {
		name,
		listModels: () => bundledModels(name),
		async discoverModels(context: DiscoveryContext): Promise<DiscoveryResult> {
			const headers: Record<string, string> = { ...context.headers };
			if (context.apiKey) {
				headers['Authorization'] = `Bearer ${context.apiKey}`;
			}
			const live = await fetchLiveModels(context.baseUrl || baseUrl, headers);
			return { models: live, fetchedAt: Date.now() };
		},
		stream(model: Model, context: Context, options?: OpenAICompletionsOptions): AssistantMessageEventStream {
			return inner.stream({ ...model, baseUrl: model.baseUrl || baseUrl }, context, options);
		},
	};
}

function wrapSnowflakeProvider(name: string): Provider {
	const inner = createOpenAICompletionsProvider();
	return {
		name,
		listModels: () => bundledModels(name),
		stream(model: Model, context: Context, options?: OpenAICompletionsOptions): AssistantMessageEventStream {
			return inner.stream(model, context, options);
		},
	};
}

export function initProviders(): void {
	registerProvider(createAnthropicProvider());
	registerProvider(createOpenAICompletionsProvider());
	registerProvider(createOpenAIResponsesProvider());
	registerProvider(createOpenRouterProvider());

	registerProvider(wrapOpenAIProvider('groq', 'https://api.groq.com/openai/v1'));
	registerProvider(wrapOpenAIProvider('xai', 'https://api.x.ai/v1'));
	registerProvider(wrapOpenAIProvider('deepseek', 'https://api.deepseek.com/v1'));
	registerProvider(wrapOpenAIProvider('mistral', 'https://api.mistral.ai/v1'));
	registerProvider(wrapOpenAIProvider('cerebras', 'https://api.cerebras.ai/v1'));
	registerProvider(wrapOpenAIProvider('google', 'https://generativelanguage.googleapis.com/v1beta/openai'));
	registerProvider(createOpenAICodexResponsesProvider());
	registerProvider(wrapOpenAIProvider('fireworks-ai', 'https://api.fireworks.ai/inference/v1'));
	registerProvider(wrapOpenAIProvider('togetherai', 'https://api.together.xyz/v1'));
	registerProvider(wrapOpenAIProvider('perplexity', 'https://api.perplexity.ai'));
	registerProvider(wrapOpenAIProvider('cohere', 'https://api.cohere.com/v1'));
	registerProvider(wrapOpenAIProvider('novita-ai', 'https://api.novita.ai/v3/openai'));
	registerProvider(wrapOpenAIProvider('moonshotai', 'https://api.moonshot.cn/v1'));
	registerProvider(wrapOpenAIProvider('chutes', 'https://api.chutes.ai/v1'));
	registerProvider(wrapOpenAIProvider('minimax', 'https://api.minimax.chat/v1'));
	registerProvider(wrapOpenAIProvider('huggingface', 'https://api-inference.huggingface.co/v1'));
	registerProvider(wrapOpenAIProvider('nvidia', 'https://integrate.api.nvidia.com/v1'));
	registerProvider(wrapOpenAIProvider('zai', 'https://api.z.ai/v1'));
	// OAuth-authenticated providers
	registerProvider(wrapOpenAIProvider('github-copilot', 'https://api.githubcopilot.com'));
	registerProvider(wrapOpenAIProvider('digitalocean', 'https://inference.do-ai.run/v1'));
	registerProvider(wrapSnowflakeProvider('snowflake-cortex'));

	// Coding plan providers
	registerProvider(wrapOpenAIProviderWithLiveModels('opencode-go', 'https://opencode.ai/zen/go/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('alibaba-coding-plan', 'https://coding-intl.dashscope.aliyuncs.com/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('alibaba-coding-plan-cn', 'https://coding.dashscope.aliyuncs.com/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('minimax-coding-plan', 'https://api.minimax.io/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('minimax-coding-plan-cn', 'https://api.minimaxi.com/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('zai-coding-plan', 'https://api.z.ai/api/coding/paas/v4'));
	registerProvider(wrapOpenAIProviderWithLiveModels('zhipuai-coding-plan', 'https://open.bigmodel.cn/api/paas/v4'));
	registerProvider(wrapOpenAIProviderWithLiveModels('kimi-coding-plan', 'https://api.kimi.com/coding/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('kimi-code', 'https://api.kimi.com/coding/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('minimax-code', 'https://api.minimax.io/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('minimax-code-cn', 'https://api.minimaxi.com/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('zhipu-coding-plan', 'https://open.bigmodel.cn/api/coding/paas/v4'));
	registerProvider(wrapOpenAIProviderWithLiveModels('opencode-zen', 'https://opencode.ai/zen/v1'));

	// Local OpenAI-compatible runtimes
	registerProvider(wrapOpenAIProviderWithLiveModels('ollama', envBaseUrl('OLLAMA_BASE_URL', 'http://127.0.0.1:11434/v1')));
	registerProvider(wrapOpenAIProviderWithLiveModels('lm-studio', envBaseUrl('LM_STUDIO_BASE_URL', 'http://127.0.0.1:1234/v1')));
	registerProvider(wrapOpenAIProviderWithLiveModels('llama-cpp', envBaseUrl('LLAMA_CPP_BASE_URL', 'http://127.0.0.1:8080/v1')));
	registerProvider(wrapOpenAIProviderWithLiveModels('vllm', envBaseUrl('VLLM_BASE_URL', 'http://127.0.0.1:8000/v1')));
	registerProvider(wrapOpenAIProviderWithLiveModels('sglang', envBaseUrl('SGLANG_BASE_URL', 'http://127.0.0.1:30000/v1')));
}

initProviders();
