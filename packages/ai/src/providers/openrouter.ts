import type { Model, Context } from '../types.js';
import type { DiscoveryContext, DiscoveryResult, ModelInfo } from '../registry.js';
import { AssistantMessageEventStream } from '../event-stream.js';
import { createOpenAICompletionsProvider, type OpenAICompletionsOptions } from './openai-completions.js';
import { getProviderModels } from '../models.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

interface OpenRouterApiModel {
	id: string;
	name: string;
	context_length?: number;
	supported_parameters?: string[];
	supported_inputs?: string[];
}

function mapApiModel(m: OpenRouterApiModel): ModelInfo {
	return {
		id: m.id,
		name: m.name || m.id,
		contextWindow: m.context_length,
		supportsTools: m.supported_parameters?.includes('tools'),
		supportedInputs: m.supported_inputs,
	};
}

export function createOpenRouterProvider() {
	const openaiProvider = createOpenAICompletionsProvider();

	return {
		name: 'openrouter' as const,
		listModels: async (): Promise<ModelInfo[]> => {
			return getProviderModels('openrouter').map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
		},
		async discoverModels(context: DiscoveryContext): Promise<DiscoveryResult> {
			const headers: Record<string, string> = { ...context.headers };
			if (context.apiKey) {
				headers['Authorization'] = `Bearer ${context.apiKey}`;
			}
			const baseUrl = context.baseUrl || OPENROUTER_BASE_URL;

			const res = await fetch(`${baseUrl}/models`, {
				signal: AbortSignal.timeout(5000),
				headers,
			});
			if (!res.ok) throw new Error(`Model discovery failed: ${res.status}`);
			const json = await res.json();
			const list = (json.data || []) as OpenRouterApiModel[];
			const models = list
				.map(mapApiModel)
				.sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name));
			return { models, fetchedAt: Date.now() };
		},
		stream(model: Model, context: Context, options?: OpenAICompletionsOptions): AssistantMessageEventStream {
			const modelWithDefaults = {
				...model,
				baseUrl: model.baseUrl || OPENROUTER_BASE_URL,
			};
			return openaiProvider.stream(modelWithDefaults, context, options);
		},
	};
}
