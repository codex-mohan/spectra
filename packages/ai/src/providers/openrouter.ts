import type { Model, Context } from '../types.js';
import type { DiscoveryContext, DiscoveryOutcome } from '../registry.js';
import { AssistantMessageEventStream } from '../event-stream.js';
import { createOpenAICompletionsProvider, type OpenAICompletionsOptions } from './openai-completions.js';
import { getProviderModels } from '../models.js';
import { normalizeModelRows } from '../discovery/shared.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export function createOpenRouterProvider() {
	const openaiProvider = createOpenAICompletionsProvider();

	return {
		name: 'openrouter' as const,
		listModels: async () => {
			return getProviderModels('openrouter').map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
		},
		async discoverModels(context: DiscoveryContext): Promise<DiscoveryOutcome> {
			const headers: Record<string, string> = { ...context.headers };
			if (context.apiKey) {
				headers['Authorization'] = `Bearer ${context.apiKey}`;
			}
			const baseUrl = context.baseUrl || OPENROUTER_BASE_URL;
			const url = `${baseUrl}/models`;
			let res: Response;
			try {
				res = await fetch(url, { signal: AbortSignal.timeout(5000), headers });
			} catch (error) {
				return { models: [], error: { message: error instanceof Error ? error.message : String(error) } };
			}
			if (!res.ok) return { models: [], error: { message: `HTTP ${res.status} from ${url}`, status: res.status } };
			try {
				return { models: normalizeModelRows(await res.json()), fetchedAt: Date.now() };
			} catch (error) {
				return { models: [], error: { message: error instanceof Error ? error.message : String(error) } };
			}
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
