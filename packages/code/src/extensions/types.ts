import type { AgentTool, BeforeToolCallContext, AfterToolCallContext, BeforeToolCallResult, AfterToolCallResult, AgentEventListener } from "@singularity-ai/spectra-agent";
import type { Message } from "@singularity-ai/spectra-ai";

export type ExtensionHook<TArgs = unknown, TResult = unknown> = (
  args: TArgs,
) => Promise<TResult> | TResult;

export interface ExtensionApi {
  readonly id: string;
  readonly name: string;
  readonly version: string;

  registerTool(tool: AgentTool): void;
  unregisterTool(name: string): void;

  onBeforeToolCall(hook: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>): void;
  onAfterToolCall(hook: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>): void;
  onTransformContext(hook: (messages: Message[], signal?: AbortSignal) => Promise<Message[]>): void;

  onEvent(eventType: string, listener: ExtensionEventListener): void;
  offEvent(eventType: string, listener: ExtensionEventListener): void;
  emitEvent(eventType: string, data: unknown): void;

  getLogger(): ExtensionLogger;
}

export interface ExtensionLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export type ExtensionEventListener = (data: unknown) => void;

export interface Extension {
  name: string;
  version?: string;
  activate(api: ExtensionApi): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export interface ResolvedExtension {
  id: string;
  name: string;
  version: string;
  filePath: string;
  extension: Extension;
}