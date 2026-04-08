export type Provider = "anthropic" | "openai" | "groq" | string;

export interface ModelConfig {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface Model {
  provider: Provider;
  id: string;
  config: ModelConfig;
}

export function getModel(
  provider: Provider,
  id: string,
  config: ModelConfig = {}
): Model {
  return { provider, id, config };
}

export function anthropic(id: string, config?: ModelConfig): Model {
  return getModel("anthropic", id, config);
}

export function openai(id: string, config?: ModelConfig): Model {
  return getModel("openai", id, config);
}
