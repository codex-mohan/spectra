import { TUI, ProcessTerminal, getTheme, CommandPalette, matchesKey, type OverlayHandle, type CommandPaletteItem } from "@singularity-ai/spectra-tui";
import { Agent, type AgentEvent, type AgentConfig } from "@singularity-ai/spectra-agent";
import { createAllTools, loadConfig, discoverConfigDir, buildSystemContext } from "@singularity-ai/spectra-code";
import { MessageList } from "./message-list.js";
import { MetricsLine } from "./metrics-line.js";
import { PromptInput } from "./prompt-input.js";
import { createAppTheme } from "./theme.js";
import type { AppTheme, ChatMessage, SessionMetrics } from "./types.js";

const DEFAULT_METRICS: SessionMetrics = {
  modelId: "",
  modelName: "",
  provider: "",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  tokensUsed: 0,
  tokensTotal: 0,
  costUsd: 0,
  durationMs: 0,
  tokensPerSecond: 0,
  status: "idle",
  turnCount: 0,
};

const METRICS_LINES = 1;
const PROMPT_LINES = 4;

let msgCounter = 0;
function nextId(): string {
  return `msg_${++msgCounter}`;
}

type SlashCommand = "/help" | "/clear" | "/model" | "/quit" | "/compact";

const SLASH_COMMANDS: { name: SlashCommand; description: string }[] = [
  { name: "/help", description: "Show available commands" },
  { name: "/clear", description: "Clear conversation history" },
  { name: "/model", description: "Show current model" },
  { name: "/quit", description: "Quit Spectra Code" },
  { name: "/compact", description: "Compact context to reduce token usage" },
];

export interface CodeAgentAppOptions {
  initialMessages?: string[];
  systemPrompt?: string;
  verbose?: boolean;
  apiKey?: string;
}

export class CodeAgentApp {
  private tui!: TUI;
  private terminal!: ProcessTerminal;
  private messageList!: MessageList;
  private metricsLine!: MetricsLine;
  private promptInput!: PromptInput;
  private metrics: SessionMetrics = { ...DEFAULT_METRICS };
  private theme!: AppTheme;
  private messages: ChatMessage[] = [];
  private inputHistory: string[] = [];
  private historyIndex = -1;
  private streamingMessageId: string | null = null;
  private streamingStartTime = 0;
  private streamingOutputTokens = 0;
  private running = false;
  private aborting = false;
  private agent: Agent | null = null;
  private systemContext = "";
  private model: AgentConfig["model"];
  private commandPaletteOverlay: OverlayHandle | null = null;
  private keepAlive: NodeJS.Timeout | null = null;
  private options: CodeAgentAppOptions;

  constructor(model: AgentConfig["model"], options: CodeAgentAppOptions = {}) {
    this.model = model;
    this.options = options;
  }

  async start(): Promise<void> {
    this.terminal = new ProcessTerminal();
    this.tui = new TUI(this.terminal);
    const tuiTheme = getTheme();
    this.theme = createAppTheme(tuiTheme);

    this.messageList = new MessageList(this.theme);
    this.metricsLine = new MetricsLine(this.theme, this.metrics);
    this.promptInput = new PromptInput(this.theme);
    this.promptInput.onSubmit = (value) => this.handleSubmit(value);
    this.promptInput.onEscape = () => this.handleEscape();
    this.promptInput.onArrowUp = () => this.handleHistoryUp();
    this.promptInput.onArrowDown = () => this.handleHistoryDown();

    this.tui.addChild(this.messageList);
    this.tui.addChild(this.metricsLine);
    this.tui.addChild(this.promptInput);
    this.tui.setFocus(this.promptInput);

    this.tui.addInputListener((data) => {
      if (data === "\x03") {
        this.handleCtrlC();
        return { consume: true };
      }
      if (data === "\x04") {
        this.requestQuit();
        return { consume: true };
      }
      // Ctrl+P — toggle command palette
      if (data === "\x10" || matchesKey(data, "ctrl+p")) {
        if (this.commandPaletteOverlay) {
          this.closeCommandPalette();
        } else {
          this.openCommandPalette();
        }
        return { consume: true };
      }
      return undefined;
    });

    this.tui.onDebug = () => {
      this.tui.requestRender(true);
    };

    this.terminal.setTitle("Spectra Code");

    this.keepAlive = setInterval(() => {}, 30000);

    // FIX: Set model info BEFORE starting TUI so the prompt shows the correct model immediately
    this.updateModelName(this.model);

    // FIX: Start TUI BEFORE async operations so input works immediately
    this.tui.start();
    this.running = true;

    this.addSystemMessage("Welcome to Spectra Code. Type /help for commands, Ctrl+P for palette, Ctrl+D to quit.");

    if (this.options.verbose) {
      this.addSystemMessage(`Model: ${this.model.name} (${this.model.provider}/${this.model.api})`);
    }

    this.tui.requestRender();

    // FIX: Load config AFTER TUI start so the app is responsive while loading
    try {
      const config = await loadConfig();
      const configDir = await discoverConfigDir();
      this.systemContext = configDir ? await buildSystemContext(process.cwd(), config.context?.priorities) : "";

      if (this.systemContext) {
        const dirName = configDir ? configDir.replace(/\\/g, "/").split("/").pop() ?? configDir : "project";
        this.addSystemMessage(`Loaded context from ${dirName}`);
      }
    } catch {
      // Config loading is optional — don't crash the TUI
    }

    // Auto-submit initial messages from CLI args
    if (this.options.initialMessages && this.options.initialMessages.length > 0) {
      const combined = this.options.initialMessages.join(" ");
      // Small delay to let TUI render the welcome message first
      setTimeout(() => this.handleSubmit(combined), 100);
    }
  }

  private getMessageViewportHeight(): number {
    const totalRows = this.terminal.rows;
    return Math.max(3, totalRows - METRICS_LINES - PROMPT_LINES);
  }

  private updateModelName(model: AgentConfig["model"]): void {
    this.metrics.modelId = model.id;
    this.metrics.modelName = model.name || model.id;
    this.metrics.provider = model.provider;
    this.metricsLine.setMetrics(this.metrics);
    this.promptInput.setModelInfo(this.metrics.modelName, this.metrics.provider);
    this.promptInput.setMetrics(this.metrics);
  }

  /** Push metrics updates to both the metrics line and prompt stats */
  private syncMetrics(): void {
    this.metricsLine.setMetrics(this.metrics);
    this.promptInput.setMetrics(this.metrics);
    this.tui.requestRender();
  }

  private addSystemMessage(content: string): void {
    this.messages.push({
      id: nextId(),
      role: "assistant",
      content,
      timestamp: Date.now(),
    });
    this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
    this.messageList.scrollToBottom();
    this.tui.requestRender();
  }

  private async handleSubmit(input: string): Promise<void> {
    if (!input.trim()) return;

    if (input.trim().startsWith("/")) {
      this.handleSlashCommand(input.trim() as SlashCommand);
      this.promptInput.clear();
      this.tui.requestRender();
      return;
    }

    this.inputHistory.push(input.trim());
    this.historyIndex = this.inputHistory.length;

    this.messages.push({
      id: nextId(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    });
    this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
    this.promptInput.clear();
    this.messageList.scrollToBottom();
    this.tui.requestRender();

    await this.runAgent(input.trim());
  }

  private handleSlashCommand(cmd: SlashCommand): void {
    switch (cmd) {
      case "/help":
        this.addSystemMessage(
          "Available commands:\n" + SLASH_COMMANDS.map((c) => `  ${c.name} - ${c.description}`).join("\n"),
        );
        break;
      case "/clear":
        this.messages = [];
        // Reset metrics on clear
        this.metrics = { ...DEFAULT_METRICS, modelId: this.metrics.modelId, modelName: this.metrics.modelName, provider: this.metrics.provider };
        this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
        this.syncMetrics();
        this.addSystemMessage("Conversation cleared.");
        break;
      case "/model":
        this.addSystemMessage(`Model: ${this.metrics.modelName} (${this.metrics.provider})`);
        break;
      case "/quit":
        this.requestQuit();
        break;
      case "/compact":
        this.compactContext();
        break;
      default:
        this.addSystemMessage(`Unknown command: ${cmd}. Type /help for available commands.`);
    }
  }

  private compactContext(): void {
    const userMessages = this.messages.filter((m) => m.role === "user");
    const lastFew = userMessages.slice(-3);
    const summaryParts = lastFew.map((m) => m.content).join(" | ");
    const compacted = `Context compacted. Recent topics: ${summaryParts.slice(0, 200)}`;
    this.messages = this.messages.filter((m) => m.role !== "assistant" || !m.isStreaming);
    this.addSystemMessage(compacted);
  }

  private async runAgent(input: string): Promise<void> {
    if (this.aborting) return;

    const allTools = createAllTools(process.cwd());
    const systemPrompt = [
      this.options.systemPrompt ?? "You are Spectra Code, an expert coding assistant.",
      this.systemContext ? `\n\nProject context:\n${this.systemContext}` : "",
    ].join("");

    this.agent = new Agent({
      model: this.model,
      systemPrompt,
      tools: allTools,
      maxTurns: 50,
      toolExecution: "parallel",
      getApiKey: (provider: string) => {
        if (this.options.apiKey) return this.options.apiKey;
        const envKey = provider.toUpperCase().replace(/-/g, "_") + "_API_KEY";
        return process.env[envKey] ?? process.env.API_KEY;
      },
    });

    // FIX: Don't reset durationMs — accumulate across turns. Only reset per-turn values.
    this.metrics = {
      ...this.metrics,
      status: "streaming",
      tokensPerSecond: 0,
      turnCount: this.metrics.turnCount + 1,
    };
    this.metricsLine.setMetrics(this.metrics);
    this.metricsLine.startSpinner();

    const assistantId = nextId();
    this.streamingMessageId = assistantId;
    this.streamingStartTime = Date.now();
    this.streamingOutputTokens = 0;

    this.messages.push({
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    });
    this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
    this.messageList.scrollToBottom();
    this.tui.requestRender();

    try {
      const stream = this.agent.run(input);

      for await (const event of stream) {
        this.handleEvent(event, assistantId);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        this.metrics = { ...this.metrics, status: "error" };
        this.syncMetrics();
        this.messages.push({
          id: nextId(),
          role: "assistant",
          content: `Error: ${err.message}`,
          timestamp: Date.now(),
          isError: true,
        });
      }
    } finally {
      if (this.streamingMessageId === assistantId) {
        this.messageList.updateMessage(assistantId, { isStreaming: false });
        this.streamingMessageId = null;
      }
      this.metrics = { ...this.metrics, status: "idle" };
      this.metricsLine.setMetrics(this.metrics);
      this.metricsLine.stopSpinner();
      this.promptInput.setMetrics(this.metrics);
      this.agent = null;
      this.aborting = false;
      this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
      this.messageList.scrollToBottom();
      this.tui.requestRender();
    }
  }

  private handleEvent(event: AgentEvent, assistantId: string): void {
    switch (event.type) {
      case "message_update": {
        const msgEvent = event.assistantMessageEvent;
        if ("partial" in msgEvent) {
          const partial = msgEvent.partial;
          const textContent = partial.content
            .filter((c: { type: string; text?: string }) => c.type === "text")
            .map((c: { type: string; text?: string }) => c.text ?? "")
            .join("");

          // FIX: Extract real token usage from the AssistantMessage, not character count
          const usage = partial.usage;
          if (usage) {
            this.metrics.inputTokens = usage.input;
            this.metrics.outputTokens = usage.output;
            this.metrics.cacheReadTokens = usage.cacheRead;
            this.metrics.cacheWriteTokens = usage.cacheWrite;
            this.metrics.tokensUsed = usage.totalTokens;

            // FIX: Extract cost if available
            if (usage.cost) {
              this.metrics.costUsd = usage.cost.total;
            }
          }

          // FIX: TPS based on actual output tokens, not character count
          this.streamingOutputTokens = usage?.output ?? 0;
          const elapsed = Date.now() - this.streamingStartTime;
          const tps = elapsed > 0 && this.streamingOutputTokens > 0
            ? (this.streamingOutputTokens / (elapsed / 1000))
            : 0;

          this.metrics = { ...this.metrics, status: "streaming", tokensPerSecond: Math.round(tps) };
          this.syncMetrics();

          this.messageList.updateMessage(assistantId, { content: textContent });
          this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
          this.messageList.scrollToBottom();
          this.tui.requestRender();
        }
        break;
      }

      case "tool_execution_start": {
        this.metrics = { ...this.metrics, status: "tool_call" };
        this.syncMetrics();

        const toolLabel = this.getToolLabel(event.toolName);
        const toolId = nextId();
        this.messages.push({
          id: toolId,
          role: "toolResult",
          content: `${toolLabel}${event.args ? " " + this.formatArgs(event.args) : ""}`,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          isStreaming: true,
          timestamp: Date.now(),
        });
        this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
        this.messageList.scrollToBottom();
        this.tui.requestRender();
        break;
      }

      case "tool_execution_end": {
        const resultContent = event.result.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        const toolMsg = this.messages.find(
          (m) => m.role === "toolResult" && m.toolCallId === event.toolCallId,
        );
        if (toolMsg) {
          toolMsg.isStreaming = false;
          toolMsg.content = resultContent;
          toolMsg.isError = event.isError;
          toolMsg.details = event.result.details as Record<string, unknown>;
        } else {
          this.messages.push({
            id: nextId(),
            role: "toolResult",
            content: resultContent,
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            isError: event.isError,
            details: event.result.details as Record<string, unknown>,
            timestamp: Date.now(),
          });
        }
        this.metrics = { ...this.metrics, status: "streaming" };
        this.syncMetrics();
        this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
        this.messageList.scrollToBottom();
        this.tui.requestRender();
        break;
      }

      case "turn_end": {
        const elapsed = Date.now() - this.streamingStartTime;
        // FIX: Extract final token usage from the completed turn message
        const turnMessage = event.message;
        if (turnMessage?.usage) {
          this.metrics.inputTokens = turnMessage.usage.input;
          this.metrics.outputTokens = turnMessage.usage.output;
          this.metrics.cacheReadTokens = turnMessage.usage.cacheRead;
          this.metrics.cacheWriteTokens = turnMessage.usage.cacheWrite;
          this.metrics.tokensUsed = turnMessage.usage.totalTokens;
          if (turnMessage.usage.cost) {
            this.metrics.costUsd = turnMessage.usage.cost.total;
          }
        }
        this.metrics = {
          ...this.metrics,
          durationMs: this.metrics.durationMs + elapsed,
          status: "idle",
        };
        // Reset streaming timer for the next turn
        this.streamingStartTime = Date.now();
        this.syncMetrics();
        break;
      }

      case "agent_end": {
        this.metrics = { ...this.metrics, status: "idle" };
        this.syncMetrics();
        break;
      }
    }
  }

  private getToolLabel(toolName: string): string {
    const labels: Record<string, string> = {
      bash: "\u25b8 Bash",
      read: "\u25b8 Read",
      edit: "\u25b8 Edit",
      write: "\u25b8 Write",
      grep: "\u25b8 Grep",
      find: "\u25b8 Find",
      ls: "\u25b8 Ls",
      web_fetch: "\u25b8 WebFetch",
    };
    return labels[toolName] ?? `\u25b8 ${toolName}`;
  }

  private formatArgs(args: unknown): string {
    try {
      const obj = typeof args === "object" && args !== null ? args : {};
      const command = (obj as Record<string, unknown>).command ?? (obj as Record<string, unknown>).file_path ?? "";
      return String(command).slice(0, 80);
    } catch {
      return "";
    }
  }

  private handleCtrlC(): void {
    if (this.agent && !this.aborting) {
      this.aborting = true;
      this.agent.abort();
      this.metrics = { ...this.metrics, status: "idle" };
      this.metricsLine.setMetrics(this.metrics);
      this.metricsLine.stopSpinner();
      this.promptInput.setMetrics(this.metrics);
      this.addSystemMessage("Request aborted.");
    }
  }

  private requestQuit(): void {
    this.running = false;
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (this.agent) {
      this.agent.abort();
    }
    this.tui.stop();
    process.exit(0);
  }

  private handleEscape(): void {
    if (this.agent && !this.aborting) {
      this.aborting = true;
      this.agent.abort();
      this.metrics = { ...this.metrics, status: "idle" };
      this.metricsLine.setMetrics(this.metrics);
      this.metricsLine.stopSpinner();
      this.promptInput.setMetrics(this.metrics);
      this.addSystemMessage("Request aborted. Press Ctrl+D to quit.");
      return;
    }
    this.addSystemMessage("Press Ctrl+D to quit.");
  }

  private handleHistoryUp(): void {
    if (this.inputHistory.length === 0) return;
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.promptInput.setValue(this.inputHistory[this.historyIndex]);
      this.tui.requestRender();
    } else if (this.historyIndex === 0) {
      this.promptInput.setValue(this.inputHistory[0]);
      this.tui.requestRender();
    }
  }

  private handleHistoryDown(): void {
    if (this.historyIndex < this.inputHistory.length - 1) {
      this.historyIndex++;
      this.promptInput.setValue(this.inputHistory[this.historyIndex]);
      this.tui.requestRender();
    } else if (this.historyIndex === this.inputHistory.length - 1) {
      this.historyIndex = this.inputHistory.length;
      this.promptInput.setValue("");
      this.tui.requestRender();
    }
  }

  // ── Command Palette (Ctrl+P) ──────────────────────────────────────────

  private openCommandPalette(): void {
    if (this.commandPaletteOverlay) return;

    const tuiTheme = getTheme();
    const items: CommandPaletteItem[] = [
      {
        id: "new-session",
        label: "New Session",
        shortcut: "",
        group: "Session",
        get searchText() { return this.label; },
      },
      {
        id: "clear",
        label: "Clear Conversation",
        shortcut: "Ctrl+L",
        group: "Session",
        get searchText() { return this.label; },
      },
      {
        id: "compact",
        label: "Compact Context",
        shortcut: "",
        group: "Session",
        get searchText() { return this.label; },
      },
      {
        id: "model-info",
        label: "Show Model Info",
        shortcut: "",
        group: "Info",
        get searchText() { return this.label; },
      },
      {
        id: "help",
        label: "Help — Keyboard Shortcuts",
        shortcut: "",
        group: "Info",
        get searchText() { return this.label; },
      },
      {
        id: "quit",
        label: "Quit Spectra Code",
        shortcut: "Ctrl+D",
        group: "App",
        get searchText() { return this.label; },
      },
    ];

    const palette = new CommandPalette({
      items,
      placeholder: "Type a command...",
      theme: tuiTheme,
      onSelect: (item) => {
        this.closeCommandPalette();
        this.executeCommandPaletteAction(item.id);
      },
      onEscape: () => {
        this.closeCommandPalette();
      },
    });

    this.commandPaletteOverlay = this.tui.showOverlay(palette, {
      width: "50%",
      minWidth: 40,
      maxHeight: "60%",
      anchor: "top-center",
      offsetY: 2,
      margin: 1,
    });
    this.tui.requestRender();
  }

  private closeCommandPalette(): void {
    if (this.commandPaletteOverlay) {
      this.commandPaletteOverlay.hide();
      this.commandPaletteOverlay = null;
      this.tui.setFocus(this.promptInput);
      this.tui.requestRender();
    }
  }

  private executeCommandPaletteAction(actionId: string): void {
    switch (actionId) {
      case "new-session":
        this.messages = [];
        this.metrics = { ...DEFAULT_METRICS, modelId: this.metrics.modelId, modelName: this.metrics.modelName, provider: this.metrics.provider };
        this.messageList.setMessages(this.messages, this.getMessageViewportHeight());
        this.syncMetrics();
        this.addSystemMessage("New session started.");
        break;
      case "clear":
        this.handleSlashCommand("/clear");
        break;
      case "compact":
        this.handleSlashCommand("/compact");
        break;
      case "model-info":
        this.handleSlashCommand("/model");
        break;
      case "help":
        this.addSystemMessage(
          "Keyboard shortcuts:\n" +
          "  Ctrl+P     Command palette\n" +
          "  Ctrl+C     Abort current request\n" +
          "  Ctrl+D     Quit\n" +
          "  ↑/↓        Navigate input history\n" +
          "  Escape     Cancel / abort\n" +
          "  /help      Show slash commands",
        );
        break;
      case "quit":
        this.requestQuit();
        break;
    }
  }

  stop(): void {
    this.running = false;
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
    if (this.agent) {
      this.agent.abort();
    }
    this.tui.stop();
  }
}