import type {
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
} from "@singularity-ai/spectra-agent";
import type { Message } from "@singularity-ai/spectra-ai";
import type { ExtensionApi, ExtensionLogger } from "./types.js";
import type { EventBus } from "./event-bus.js";

export class ExtensionApiImpl implements ExtensionApi {
  readonly id: string;
  readonly name: string;
  readonly version: string;

  private tools = new Map<string, AgentTool>();
  private beforeToolCallHooks: Array<(context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>> = [];
  private afterToolCallHooks: Array<(context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>> = [];
  private transformContextHooks: Array<(messages: Message[], signal?: AbortSignal) => Promise<Message[]>> = [];
  private bus: EventBus;
  private logger: ExtensionLogger;

  constructor(id: string, name: string, version: string, bus: EventBus, logger: ExtensionLogger) {
    this.id = id;
    this.name = name;
    this.version = version;
    this.bus = bus;
    this.logger = logger;
  }

  registerTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  unregisterTool(name: string): void {
    this.tools.delete(name);
  }

  onBeforeToolCall(hook: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>): void {
    this.beforeToolCallHooks.push(hook);
  }

  onAfterToolCall(hook: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>): void {
    this.afterToolCallHooks.push(hook);
  }

  onTransformContext(hook: (messages: Message[], signal?: AbortSignal) => Promise<Message[]>): void {
    this.transformContextHooks.push(hook);
  }

  onEvent(eventType: string, listener: (data: unknown) => void): void {
    this.bus.on(eventType, listener);
  }

  offEvent(eventType: string, listener: (data: unknown) => void): void {
    this.bus.off(eventType, listener);
  }

  emitEvent(eventType: string, data: unknown): void {
    this.bus.emit(eventType, data);
  }

  getLogger(): ExtensionLogger {
    return this.logger;
  }

  getTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  getBeforeToolCallHooks() {
    return this.beforeToolCallHooks;
  }

  getAfterToolCallHooks() {
    return this.afterToolCallHooks;
  }

  getTransformContextHooks() {
    return this.transformContextHooks;
  }
}