import OpenAI from "openai";
import type {
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
} from "../types.js";
import { AssistantMessageEventStream } from "../event-stream.js";
import { sanitizeSurrogates, parseStreamingJson } from "./shared.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function getEnvApiKey(): string | undefined {
  return process.env.GROQ_API_KEY;
}

export interface GroqOptions extends StreamOptions {
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
}

export function createGroqProvider() {
  return {
    name: "groq",
    stream(model: Model, context: Context, options?: GroqOptions): AssistantMessageEventStream {
      const stream = new AssistantMessageEventStream();

      const run = async () => {
        const output: AssistantMessage = {
          role: "assistant",
          content: [],
          provider: model.provider,
          model: model.id,
          responseId: undefined,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: "stop",
          timestamp: Date.now(),
        };

        try {
          const apiKey = options?.apiKey ?? getEnvApiKey();
          if (!apiKey) {
            output.stopReason = "error";
            output.errorMessage = `No API key for Groq. Set GROQ_API_KEY environment variable or pass apiKey in options.`;
            stream.push({ type: "start", partial: output });
            stream.push({ type: "error", reason: "error", error: output });
            stream.end();
            return;
          }

          const client = new OpenAI({
            apiKey,
            baseURL: GROQ_BASE_URL,
            dangerouslyAllowBrowser: true,
          });

          const messages = convertMessages(context);

          const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
            model: model.id,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          };

          if (options?.maxTokens) {
            params.max_tokens = options.maxTokens;
          }
          if (options?.temperature !== undefined) {
            params.temperature = options.temperature;
          }

          const tools = context.tools?.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }));

          if (tools && tools.length > 0) {
            params.tools = tools;
          }

          if (options?.toolChoice) {
            params.tool_choice = options.toolChoice;
          }

          const response = await client.chat.completions.create(params);

          const toolCallFragments: Record<number, { id: string; name: string; args: string }> = {};

          for await (const chunk of response) {
            if (options?.signal?.aborted) break;

            const delta = chunk.choices[0]?.delta;
            const finishReason = chunk.choices[0]?.finish_reason;

            if (chunk.usage) {
              output.usage = {
                input: chunk.usage.prompt_tokens ?? 0,
                output: chunk.usage.completion_tokens ?? 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: chunk.usage.total_tokens ?? 0,
              };
            }

            // Handle tool calls
            if (delta?.tool_calls && delta.tool_calls.length > 0) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                if (!toolCallFragments[index]) {
                  toolCallFragments[index] = { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" };
                }
                if (tc.function?.arguments) {
                  toolCallFragments[index].args += tc.function.arguments;
                }
                if (tc.id) toolCallFragments[index].id = tc.id;
                if (tc.function?.name) toolCallFragments[index].name = tc.function.name;
              }
            }

            // Handle content
            if (delta?.content) {
              const text = sanitizeSurrogates(delta.content);
              stream.push({
                type: "text_delta",
                contentIndex: 0,
                delta: text,
                partial: output,
              });
            }

            // Handle stop reason
            if (finishReason) {
              output.stopReason = finishReason === "tool_calls" ? "toolUse" : "stop";
            }
          }

          // Assemble tool calls
          const assembledToolCalls = Object.values(toolCallFragments).map((tc) => ({
            type: "toolCall" as const,
            id: tc.id,
            name: tc.name,
            arguments: parseStreamingJson(tc.args),
          }));

          if (assembledToolCalls.length > 0) {
            output.content = assembledToolCalls;
            output.stopReason = "toolUse";
          }

          stream.push({ type: "done", reason: output.stopReason, message: output });
          stream.end();
        } catch (err) {
          output.stopReason = options?.signal?.aborted ? "aborted" : "error";
          output.errorMessage = err instanceof Error ? err.message : String(err);
          stream.push({ type: "error", reason: output.stopReason, error: output });
          stream.end();
        }
      };

      run();
      return stream;
    },
  };
}

function convertMessages(context: Context): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (context.systemPrompt) {
    messages.push({ role: "system", content: context.systemPrompt });
  }

  for (const msg of context.messages) {
    switch (msg.role) {
      case "user":
        messages.push({
          role: "user",
          content: typeof msg.content === "string" ? msg.content : msg.content.map((c) => {
            if (c.type === "text") return c.text;
            return "";
          }).join(""),
        });
        break;
      case "assistant":
        if (msg.content.some((c) => c.type === "toolCall")) {
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: msg.content
              .filter((c): c is { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> } => c.type === "toolCall")
              .map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.arguments),
                },
              })),
          });
        } else {
          messages.push({
            role: "assistant",
            content: msg.content.map((c) => {
              if (c.type === "text") return c.text;
              return "";
            }).join(""),
          });
        }
        break;
      case "toolResult":
        messages.push({
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        });
        break;
    }
  }

  return messages;
}
