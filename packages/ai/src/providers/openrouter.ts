import type { Model, Context } from "../types.js";
import { AssistantMessageEventStream } from "../event-stream.js";
import {
  createOpenAICompletionsProvider,
  type OpenAICompletionsOptions,
} from "./openai-completions.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function createOpenRouterProvider() {
  const openaiProvider = createOpenAICompletionsProvider();
  return {
    name: "openrouter" as const,
    stream(model: Model, context: Context, options?: OpenAICompletionsOptions): AssistantMessageEventStream {
      const modelWithDefaults = {
        ...model,
        baseUrl: model.baseUrl || OPENROUTER_BASE_URL,
      };
      return openaiProvider.stream(modelWithDefaults, context, options);
    },
  };
}
