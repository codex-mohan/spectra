import { registerProvider } from "../registry.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompletionsProvider } from "./openai-completions.js";
import { createOpenAIResponsesProvider } from "./openai-responses.js";
import { createGroqProvider } from "./groq.js";
import { createOpenRouterProvider } from "./openrouter.js";

export function initProviders(): void {
  registerProvider(createAnthropicProvider());
  registerProvider(createOpenAICompletionsProvider());
  registerProvider(createOpenAIResponsesProvider());
  registerProvider(createGroqProvider());
  registerProvider(createOpenRouterProvider());
}

initProviders();
