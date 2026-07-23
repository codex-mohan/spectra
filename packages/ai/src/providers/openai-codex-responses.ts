import { createOpenAIResponsesProvider } from './openai-responses.js';
import type { OpenAIResponsesProviderConfig } from './openai-responses.js';
import type { DiscoveryContext, DiscoveryResult, ModelInfo } from '../registry.js';

/** ChatGPT subscription backend used by the Codex Responses transport. */
export const OPENAI_CODEX_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const SPECTRA_CODEX_CLIENT_VERSION = '0.6.1';

interface CodexModelPayload {
	slug?: unknown;
	display_name?: unknown;
	visibility?: unknown;
	supported_in_api?: unknown;
	context_window?: unknown;
	input_modalities?: unknown;
}

interface AvailableCodexModel extends CodexModelPayload {
	slug: string;
	visibility: 'list';
	supported_in_api: true;
}

function isAvailableCodexModel(model: unknown): model is AvailableCodexModel {
	if (model === null || typeof model !== 'object') return false;
	const candidate = model as CodexModelPayload;
	return typeof candidate.slug === 'string'
		&& candidate.slug.length > 0
		&& candidate.supported_in_api === true
		&& candidate.visibility === 'list';
}

export function parseOpenAICodexModels(payload: unknown): ModelInfo[] {
	if (payload === null || typeof payload !== 'object' || !Array.isArray((payload as { models?: unknown }).models)) {
		throw new Error('Codex model discovery returned an invalid response');
	}
	return ((payload as { models: unknown[] }).models)
		.filter(isAvailableCodexModel)
		.map((model) => ({
			id: model.slug,
			name: typeof model.display_name === 'string' && model.display_name.length > 0
				? model.display_name
				: model.slug,
			contextWindow: typeof model.context_window === 'number' ? model.context_window : undefined,
			supportedInputs: Array.isArray(model.input_modalities)
				? model.input_modalities.filter((input): input is string => typeof input === 'string')
				: undefined,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverOpenAICodexModels(context: DiscoveryContext): Promise<DiscoveryResult> {
	if (!context.apiKey) throw new Error('Codex model discovery requires an OAuth access token');
	const baseUrl = (context.baseUrl || OPENAI_CODEX_RESPONSES_BASE_URL).replace(/\/+$/, '');
	const url = new URL(`${baseUrl}/models`);
	url.searchParams.set('client_version', SPECTRA_CODEX_CLIENT_VERSION);
	const response = await fetch(url, {
		headers: {
			...context.headers,
			Authorization: `Bearer ${context.apiKey}`,
		},
		signal: AbortSignal.timeout(5000),
	});
	if (!response.ok) throw new Error(`Codex model discovery failed: ${response.status}`);
	return { models: parseOpenAICodexModels(await response.json()), fetchedAt: Date.now() };
}


export const OPENAI_CODEX_PROVIDER_CONFIG: OpenAIResponsesProviderConfig = {
	name: 'openai-codex',
	modelProvider: 'openai-codex',
	baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
};

/**
 * OAuth access is supplied through StreamOptions.apiKey. Account identity is
 * supplied through StreamOptions.headers as ChatGPT-Account-Id and is forwarded
 * by the shared Responses transport.
 */
export function createOpenAICodexResponsesProvider() {
	return {
		...createOpenAIResponsesProvider(OPENAI_CODEX_PROVIDER_CONFIG),
		discoverModels: discoverOpenAICodexModels,
	};
}
