import { registerProvider } from '../registry.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAICompletionsProvider, type OpenAICompletionsOptions } from './openai-completions.js';
import { createOpenAIResponsesProvider } from './openai-responses.js';
import { createOpenRouterProvider } from './openrouter.js';
import type { Model, Context } from '../types.js';
import type { Provider } from '../registry.js';
import { AssistantMessageEventStream } from '../event-stream.js';

function wrapOpenAIProvider(name: string, baseUrl: string): Provider {
	const inner = createOpenAICompletionsProvider();
	return {
		name,
		listModels: () => import('../models.js').then((m) => m.getProviderModels(name)),
		stream(model: Model, context: Context, options?: OpenAICompletionsOptions): AssistantMessageEventStream {
			return inner.stream({ ...model, baseUrl: model.baseUrl || baseUrl }, context, options);
		},
	};
}

async function fetchLiveModels(baseUrl: string): Promise<{ id: string; name: string }[]> {
	try {
		const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return [];
		const json = await res.json();
		const list = (json.data || []) as Record<string, unknown>[];
		return list
			.map((m) => ({ id: m.id as string, name: (m.name as string) || (m.id as string) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

function wrapOpenAIProviderWithLiveModels(name: string, baseUrl: string): Provider {
	const inner = createOpenAICompletionsProvider();
	return {
		name,
		listModels: async () => {
			const live = await fetchLiveModels(baseUrl);
			if (live.length > 0) return live;
			const { getProviderModels } = await import('../models.js');
			return getProviderModels(name).map((m) => ({ id: m.id, name: m.name }));
		},
		stream(model: Model, context: Context, options?: OpenAICompletionsOptions): AssistantMessageEventStream {
			return inner.stream({ ...model, baseUrl: model.baseUrl || baseUrl }, context, options);
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

	// Coding plan providers
	registerProvider(wrapOpenAIProviderWithLiveModels('opencode-go', 'https://opencode.ai/zen/go/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('alibaba-coding-plan', 'https://coding-intl.dashscope.aliyuncs.com/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('alibaba-coding-plan-cn', 'https://coding.dashscope.aliyuncs.com/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('minimax-coding-plan', 'https://api.minimax.io/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('minimax-coding-plan-cn', 'https://api.minimaxi.com/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('zai-coding-plan', 'https://api.z.ai/api/coding/paas/v4'));
	registerProvider(wrapOpenAIProviderWithLiveModels('zhipuai-coding-plan', 'https://open.bigmodel.cn/api/paas/v4'));
	registerProvider(wrapOpenAIProviderWithLiveModels('kimi-coding-plan', 'https://api.kimi.com/coding/v1'));
	registerProvider(wrapOpenAIProviderWithLiveModels('opencode-zen', 'https://opencode.ai/zen/v1'));
}

initProviders();
