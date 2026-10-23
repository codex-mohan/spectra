import { createOpenAIResponsesProvider } from './openai-responses.js';
import type { OpenAIResponsesProviderConfig } from './openai-responses.js';
import type { DiscoveryContext, DiscoveryOutcome, ModelInfo } from '../registry.js';

/** ChatGPT subscription backend used by the Codex Responses transport. */
export const OPENAI_CODEX_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex';

/**
 * Pinned Codex client version, mirroring `@openai/codex`.
 *
 * The backend version-gates the model list by this value: discovery without
 * `client_version` is rejected with 400, and an older pin silently hides newer
 * SKUs (GPT-6.1 Sol is absent at 0.155.1 and listed at 0.159.0). Keep it in
 * step with the Codex CLI when models go missing after a release.
 */
export const CODEX_CLIENT_VERSION = '0.159.0';

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

async function discoverOpenAICodexModels(context: DiscoveryContext): Promise<DiscoveryOutcome> {
	if (!context.apiKey) {
		return { models: [], error: { message: 'Codex model discovery requires an OAuth access token', status: 401 } };
	}
	const baseUrl = (context.baseUrl || OPENAI_CODEX_RESPONSES_BASE_URL).replace(/\/+$/, '');
	const url = new URL(`${baseUrl}/models`);
	url.searchParams.set('client_version', CODEX_CLIENT_VERSION);
	let response: Response;
	try {
		response = await fetch(url, {
			headers: {
				...context.headers,
				Authorization: `Bearer ${context.apiKey}`,
				version: CODEX_CLIENT_VERSION,
			},
			signal: AbortSignal.timeout(5000),
		});
	} catch (error) {
		return { models: [], error: { message: error instanceof Error ? error.message : String(error) } };
	}
	if (!response.ok) {
		return { models: [], error: { message: `HTTP ${response.status} from ${url}`, status: response.status } };
	}
	try {
		return { models: parseOpenAICodexModels(await response.json()), fetchedAt: Date.now() };
	} catch (error) {
		return { models: [], error: { message: error instanceof Error ? error.message : String(error) } };
	}
}


export const OPENAI_CODEX_PROVIDER_CONFIG: OpenAIResponsesProviderConfig = {
	name: 'openai-codex',
	modelProvider: 'openai-codex',
	baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
	defaultHeaders: {
		'OpenAI-Beta': 'responses=experimental',
		originator: 'spectra',
	},
	codexProtocol: true,
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
