import { c, mdStyle } from "../theme.js"
import type { ChatMessage, ContentBlock } from "../types.js"

export function MessageView({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <box flexDirection="column" paddingLeft={1}>
        <box justifyContent="flex-end"><text fg={c.user}><strong>You</strong></text></box>
        <box justifyContent="flex-end"><text fg={c.text}>{msg.content}</text></box>
      </box>
    )
  }

  if (msg.role === "assistant") {
    return (
      <box flexDirection="column">
        <box>
          <text fg={c.accent}><strong>Assistant</strong></text>
          {msg.streaming && <text fg={c.warn}> ●</text>}
        </box>
        {msg.blocks && msg.blocks.length === 0 && msg.streaming ? (
          <text fg={c.dim}>(streaming...)</text>
        ) : null}
        {msg.blocks ? (
          <box flexDirection="column" gap={1} paddingLeft={1}>
            {(() => {
              const textBlocks = msg.blocks.filter((b): b is { type: "text"; content: string } => b.type === "text")
              const thinkBlocks = msg.blocks.filter((b): b is { type: "thinking"; content: string } => b.type === "thinking")
              const mdContent = textBlocks.map((b) => b.content).join("\n")
              return (
                <>
                  {thinkBlocks.map((block, i) => (
                    <box key={`think-${i}`} backgroundColor={c.bgThink} padding={1}>
                      <text fg={c.thinking}>{block.content}</text>
                    </box>
                  ))}
                  {mdContent ? <markdown content={mdContent} syntaxStyle={mdStyle} streaming={!!msg.streaming} conceal={true} width="100%" tableOptions={{ style: "grid", borders: true, borderStyle: "single" }} /> : null}
                </>
              )
            })()}
          </box>
        ) : (
          <text fg={c.text}>{msg.content}</text>
        )}
      </box>
    )
  }

  if (msg.role === "tool") {
    return (
      <box backgroundColor={c.bgTool} padding={1} marginTop={0}>
        <text fg={c.tool}><strong>{">"} {msg.meta || msg.content}</strong></text>
      </box>
    )
  }

  return (
    <box paddingLeft={1}>
      <text fg={c.error}><strong>Error:</strong> {msg.content}</text>
    </box>
  )
}
