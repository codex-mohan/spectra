export type StopReason = "end_turn" | "tool_calls" | "max_tokens" | "error" | "aborted";

export interface ContentDelta {
  type: "text" | "tool_call_start" | "tool_call_delta" | "tool_call_end";
  delta?: string;
  id?: string;
  name?: string;
  argsDelta?: string;
}

export type StreamEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; delta: ContentDelta }
  | { type: "message_end"; message: unknown }
  | { type: "turn_end"; toolResults: unknown[] }
  | { type: "tool_execution_start"; toolCall: unknown }
  | { type: "tool_execution_update"; partial: unknown }
  | { type: "tool_execution_end"; result: unknown; isError: boolean }
  | { type: "agent_end"; messages: unknown[] }
  | { type: "error"; message: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
