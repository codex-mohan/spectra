import type {
  Model,
  StreamOptions,
  Context,
  Message,
  AssistantMessage,
  ToolCall,
  ToolResultMessage,
} from "@spectra/ai";
import { stream, EventStream } from "@spectra/ai";
import type {
  AgentTool,
  ToolResult,
  ToolUpdateCallback,
  ToolExecutionMode,
  BeforeToolCallContext,
  AfterToolCallContext,
  AgentEvent,
  AgentEventListener,
  AgentConfig,
} from "./types.js";

type EmitFn = (event: AgentEvent) => void | Promise<void>;

interface PreparedToolCall {
  toolCall: ToolCall;
  tool: AgentTool | null;
  args: Record<string, unknown>;
  blocked: boolean;
  blockReason?: string;
}

class AgentEventStream extends EventStream<AgentEvent, Message[]> {
  constructor() {
    super(
      (event) => event.type === "agent_end",
      (event) => {
        if (event.type === "agent_end") {
          return event.messages;
        }
        return [];
      },
    );
  }
}

export class Agent {
  private tools = new Map<string, AgentTool>();
  private listeners: AgentEventListener[] = [];
  private abortController: AbortController | null = null;
  private _isStreaming = false;
  private _streamingMessage?: AssistantMessage;
  private _pendingToolCalls = new Set<string>();
  private _errorMessage?: string;
  private _messages: Message[] = [];

  private model: Model;
  private systemPrompt?: string;
  private maxTurns: number;
  private toolExecution: ToolExecutionMode;
  private beforeToolCallHook?: AgentConfig["beforeToolCall"];
  private afterToolCallHook?: AgentConfig["afterToolCall"];
  private transformContextFn?: AgentConfig["transformContext"];
  private getApiKeyFn?: AgentConfig["getApiKey"];
  private streamOptions?: StreamOptions;

  constructor(config: AgentConfig & { streamOptions?: StreamOptions }) {
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
    this.maxTurns = config.maxTurns ?? 10;
    this.toolExecution = config.toolExecution ?? "parallel";
    this.beforeToolCallHook = config.beforeToolCall;
    this.afterToolCallHook = config.afterToolCall;
    this.transformContextFn = config.transformContext;
    this.getApiKeyFn = config.getApiKey;
    this.streamOptions = config.streamOptions;
    for (const tool of config.tools ?? []) {
      this.tools.set(tool.name, tool);
    }
  }

  get messages(): Message[] { return [...this._messages]; }
  get isStreaming(): boolean { return this._isStreaming; }
  get streamingMessage(): AssistantMessage | undefined { return this._streamingMessage; }
  get pendingToolCalls(): ReadonlySet<string> { return this._pendingToolCalls; }
  get errorMessage(): string | undefined { return this._errorMessage; }
  get signal(): AbortSignal | undefined { return this.abortController?.signal; }

  registerTool(tool: AgentTool): void { this.tools.set(tool.name, tool); }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  abort(): void { this.abortController?.abort(); }

  reset(): void {
    this._messages = [];
    this._isStreaming = false;
    this._streamingMessage = undefined;
    this._pendingToolCalls = new Set();
    this._errorMessage = undefined;
  }

  async *run(input: string | Message | Message[]): AsyncGenerator<AgentEvent> {
    const agentStream = new AgentEventStream();
    const emit: EmitFn = async (event) => {
      agentStream.push(event);
      for (const listener of this.listeners) {
        await listener(event, this.abortController?.signal);
      }
      if (event.type === "agent_end") {
        agentStream.end(event.messages);
      }
    };

    const userMessages = this.normalizeInput(input);
    if (this._isStreaming) throw new Error("Agent is already processing a prompt");

    this.abortController = new AbortController();
    this._isStreaming = true;
    this._errorMessage = undefined;

    for (const msg of userMessages) {
      this._messages.push(msg);
    }

    try {
      await emit({ type: "agent_start" });
      for (const msg of userMessages) {
        await emit({ type: "message_start", message: msg });
        await emit({ type: "message_end", message: msg });
      }
      await emit({ type: "turn_start" });
      await this.runLoop(emit);
    } catch (err) {
      this._errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this._isStreaming = false;
      this._streamingMessage = undefined;
      this._pendingToolCalls = new Set();
      this.abortController = null;
    }

    for await (const event of agentStream) {
      yield event;
    }
  }

  private async runLoop(emit: EmitFn): Promise<void> {
    let turns = 0;

    while (turns < this.maxTurns && !this.abortController?.signal.aborted) {
      if (turns > 0) {
        await emit({ type: "turn_start" });
      }
      turns++;

      let ctxMessages = this._messages;
      if (this.transformContextFn) {
        ctxMessages = await this.transformContextFn(ctxMessages, this.abortController!.signal);
      }

      const resolvedApiKey = this.getApiKeyFn
        ? await this.getApiKeyFn(this.model.provider)
        : this.streamOptions?.apiKey;

      const context = this.buildContext(ctxMessages);
      const opts = { ...this.streamOptions, apiKey: resolvedApiKey, signal: this.abortController?.signal };

      let assistantMessage: AssistantMessage;
      try {
        assistantMessage = await this.streamAssistantResponse(context, opts, emit);
      } catch (err) {
        this._errorMessage = err instanceof Error ? err.message : String(err);
        const errorMsg = this.createErrorMessage(err);
        this._messages.push(errorMsg);
        await emit({ type: "message_start", message: errorMsg });
        await emit({ type: "message_end", message: errorMsg });
        await emit({ type: "agent_end", messages: this._messages });
        return;
      }

      // Note: streamAssistantResponse already manages adding the assistant message to _messages
      // and emits message_start/message_end events, so we don't duplicate here

      const toolCalls = assistantMessage.content.filter((c): c is ToolCall => c.type === "toolCall");

      if (toolCalls.length === 0) {
        await emit({ type: "turn_end", message: assistantMessage, toolResults: [] });
        await emit({ type: "agent_end", messages: this._messages });
        return;
      }

      const toolResults = this.toolExecution === "sequential"
        ? await this.executeToolCallsSequential(toolCalls, assistantMessage, emit)
        : await this.executeToolCallsParallel(toolCalls, assistantMessage, emit);

      await emit({ type: "turn_end", message: assistantMessage, toolResults });
    }

    await emit({ type: "agent_end", messages: this._messages });
  }

  private async streamAssistantResponse(
    context: Context,
    opts: StreamOptions,
    emit: EmitFn,
  ): Promise<AssistantMessage> {
    let partialMessage: AssistantMessage | null = null;
    let addedPartial = false;

    const eventStream = stream(this.model, context, opts);

    for await (const event of eventStream) {
      if (this.abortController?.signal.aborted) break;

      switch (event.type) {
        case "start":
          partialMessage = event.partial;
          this._streamingMessage = partialMessage;
          this._messages.push(partialMessage);
          addedPartial = true;
          await emit({ type: "message_start", message: { ...partialMessage } });
          break;

        case "text_start":
        case "text_delta":
        case "text_end":
        case "thinking_start":
        case "thinking_delta":
        case "thinking_end":
        case "toolcall_start":
        case "toolcall_delta":
        case "toolcall_end":
          if (partialMessage) {
            partialMessage = event.partial;
            this._messages[this._messages.length - 1] = partialMessage;
            this._streamingMessage = partialMessage;
            await emit({ type: "message_update", message: { ...partialMessage }, assistantMessageEvent: event });
          }
          break;

        case "done":
        case "error":
          const finalMessage = await eventStream.result();
          if (addedPartial) {
            this._messages[this._messages.length - 1] = finalMessage;
          } else {
            this._messages.push(finalMessage);
          }
          if (!addedPartial) {
            await emit({ type: "message_start", message: { ...finalMessage } });
          }
          await emit({ type: "message_end", message: finalMessage });
          this._streamingMessage = undefined;
          return finalMessage;
      }
    }

    const finalMessage = await eventStream.result();
    if (addedPartial) {
      this._messages[this._messages.length - 1] = finalMessage;
    } else {
      this._messages.push(finalMessage);
      await emit({ type: "message_start", message: { ...finalMessage } });
    }
    await emit({ type: "message_end", message: finalMessage });
    this._streamingMessage = undefined;
    return finalMessage;
  }

  private async executeToolCallsSequential(
    toolCalls: ToolCall[],
    assistantMessage: AssistantMessage,
    emit: EmitFn,
  ): Promise<ToolResultMessage[]> {
    const results: ToolResultMessage[] = [];
    for (const tc of toolCalls) {
      if (this.abortController?.signal.aborted) break;
      const result = await this.executeSingleToolCall(tc, assistantMessage, emit);
      results.push(result);
    }
    return results;
  }

  private async executeToolCallsParallel(
    toolCalls: ToolCall[],
    assistantMessage: AssistantMessage,
    emit: EmitFn,
  ): Promise<ToolResultMessage[]> {
    // Phase 1: Prepare all tool calls sequentially (validation + hooks)
    const prepared = await this.prepareToolCalls(toolCalls, assistantMessage, emit);
    
    // Phase 2: Execute all prepared tool calls in parallel
    const executed = await Promise.all(
      prepared.map((p) => this.executePreparedToolCall(p, assistantMessage, emit))
    );
    
    return executed;
  }

  private async prepareToolCalls(
    toolCalls: ToolCall[],
    assistantMessage: AssistantMessage,
    emit: EmitFn,
  ): Promise<PreparedToolCall[]> {
    const prepared: PreparedToolCall[] = [];
    
    for (const toolCall of toolCalls) {
      if (this.abortController?.signal.aborted) break;
      
      await emit({ type: "tool_execution_start", toolCallId: toolCall.id, toolName: toolCall.name, args: toolCall.arguments });
      this._pendingToolCalls.add(toolCall.id);

      const tool = this.tools.get(toolCall.name);
      if (!tool) {
        prepared.push({
          toolCall,
          tool: null,
          args: toolCall.arguments,
          blocked: true,
          blockReason: `Unknown tool "${toolCall.name}"`,
        });
        continue;
      }

      let args = toolCall.arguments;
      if (tool.prepareArguments) {
        try {
          args = tool.prepareArguments(args);
        } catch (err) {
          prepared.push({
            toolCall,
            tool: null,
            args,
            blocked: true,
            blockReason: `Argument validation failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }
      }

      if (this.beforeToolCallHook) {
        const result = await this.beforeToolCallHook(
          { assistantMessage, toolCall, args, context: this.buildContext() },
          this.abortController?.signal
        );
        if (result?.block) {
          prepared.push({
            toolCall,
            tool: null,
            args,
            blocked: true,
            blockReason: result.reason ?? "Tool call blocked",
          });
          continue;
        }
      }

      prepared.push({ toolCall, tool, args, blocked: false });
    }
    
    return prepared;
  }

  private async executePreparedToolCall(
    prepared: PreparedToolCall,
    assistantMessage: AssistantMessage,
    emit: EmitFn,
  ): Promise<ToolResultMessage> {
    const { toolCall, tool, args, blocked, blockReason } = prepared;
    
    if (blocked) {
      this._pendingToolCalls.delete(toolCall.id);
      return this.finalizeToolCall(
        toolCall,
        { content: [{ type: "text", text: blockReason ?? "Tool call blocked" }], isError: true },
        true,
        assistantMessage,
        emit
      );
    }

    let toolResult: ToolResult;
    try {
      const onUpdate: ToolUpdateCallback = (partial) => {
        for (const listener of this.listeners) {
          listener(
            {
              type: "tool_execution_update",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              args,
              partialResult: partial,
            },
            this.abortController?.signal
          );
        }
      };
      toolResult = await tool!.execute(toolCall.id, args, this.abortController?.signal, onUpdate);
    } catch (err) {
      toolResult = {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }

    this._pendingToolCalls.delete(toolCall.id);
    return this.finalizeToolCall(toolCall, toolResult, toolResult.isError ?? false, assistantMessage, emit);
  }

  private async executeSingleToolCall(
    toolCall: ToolCall,
    assistantMessage: AssistantMessage,
    emit: EmitFn,
  ): Promise<ToolResultMessage> {
    // Sequential path: prepare then execute immediately
    const [prepared] = await this.prepareToolCalls([toolCall], assistantMessage, emit);
    return this.executePreparedToolCall(prepared, assistantMessage, emit);
  }

  private async finalizeToolCall(
    toolCall: ToolCall,
    result: ToolResult,
    isError: boolean,
    assistantMessage: AssistantMessage,
    emit: EmitFn,
  ): Promise<ToolResultMessage> {
    if (this.afterToolCallHook) {
      const override = await this.afterToolCallHook(
        { assistantMessage, toolCall, args: toolCall.arguments, result, isError, context: this.buildContext() },
        this.abortController?.signal,
      );
      if (override) {
        if (override.content) result = { ...result, content: override.content };
        if (override.isError !== undefined) isError = override.isError;
      }
    }

    const msg: ToolResultMessage = { role: "toolResult", toolCallId: toolCall.id, toolName: toolCall.name, content: result.content, isError, timestamp: Date.now() };
    this._messages.push(msg);

    // Emit message events so consumers can track tool results in the transcript
    await emit({ type: "message_start", message: msg });
    await emit({ type: "message_end", message: msg });

    await emit({ type: "tool_execution_end", toolCallId: toolCall.id, toolName: toolCall.name, result, isError });

    return msg;
  }

  private buildContext(messages?: Message[]): Context {
    const toolDefs = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    return {
      systemPrompt: this.systemPrompt,
      messages: messages ?? this._messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    };
  }

  private createErrorMessage(err: unknown): AssistantMessage {
    return {
      role: "assistant",
      content: [],
      provider: this.model.provider,
      model: this.model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    };
  }

  private normalizeInput(input: string | Message | Message[]): Message[] {
    if (Array.isArray(input)) {
      return input.map((m) => typeof m === "string" ? { role: "user" as const, content: m, timestamp: Date.now() } : m);
    }
    if (typeof input === "string") {
      return [{ role: "user", content: input, timestamp: Date.now() }];
    }
    return [input];
  }
}
