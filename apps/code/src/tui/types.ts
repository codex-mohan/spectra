export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "toolResult";
  content: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  timestamp: number;
  isStreaming?: boolean;
  details?: Record<string, unknown>;
}

export interface SessionMetrics {
  modelId: string;
  modelName: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  tokensUsed: number;
  tokensTotal: number;
  costUsd: number;
  durationMs: number;
  tokensPerSecond: number;
  status: "idle" | "streaming" | "tool_call" | "thinking" | "error";
  turnCount: number;
}

export interface AppTheme {
  // Message borders
  userBorder: (s: string) => string;
  userLabel: (s: string) => string;
  assistantBorder: (s: string) => string;
  assistantLabel: (s: string) => string;
  toolBorder: (s: string) => string;
  toolLabel: (s: string) => string;
  toolResultBorder: (s: string) => string;
  toolResultLabel: (s: string) => string;
  errorBorder: (s: string) => string;
  errorLabel: (s: string) => string;

  // Metrics / status bar
  metricsLine: (s: string) => string;
  metricsSeparator: (s: string) => string;
  metricsKey: (s: string) => string;
  metricsValue: (s: string) => string;
  metricsAccent: (s: string) => string;

  // Prompt
  promptBorder: (s: string) => string;
  promptSymbol: (s: string) => string;
  promptHint: (s: string) => string;
  promptModelInfo: (s: string) => string;
  promptKeybind: (s: string) => string;

  // Status bar (oh-my-zsh style)
  statusBg: (s: string) => string;
  statusAccent: (s: string) => string;
  statusDim: (s: string) => string;
  statusSuccess: (s: string) => string;
  statusWarn: (s: string) => string;
  statusError: (s: string) => string;
  statusTps: (s: string) => string;

  // Code
  codeBlock: (s: string) => string;
  spinner: string[];
}