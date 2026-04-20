import OpenAI from "openai";
import type {
  ResponseStreamEvent,
  ResponseCreatedEvent,
  ResponseOutputItemAddedEvent,
  ResponseReasoningTextDeltaEvent,
  ResponseTextDeltaEvent,
  ResponseFunctionCallArgumentsDeltaEvent,
  ResponseFunctionCallArgumentsDoneEvent,
  ResponseOutputItemDoneEvent,
  ResponseCompletedEvent,
  ResponseFailedEvent,
  ResponseErrorEvent,
} from "openai/resources/responses/responses.js";
import type {
  AssistantMessage,
  Context,
  Model,
  StreamOptions,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../event-stream.js";
import { sanitizeSurrogates, parseStreamingJson } from "./shared.js";

function getEnvApiKey(provider: string): string | undefined {
  const keys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    openaiCodex: process.env.OPENAI_API_KEY,
  };
  return keys[provider];
}

export interface OpenAIResponsesOptions extends StreamOptions {
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  reasoningSummary?: "auto" | "detailed" | "concise" | null;
}

export function createOpenAIResponsesProvider() {
  return {
    name: "openai-responses",
    stream(model: Model, context: Context, options?: OpenAIResponsesOptions): AssistantMessageEventStream {
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
          const apiKey = options?.apiKey ?? getEnvApiKey(model.provider);
          if (!apiKey) {
            throw new Error(`No API key for provider: ${model.provider}`);
          }

          const client = new OpenAI({
            apiKey,
            baseURL: model.baseUrl,
            dangerouslyAllowBrowser: true,
          });

          const messages = convertResponsesMessages(model, context);

          const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
            model: model.id,
            input: messages as OpenAI.Responses.ResponseInput,
            stream: true,
          };

          if (options?.maxTokens) {
            params.max_output_tokens = options.maxTokens;
          }

          if (options?.temperature !== undefined) {
            params.temperature = options.temperature;
          }

          if (model.reasoning && (options?.reasoningEffort || options?.reasoningSummary)) {
            params.reasoning = {
              effort: options.reasoningEffort || "medium",
              summary: options.reasoningSummary || "auto",
            };
            params.include = ["reasoning.encrypted_content"];
          }

          if (context.tools) {
            params.tools = context.tools.map((tool) => ({
              type: "function" as const,
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters as OpenAI.Responses.FunctionTool["parameters"],
              strict: false,
            }));
          }

          const openaiStream = await client.responses.create(params, { signal: options?.signal });
          stream.push({ type: "start", partial: output });

          let currentItemType: string | null = null;
          let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
          const blocks = output.content;
          const blockIndex = () => blocks.length - 1;

          for await (const event of openaiStream) {
            if (isResponseCreatedEvent(event)) {
              output.responseId = event.response?.id;
            } else if (isResponseOutputItemAddedEvent(event)) {
              const item = event.item;
              currentItemType = item.type;

              if (item.type === "reasoning") {
                currentBlock = { type: "thinking", thinking: "" };
                output.content.push(currentBlock);
                stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
              } else if (item.type === "message") {
                currentBlock = { type: "text", text: "" };
                output.content.push(currentBlock);
                stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
              } else if (item.type === "function_call") {
                currentBlock = {
                  type: "toolCall",
                  id: `${item.call_id || ""}|${item.id || ""}`,
                  name: item.name || "",
                  arguments: {},
                  partialJson: item.arguments || "",
                };
                output.content.push(currentBlock);
                stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
              }
            } else if (isResponseReasoningTextDeltaEvent(event)) {
              if (currentItemType === "reasoning" && currentBlock?.type === "thinking") {
                currentBlock.thinking += event.delta;
                stream.push({
                  type: "thinking_delta",
                  contentIndex: blockIndex(),
                  delta: event.delta,
                  partial: output,
                });
              }
            } else if (isResponseTextDeltaEvent(event)) {
              if (currentItemType === "message" && currentBlock?.type === "text") {
                currentBlock.text += event.delta;
                stream.push({
                  type: "text_delta",
                  contentIndex: blockIndex(),
                  delta: event.delta,
                  partial: output,
                });
              }
            } else if (isResponseFunctionCallArgumentsDeltaEvent(event)) {
              if (currentItemType === "function_call" && currentBlock?.type === "toolCall") {
                currentBlock.partialJson += event.delta;
                currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
                stream.push({
                  type: "toolcall_delta",
                  contentIndex: blockIndex(),
                  delta: event.delta,
                  partial: output,
                });
              }
            } else if (isResponseFunctionCallArgumentsDoneEvent(event)) {
              if (currentItemType === "function_call" && currentBlock?.type === "toolCall") {
                currentBlock.partialJson = event.arguments;
                currentBlock.arguments = parseStreamingJson(event.arguments);
              }
            } else if (isResponseOutputItemDoneEvent(event)) {
              const item = event.item;

              if (item.type === "reasoning" && currentBlock?.type === "thinking") {
                const summary = (item as unknown as { summary?: { text: string }[] }).summary;
                currentBlock.thinking = summary?.map((s) => s.text).join("\n\n") || "";
                stream.push({
                  type: "thinking_end",
                  contentIndex: blockIndex(),
                  content: currentBlock.thinking,
                  partial: output,
                });
                currentBlock = null;
                currentItemType = null;
              } else if (item.type === "message" && currentBlock?.type === "text") {
                stream.push({
                  type: "text_end",
                  contentIndex: blockIndex(),
                  content: currentBlock.text,
                  partial: output,
                });
                currentBlock = null;
                currentItemType = null;
              } else if (item.type === "function_call") {
                const toolCall: ToolCall = {
                  type: "toolCall",
                  id: `${item.call_id || ""}|${item.id || ""}`,
                  name: item.name || "",
                  arguments: parseStreamingJson(item.arguments || "{}"),
                };
                currentBlock = null;
                currentItemType = null;
                stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
              }
            } else if (isResponseCompletedEvent(event)) {
              const response = event.response;
              if (response?.id) {
                output.responseId = response.id;
              }
              if (response?.usage) {
                const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
                output.usage = {
                  input: (response.usage.input_tokens || 0) - cachedTokens,
                  output: response.usage.output_tokens || 0,
                  cacheRead: cachedTokens,
                  cacheWrite: 0,
                  totalTokens: response.usage.total_tokens || 0,
                };
              }
              output.stopReason = mapStopReason(response?.status);
              if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
                output.stopReason = "toolUse";
              }
            } else if (isResponseFailedEvent(event)) {
              throw new Error(event.response?.error?.message || "Response failed");
            } else if (isResponseErrorEvent(event)) {
              throw new Error(event.message || "Unknown error");
            }
          }

          if (options?.signal?.aborted) {
            throw new Error("Request was aborted");
          }

          stream.push({ type: "done", reason: output.stopReason, message: output });
          stream.end();
        } catch (error) {
          output.stopReason = options?.signal?.aborted ? "aborted" : "error";
          output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
          stream.push({ type: "error", reason: output.stopReason, error: output });
          stream.end();
        }
      };

      run();
      return stream;
    },
  };
}

function isResponseCreatedEvent(e: ResponseStreamEvent): e is ResponseCreatedEvent {
  return e.type === "response.created";
}
function isResponseOutputItemAddedEvent(e: ResponseStreamEvent): e is ResponseOutputItemAddedEvent {
  return e.type === "response.output_item.added";
}
function isResponseReasoningTextDeltaEvent(e: ResponseStreamEvent): e is ResponseReasoningTextDeltaEvent {
  return e.type === "response.reasoning_text.delta";
}
function isResponseTextDeltaEvent(e: ResponseStreamEvent): e is ResponseTextDeltaEvent {
  return e.type === "response.output_text.delta";
}
function isResponseFunctionCallArgumentsDeltaEvent(e: ResponseStreamEvent): e is ResponseFunctionCallArgumentsDeltaEvent {
  return e.type === "response.function_call_arguments.delta";
}
function isResponseFunctionCallArgumentsDoneEvent(e: ResponseStreamEvent): e is ResponseFunctionCallArgumentsDoneEvent {
  return e.type === "response.function_call_arguments.done";
}
function isResponseOutputItemDoneEvent(e: ResponseStreamEvent): e is ResponseOutputItemDoneEvent {
  return e.type === "response.output_item.done";
}
function isResponseCompletedEvent(e: ResponseStreamEvent): e is ResponseCompletedEvent {
  return e.type === "response.completed";
}
function isResponseFailedEvent(e: ResponseStreamEvent): e is ResponseFailedEvent {
  return e.type === "response.failed";
}
function isResponseErrorEvent(e: ResponseStreamEvent): e is ResponseErrorEvent {
  return e.type === "error";
}

function convertResponsesMessages(model: Model, context: Context): unknown[] {
  const messages: unknown[] = [];

  if (context.systemPrompt) {
    messages.push({
      role: model.reasoning ? "developer" : "system",
      content: sanitizeSurrogates(context.systemPrompt),
    });
  }

  for (const msg of context.messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        messages.push({
          role: "user",
          content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
        });
      } else {
        const content = msg.content.map((item) => {
          if (item.type === "text") {
            return { type: "input_text", text: sanitizeSurrogates(item.text) };
          }
          return {
            type: "input_image",
            image_url: `data:${item.mimeType};base64,${item.data}`,
          };
        });
        messages.push({ role: "user", content });
      }
    } else if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text") {
          messages.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: sanitizeSurrogates((block as TextContent).text) }],
          });
        } else if (block.type === "toolCall") {
          const tc = block as ToolCall;
          messages.push({
            type: "function_call",
            call_id: tc.id.split("|")[0] || tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          });
        }
      }
    } else if (msg.role === "toolResult") {
      const textResult = msg.content
        .filter((c) => c.type === "text")
        .map((c) => (c as TextContent).text)
        .join("\n");
      messages.push({
        type: "function_call_output",
        call_id: msg.toolCallId.split("|")[0] || msg.toolCallId,
        output: sanitizeSurrogates(textResult || "(no result)"),
      });
    }
  }

  return messages;
}

function mapStopReason(status: string | undefined): "stop" | "length" | "toolUse" | "error" | "aborted" {
  if (!status) return "stop";
  switch (status) {
    case "completed":
      return "stop";
    case "incomplete":
      return "length";
    case "failed":
    case "cancelled":
      return "error";
    default:
      return "stop";
  }
}
