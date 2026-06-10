import type { Model, Context } from '../types.js';
import { AssistantMessageEventStream } from '../event-stream.js';
import { createOpenAICompletionsProvider, type OpenAICompletionsOptions } from './openai-completions.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

async function fetchLiveModels(): Promise<{ id: string; name: string }[]> {
	try {
		const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
			signal: AbortSignal.timeout(5000),
		});
		const json = await res.json();
		const list = json.data || [];
		return list
			.filter((m: Record<string, unknown>) => (m.supported_parameters as string[])?.includes('tools'))
			.map((m: Record<string, unknown>) => ({
				id: m.id as string,
				name: (m.name as string) || (m.id as string),
			}))
			.sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

export function createOpenRouterProvider() {
	const openaiProvider = createOpenAICompletionsProvider();
	return {
		name: 'openrouter' as const,
		listModels: async () => {
			const live = await fetchLiveModels();
			if (live.length > 0) return live.map((m) => ({ id: m.id, name: m.name }));
			const { getProviderModels } = await import('../models.js');
			return getProviderModels('openrouter').map((m) => ({ id: m.id, name: m.name }));
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
