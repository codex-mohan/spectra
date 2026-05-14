import { Box, Text } from "@opentui/core";
import type { SpectraTuiApp } from "../app.js";
import { createToolCallView } from "./tool-call.js";

export function createMessageView(msg: any, index: number, app: SpectraTuiApp): any {
  const role = (msg as Record<string, unknown>).role as string;
  if (role === "user") {
    return createUserMessage(msg as never, index);
  }
  if (role === "assistant") {
    return createAssistantMessage(msg as never, index);
  }
  if (role === "toolResult") {
    return createToolResultMessage(msg as never);
  }
  return Box({}, Text({ content: `Unknown message type: ${role}`, fg: "#EF4444" }));
}

function createUserMessage(msg: any, index: number): any {
  const content = typeof msg.content === "string" ? msg.content : msg.content.map((c: any) => "text" in c ? c.text : "").join(" ");

  return Box(
    {
      flexDirection: "column",
      padding: 1,
    },
    Text({ content: "  You", fg: "#10B981", attributes: 1 }),
    Text({
      content: content,
      fg: "#E5E7EB",
    }),
  );
}

function createAssistantMessage(msg: any, index: number): any {
  if (msg.role !== "assistant") return Box({});

  const children: any[] = [];

  children.push(
    Box(
      {},
      Text({ content: "  Assistant", fg: "#7C3AED", attributes: 1 }),
    ),
  );

  for (const block of msg.content) {
    if (block.type === "text") {
      children.push(
        Box(
          { paddingLeft: 1 },
          Text({ content: block.text, fg: "#E5E7EB" }),
        ),
      );
    } else if (block.type === "thinking") {
      children.push(
        Box(
          {
            paddingLeft: 1,
            borderStyle: "single",
            borderColor: "#374151",
          },
          Text({
            content: block.redacted ? "(Thinking redacted)" : block.thinking,
            fg: "#9CA3AF",
          }),
        ),
      );
    } else if (block.type === "toolCall") {
      children.push(createToolCallView(block));
    }
  }

  if (msg.usage) {
    children.push(
      Text({
        content: `  ↑${msg.usage.input} ↓${msg.usage.output}`,
        fg: "#4B5563",
      }),
    );
  }

  return Box({ flexDirection: "column", padding: 1 }, ...children);
}

function createToolResultMessage(msg: any): any {
  if (msg.role !== "toolResult") return Box({});
  const content = msg.content.map((c: any) => "text" in c ? c.text : "").join(" ");
  const truncated = content.length > 500 ? content.slice(0, 500) + "..." : content;

  return Box(
    {
      flexDirection: "column",
      paddingLeft: 2,
      borderStyle: "single",
      borderColor: msg.isError ? "#EF4444" : "#374151",
    },
    Box(
      {
        flexDirection: "row",
        gap: 1,
      },
      Text({ content: msg.isError ? "✗" : "✓", fg: msg.isError ? "#EF4444" : "#10B981" }),
      Text({ content: msg.toolName, fg: "#9CA3AF" }),
    ),
    Text({ content: truncated, fg: "#6B7280" }),
  );
}
