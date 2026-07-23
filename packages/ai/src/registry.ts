import type { Context, Model, StreamOptions } from './types.js';
import { AssistantMessageEventStream } from './event-stream.js';

export type StreamFunction = (model: Model, context: Context, options?: StreamOptions) => AssistantMessageEventStream;

export interface ModelInfo {
	id: string;
	name: string;
	contextWindow?: number;
	supportsTools?: boolean;
	supportedInputs?: string[];
}

export interface DiscoveryContext {
	apiKey?: string;
	headers?: Record<string, string>;
	baseUrl?: string;
}

export interface DiscoveryResult {
	models: ModelInfo[];
	fetchedAt?: number;
}

export interface Provider {
	name: string;
	stream: StreamFunction;
	listModels?: () => ModelInfo[] | Promise<ModelInfo[]>;
	discoverModels?: (context: DiscoveryContext) => DiscoveryResult | Promise<DiscoveryResult>;
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

export async function discoverProviderModels(
	providerName: string,
	context: DiscoveryContext,
): Promise<DiscoveryResult | undefined> {
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
