import { registerProvider } from "../registry.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompletionsProvider } from "./openai-completions.js";
import { createOpenAIResponsesProvider } from "./openai-responses.js";

export function initProviders(): void {
  registerProvider(createAnthropicProvider());
  registerProvider(createOpenAICompletionsProvider());
  registerProvider(createOpenAIResponsesProvider());
}

initProviders();
