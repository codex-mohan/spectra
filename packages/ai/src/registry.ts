import type { Context, Model, StreamOptions } from "./types.js";
import { AssistantMessageEventStream } from "./event-stream.js";

export type StreamFunction = (
  model: Model,
  context: Context,
  options?: StreamOptions,
) => AssistantMessageEventStream;

export interface Provider {
  name: string;
  stream: StreamFunction;
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

export function stream(
  model: Model,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const provider = providers.get(model.provider);
  if (!provider) {
    throw new Error(`No provider registered for: ${model.provider}. Available: ${listProviders().join(", ")}`);
  }
  return provider.stream(model, context, options);
}

export async function complete(
  model: Model,
  context: Context,
  options?: StreamOptions,
): Promise<import("./types.js").AssistantMessage> {
  const s = stream(model, context, options);
  return s.result();
}
