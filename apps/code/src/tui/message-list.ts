import type { Component } from "@singularity-ai/spectra-tui";
import { visibleWidth, wrapTextWithAnsi, truncateToWidth } from "@singularity-ai/spectra-tui";
import type { ChatMessage } from "./types.js";
import type { AppTheme } from "./types.js";
import { formatDuration } from "./theme.js";

const TOP_LEFT = "\u256D";
const TOP_RIGHT = "\u256E";
const BOTTOM_LEFT = "\u2570";
const BOTTOM_RIGHT = "\u256F";
const HORIZONTAL = "\u2500";
const VERTICAL = "\u2502";

function isDiffContent(toolName: string | undefined, content: string): boolean {
  if (!toolName) return false;
  if (toolName === "edit" || toolName === "write") return true;
  if (content.includes("\n+++ ") || content.includes("\n--- ")) return true;
  return false;
}

function renderDiffLine(line: string, theme: AppTheme, contentWidth: number): string {
  let styled: string;
  if (line.startsWith("+") && !line.startsWith("+++")) {
    styled = theme.toolResultLabel(line);
  } else if (line.startsWith("-") && !line.startsWith("---")) {
    styled = theme.errorBorder(line);
  } else if (line.startsWith("@@")) {
    styled = theme.metricsValue(line);
  } else {
    styled = line;
  }
  return styled + " ".repeat(Math.max(0, contentWidth - 2 - visibleWidth(styled)));
}

export class MessageList implements Component {
  private messages: ChatMessage[] = [];
  private theme: AppTheme;
  private viewportHeight = 24;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(theme: AppTheme) {
    this.theme = theme;
  }

  setMessages(messages: ChatMessage[], viewportHeight?: number): void {
    this.messages = messages;
    if (viewportHeight !== undefined) this.viewportHeight = viewportHeight;
    this.invalidate();
  }

  addMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.invalidate();
  }

  updateMessage(id: string, updates: Partial<ChatMessage>): void {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx !== -1) {
      this.messages[idx] = { ...this.messages[idx], ...updates };
      this.invalidate();
    }
  }

  getMessage(id: string): ChatMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  scrollToBottom(): void {
    this.invalidate();
  }

  handleInput(data: string): void {
    this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const contentWidth = Math.max(1, width - 2);
    const allLines: string[] = [];

    for (const msg of this.messages) {
      const rendered = this.renderMessage(msg, width, contentWidth);
      allLines.push(...rendered);
    }

    if (this.messages.length === 0) {
      const emptyLine = " ".repeat(width);
      for (let i = 0; i < Math.max(3, this.viewportHeight); i++) allLines.push(emptyLine);
    }

    const visibleLines = allLines.length <= this.viewportHeight
      ? allLines
      : allLines.slice(allLines.length - this.viewportHeight);

    while (visibleLines.length < this.viewportHeight) {
      visibleLines.push(" ".repeat(width));
    }

    this.cachedWidth = width;
    this.cachedLines = visibleLines;
    return visibleLines;
  }

  private renderMessage(msg: ChatMessage, width: number, contentWidth: number): string[] {
    switch (msg.role) {
      case "user":
        return this.renderUserMessage(msg, width, contentWidth);
      case "assistant":
        return this.renderAssistantMessage(msg, width, contentWidth);
      case "toolResult":
        return this.renderToolResult(msg, width, contentWidth);
      default:
        return [];
    }
  }

  private renderUserMessage(msg: ChatMessage, width: number, contentWidth: number): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    const label = theme.userLabel(" You ");
    const labelWidth = visibleWidth(label);
    const fillRight = Math.max(0, contentWidth - labelWidth - 1);
    const top = theme.userBorder(TOP_LEFT + HORIZONTAL) + label + theme.userBorder(HORIZONTAL.repeat(fillRight) + TOP_RIGHT);
    lines.push(top);

    const wrapped = wrapTextWithAnsi(msg.content, contentWidth - 2);
    for (const line of wrapped) {
      const padded = line + " ".repeat(Math.max(0, contentWidth - 2 - visibleWidth(line)));
      lines.push(theme.userBorder(VERTICAL) + " " + padded + " " + theme.userBorder(VERTICAL));
    }

    const bottom = theme.userBorder(BOTTOM_LEFT + HORIZONTAL.repeat(contentWidth) + BOTTOM_RIGHT);
    lines.push(bottom);
    return lines;
  }

  private renderAssistantMessage(msg: ChatMessage, width: number, contentWidth: number): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    const suffix = msg.isStreaming ? ` ${theme.spinner[0]}` : "";
    const label = theme.assistantLabel(" Assistant" + suffix + " ");
    const labelWidth = visibleWidth(label);

    const fillRight = Math.max(0, contentWidth - labelWidth - 1);
    const top = theme.assistantBorder(TOP_LEFT + HORIZONTAL) + label + theme.assistantBorder(HORIZONTAL.repeat(fillRight) + TOP_RIGHT);
    lines.push(top);

    const content = msg.content || (msg.isStreaming ? "" : "");
    if (content) {
      const wrapped = wrapTextWithAnsi(content, contentWidth - 2);
      for (const line of wrapped) {
        const padded = line + " ".repeat(Math.max(0, contentWidth - 2 - visibleWidth(line)));
        lines.push(theme.assistantBorder(VERTICAL) + " " + padded + " " + theme.assistantBorder(VERTICAL));
      }
    } else if (msg.isStreaming) {
      const thinkingLine = " ".repeat(2) + theme.spinner[0] + " ".repeat(Math.max(0, contentWidth - 3));
      lines.push(theme.assistantBorder(VERTICAL) + thinkingLine + theme.assistantBorder(VERTICAL));
    } else {
      const emptyLine = " ".repeat(contentWidth);
      lines.push(theme.assistantBorder(VERTICAL) + emptyLine + theme.assistantBorder(VERTICAL));
    }

    const bottom = theme.assistantBorder(BOTTOM_LEFT + HORIZONTAL.repeat(contentWidth) + BOTTOM_RIGHT);
    lines.push(bottom);
    return lines;
  }

  private renderToolResult(msg: ChatMessage, width: number, contentWidth: number): string[] {
    const theme = this.theme;
    const borderFn = msg.isError ? theme.errorBorder : theme.toolResultBorder;
    const labelFn = msg.isError ? theme.errorLabel : theme.toolResultLabel;

    const lines: string[] = [];
    const nameLabel = msg.toolName ? labelFn(` ${msg.toolName} `) : labelFn(" Tool ");
    const durationLabel = msg.details?.durationMs ? theme.metricsValue(formatDuration(msg.details.durationMs as number)) : "";
    const fullLabel = nameLabel + (durationLabel ? " " + durationLabel : "");
    const labelWidth = visibleWidth(fullLabel);

    const fillRight = Math.max(0, contentWidth - labelWidth - 1);
    const top = borderFn(TOP_LEFT + HORIZONTAL) + fullLabel + borderFn(HORIZONTAL.repeat(fillRight) + TOP_RIGHT);
    lines.push(top);

    const content = msg.content;
    if (content) {
      const useDiff = isDiffContent(msg.toolName, content);
      const maxContentLines = useDiff ? 30 : 20;
      const rawLines = content.split("\n");
      const truncated = rawLines.length > maxContentLines;
      const displayLines = truncated ? rawLines.slice(0, maxContentLines) : rawLines;

      for (const line of displayLines) {
        if (useDiff) {
          const rendered = renderDiffLine(line, theme, contentWidth);
          lines.push(borderFn(VERTICAL) + " " + rendered + " " + borderFn(VERTICAL));
        } else {
          const truncatedLine = visibleWidth(line) > contentWidth - 2
            ? truncateToWidth(line, contentWidth - 5) + theme.metricsValue(" ...")
            : line;
          const padded = truncatedLine + " ".repeat(Math.max(0, contentWidth - 2 - visibleWidth(truncatedLine)));
          lines.push(borderFn(VERTICAL) + " " + padded + " " + borderFn(VERTICAL));
        }
      }

      if (truncated) {
        const moreLine = theme.metricsValue(`... ${rawLines.length - maxContentLines} more lines`);
        const padded = moreLine + " ".repeat(Math.max(0, contentWidth - 2 - visibleWidth(moreLine)));
        lines.push(borderFn(VERTICAL) + " " + padded + " " + borderFn(VERTICAL));
      }
    }

    const bottom = borderFn(BOTTOM_LEFT + HORIZONTAL.repeat(contentWidth) + BOTTOM_RIGHT);
    lines.push(bottom);
    return lines;
  }
}