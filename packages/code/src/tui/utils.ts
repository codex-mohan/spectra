import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "@singularity-ai/spectra-ai"
import type { ContentBlock } from "./types.js"

export function genId(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function getMessageBlocks(msg: AssistantMessage): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const c of msg.content) {
    if (c.type === "text") blocks.push({ type: "text", content: (c as TextContent).text })
    else if (c.type === "thinking") blocks.push({ type: "thinking", content: (c as ThinkingContent).thinking })
    else if (c.type === "toolCall") {
      const tc = c as ToolCall
      blocks.push({ type: "toolCall", name: tc.name, args: JSON.stringify(tc.arguments, null, 2) })
    }
  }
  if (msg.errorMessage) blocks.push({ type: "text", content: `[error] ${msg.errorMessage}` })
  return blocks
}
