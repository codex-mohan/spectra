import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  MessageCreateParamsStreaming,
  TextBlockParam,
  ImageBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";
import type {
  AssistantMessage,
  Context,
  Message,
  Model,
  StreamOptions,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
} from "../types.js";
import { AssistantMessageEventStream } from "../event-stream.js";

type ContentBlockParam = TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam;
type StreamBlock = (ThinkingContent | TextContent | ToolCall) & { index?: number; partialJson?: string };

function getEnvApiKey(provider: string): string | undefined {
  const keys: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_KEY,
  };
  return keys[provider];
}

function sanitizeSurrogates(text: string): string {
  return text.replace(/[\u0080-\uFFFF]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

function toAnthropicMessage(message: Message): MessageParam {
  if (message.role === "user") {
    const content = typeof message.content === "string"
      ? sanitizeSurrogates(message.content)
      : message.content.map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: sanitizeSurrogates(block.text) };
        }
        if (block.type === "image") {
          return {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: block.data,
            },
          };
        }
        return { type: "text" as const, text: "" };
      });
    return { role: "user", content };
  }

  if (message.role === "assistant") {
    const content: ContentBlockParam[] = message.content.map((block) => {
      if (block.type === "text") {
        return { type: "text" as const, text: sanitizeSurrogates(block.text) };
      }
      if (block.type === "thinking") {
        return {
          type: "text" as const,
          text: sanitizeSurrogates(block.thinking),
        };
      }
      if (block.type === "toolCall") {
        let input: Record<string, unknown>;
        if (typeof block.arguments === "string") {
          try {
            input = JSON.parse(block.arguments);
          } catch {
            input = {};
          }
        } else {
          input = block.arguments;
        }
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input,
        };
      }
      return { type: "text" as const, text: "" };
    });
    return { role: "assistant", content };
  }

  if (message.role === "toolResult") {
    const content: ContentBlockParam[] = message.content.map((block) => {
      if (block.type === "text") {
        return {
          type: "tool_result" as const,
          tool_use_id: message.toolCallId,
          content: sanitizeSurrogates(block.text),
        };
      }
      if (block.type === "image") {
        return {
          type: "tool_result" as const,
          tool_use_id: message.toolCallId,
          content: [{
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: block.data,
            },
          }],
        };
      }
      return { type: "tool_result" as const, tool_use_id: message.toolCallId, content: "" };
    });
    return { role: "user", content };
  }

  return { role: "user", content: "" };
}

function toAnthropicTool(tool: Tool): {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[] };
} {
  const jsonSchema = tool.parameters as { properties?: Record<string, unknown>; required?: string[] };
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: jsonSchema.properties ?? {},
      required: jsonSchema.required ?? [],
    },
  };
}

function mapStopReason(reason: string): "stop" | "length" | "toolUse" | "error" | "aborted" {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "toolUse";
    case "refusal":
    case "sensitive":
      return "error";
    default:
      return "stop";
  }
}

export function createAnthropicProvider() {
  return {
    name: "anthropic",
    stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream {
      const stream = new AssistantMessageEventStream();

      const run = async () => {
        const apiKey = options?.apiKey ?? getEnvApiKey(model.provider);

        if (!apiKey) {
          const errorMsg: AssistantMessage = {
            role: "assistant",
            content: [],
            provider: model.provider,
            model: model.id,
            responseId: undefined,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
            stopReason: "error",
            errorMessage: "ANTHROPIC_API_KEY not set",
            timestamp: Date.now(),
          };
          stream.push({ type: "start", partial: errorMsg });
          stream.push({ type: "error", reason: "error", error: errorMsg });
          stream.end();
          return;
        }

        const client = new Anthropic({ apiKey });

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
          const messages: MessageParam[] = context.messages.map(toAnthropicMessage);
          const tools = context.tools?.map(toAnthropicTool) ?? [];

          const params: MessageCreateParamsStreaming = {
            model: model.id,
            max_tokens: options?.maxTokens ?? 4096,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            system: context.systemPrompt,
            temperature: options?.temperature,
            stream: true,
          };

          const anthropicStream = client.messages.stream(params, { signal: options?.signal });
          stream.push({ type: "start", partial: output });

          const blocks = output.content as StreamBlock[];

          for await (const event of anthropicStream) {
            if (event.type === "message_start") {
              output.responseId = event.message.id;
              output.usage.input = event.message.usage.input_tokens || 0;
              output.usage.output = event.message.usage.output_tokens || 0;
              output.usage.cacheRead = (event.message.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens || 0;
              output.usage.cacheWrite = (event.message.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens || 0;
              output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
            } else if (event.type === "content_block_start") {
              if (event.content_block.type === "text") {
                const block: StreamBlock = { type: "text", text: "", index: event.index };
                output.content.push(block);
                stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
              } else if (event.content_block.type === "tool_use") {
                const block: StreamBlock = { type: "toolCall", id: event.content_block.id, name: event.content_block.name, arguments: event.content_block.input as Record<string, unknown> ?? {}, partialJson: "", index: event.index };
                output.content.push(block);
                stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                const idx = blocks.findIndex((b) => b.index === event.index);
                const block = blocks[idx];
                if (block && block.type === "text") {
                  block.text += event.delta.text;
                  stream.push({ type: "text_delta", contentIndex: idx, delta: event.delta.text, partial: output });
                }
              } else if (event.delta.type === "input_json_delta") {
                const idx = blocks.findIndex((b) => b.index === event.index);
                const block = blocks[idx];
                if (block && block.type === "toolCall") {
                  block.partialJson = (block.partialJson ?? "") + event.delta.partial_json;
                  try {
                    block.arguments = JSON.parse(block.partialJson);
                  } catch {
                    // incomplete JSON, keep partial
                  }
                  stream.push({ type: "toolcall_delta", contentIndex: idx, delta: event.delta.partial_json, partial: output });
                }
              }
            } else if (event.type === "content_block_stop") {
              const idx = blocks.findIndex((b) => b.index === event.index);
              const block = blocks[idx];
              if (block) {
                delete block.index;
                if (block.type === "text") {
                  stream.push({ type: "text_end", contentIndex: idx, content: block.text, partial: output });
                } else if (block.type === "toolCall") {
                  try {
                    block.arguments = JSON.parse(block.partialJson ?? "");
                  } catch {
                    block.arguments = {};
                  }
                  delete block.partialJson;
                  stream.push({ type: "toolcall_end", contentIndex: idx, toolCall: block as ToolCall, partial: output });
                }
              }
            } else if (event.type === "message_delta") {
              if (event.delta.stop_reason) {
                output.stopReason = mapStopReason(event.delta.stop_reason);
              }
            }
          }

          if (options?.signal?.aborted) {
            throw new Error("Request aborted");
          }

          cleanupBlocks(blocks);

          stream.push({ type: "done", reason: output.stopReason, message: output });
          stream.end();
        } catch (error) {
          cleanupOutputContent(output);
          output.stopReason = options?.signal?.aborted ? "aborted" : "error";
          output.errorMessage = error instanceof Error ? error.message : String(error);
          stream.push({ type: "error", reason: output.stopReason, error: output });
          stream.end();
        }
      };

      run();

      return stream;
    },
  };
}

function cleanupBlocks(blocks: StreamBlock[]): void {
  for (const block of blocks) {
    delete block.index;
    delete block.partialJson;
  }
}

function cleanupOutputContent(output: AssistantMessage): void {
  for (const block of output.content) {
    delete (block as StreamBlock).index;
    delete (block as StreamBlock).partialJson;
  }
}
