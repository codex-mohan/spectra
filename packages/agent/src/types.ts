import type {
  Message,
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
  ToolResultMessage,
  TextContent,
  ImageContent,
  Model,
  Context,
} from "@spectra/ai";

export type { Context } from "@spectra/ai";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  prepareArguments?: (args: unknown) => Record<string, unknown>;
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
  ) => Promise<ToolResult>;
}

export interface ToolResult {
  content: (TextContent | ImageContent)[];
  isError?: boolean;
}

export type ToolUpdateCallback = (partial: ToolResult) => void;

export type ToolExecutionMode = "sequential" | "parallel";

export interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: ToolCall;
  args: Record<string, unknown>;
  context: Context;
}

export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: ToolCall;
  args: Record<string, unknown>;
  result: ToolResult;
  isError: boolean;
  context: Context;
}

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  isError?: boolean;
}

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: Message[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: Message }
  | { type: "message_update"; message: AssistantMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: Message }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: ToolResult }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: ToolResult; isError: boolean };

export type AgentEventListener = (event: AgentEvent, signal?: AbortSignal) => Promise<void> | void;

export interface AgentState {
  systemPrompt?: string;
  model: Model;
  messages: Message[];
  isStreaming: boolean;
  streamingMessage?: AssistantMessage;
  pendingToolCalls: ReadonlySet<string>;
  errorMessage?: string;
}

export interface AgentConfig {
  model: Model;
  systemPrompt?: string;
  tools?: AgentTool[];
  toolExecution?: ToolExecutionMode;
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
  transformContext?: (messages: Message[], signal?: AbortSignal) => Promise<Message[]>;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
}
