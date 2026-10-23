import type { Context, Model, ModelCost, StreamOptions } from './types.js';
import { AssistantMessageEventStream } from './event-stream.js';

export type StreamFunction = (model: Model, context: Context, options?: StreamOptions) => AssistantMessageEventStream;

export interface ModelInfo {
	id: string;
	name: string;
	api?: string;
	baseUrl?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	supportsTools?: boolean;
	supportedInputs?: string[];
	cost?: ModelCost;
}

export interface DiscoveryContext {
	apiKey?: string;
	headers?: Record<string, string>;
	baseUrl?: string;
}

export interface DiscoveryError {
	message: string;
	/** HTTP status when the endpoint answered; absent for transport or parse failures. */
	status?: number;
}

export interface DiscoveryResult {
	models: ModelInfo[];
	fetchedAt: number;
}

export interface DiscoveryFailure {
	models: [];
	error: DiscoveryError;
}

/**
 * A discovery attempt either produced a roster or failed.
 *
 * A successful result with an empty `models` array means the provider
 * authoritatively lists nothing right now; a failure means the roster is
 * unknown and the caller must keep its previous/bundled rows.
 */
export type DiscoveryOutcome = DiscoveryResult | DiscoveryFailure;

export function isDiscoveryFailure(outcome: DiscoveryOutcome): outcome is DiscoveryFailure {
	return 'error' in outcome;
}

export function isDiscoveryAuthRejection(outcome: DiscoveryOutcome): boolean {
	return isDiscoveryFailure(outcome) && (outcome.error.status === 401 || outcome.error.status === 403);
}

export interface Provider {
	name: string;
	stream: StreamFunction;
	listModels?: () => ModelInfo[] | Promise<ModelInfo[]>;
	discoverModels?: (context: DiscoveryContext) => DiscoveryOutcome | Promise<DiscoveryOutcome>;
	/** MIME types this provider can handle in user messages. Undefined = text only. */
	supportedMediaTypes?: string[];
}

const providers = new Map<string, Provider>();

export function registerProvider(provider: Provider): void {
	providers.set(provider.name, provider);
}

export function getProvider(name: string): Provider | undefined {
	return providers.get(name);
}

export function listProviders(): string[] {
	return Array.from(providers.keys());
}

export async function getModels(providerName: string): Promise<ModelInfo[]> {
	const provider = providers.get(providerName);
	if (!provider?.listModels) return [];
	return provider.listModels();
}

/** `undefined` means the provider has no discovery implementation at all. */
export async function discoverProviderModels(
	providerName: string,
	context: DiscoveryContext,
): Promise<DiscoveryOutcome | undefined> {
	const provider = providers.get(providerName);
	if (!provider?.discoverModels) return undefined;
	return provider.discoverModels(context);
}

export function stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
	const provider = providers.get(model.provider);
	if (!provider) {
		throw new Error(`No provider registered for: ${model.provider}. Available: ${listProviders().join(', ')}`);
	}
	return provider.stream(model, context, options);
}

export async function complete(
	model: Model,
	context: Context,
	options?: StreamOptions,
): Promise<import('./types.js').AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}
