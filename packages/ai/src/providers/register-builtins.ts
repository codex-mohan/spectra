import { registerProvider } from '../registry.js';
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAICompletionsProvider, type OpenAICompletionsOptions } from './openai-completions.js';
import { createOpenAIResponsesProvider } from './openai-responses.js';
import { createGroqProvider } from './groq.js';
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

export function initProviders(): void {
	registerProvider(createAnthropicProvider());
	registerProvider(createOpenAICompletionsProvider());
	registerProvider(createOpenAIResponsesProvider());
	registerProvider(createGroqProvider());
	registerProvider(createOpenRouterProvider());

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
}

initProviders();
