import { useState } from "react"
import { c, mdStyle } from "../theme.js"
import type { ChatMessage, ContentBlock } from "../types.js"
import stripAnsi from "strip-ansi"

// OpenCode-style SplitBorder — only vertical bar on the left
const SB = {
  vertical: "┃", topLeft: "", bottomLeft: "", topRight: "", bottomRight: "",
  horizontal: " ", bottomT: "", topT: "", cross: "", leftT: "", rightT: "",
}

const MAX_SHELL_LINES = 10
const MAX_GENERIC_LINES = 3

function InlineTool(props: { icon: string; title: string; meta?: string; color?: string }) {
  return (
    <box flexDirection="row" paddingLeft={2}>
      <text fg={props.color || c.tool}>{props.icon} </text>
      <text fg={c.dim}>{props.title}</text>
      {props.meta ? <text fg={c.dim}> {props.meta}</text> : null}
    </box>
  )
}

function BlockTool(props: { title: string; titleColor?: string; children: any }) {
  return (
    <box flexDirection="column" paddingTop={0} paddingBottom={0} paddingLeft={1} marginTop={0} marginBottom={1}
      backgroundColor={c.bgTool}>
      <text fg={props.titleColor || c.tool} paddingLeft={1}>{props.title}</text>
      <box paddingLeft={2}>{props.children}</box>
    </box>
  )
}

function TruncatedContent(props: { text: string; maxLines: number }) {
  const [expanded, setExpanded] = useState(false)
  const lines = props.text.split("\n")
  const overflow = lines.length > props.maxLines
  const display = expanded || !overflow ? props.text : lines.slice(0, props.maxLines).join("\n") + "\n…"
  return (
    <box flexDirection="column" onMouseDown={overflow ? () => setExpanded(!expanded) : undefined}>
      <text fg={c.text}>{display}</text>
      {overflow ? <text fg={c.dim}>{expanded ? "click to collapse" : "click to expand"}</text> : null}
    </box>
  )
}

export function MessageView({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <box flexDirection="column" marginBottom={1} marginTop={1} backgroundColor={c.bgBar}
        border={["left"]} customBorderChars={SB} borderColor={c.user} paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1}>
        <text fg={c.user} attributes={1}>You</text>
        <text fg={c.text}>{msg.content}</text>
      </box>
    )
  }

  if (msg.role === "assistant") {
    return (
      <box flexDirection="column">
        {msg.blocks && msg.blocks.length === 0 && msg.streaming ? (
          <text fg={c.dim} paddingLeft={2}>(streaming...)</text>
        ) : null}
        {msg.blocks ? (
          <box flexDirection="column" paddingLeft={1}>
            {(() => {
              const thinkBlocks = msg.blocks.filter((b): b is { type: "thinking"; content: string } => b.type === "thinking")
              const textBlocks = msg.blocks.filter((b): b is { type: "text"; content: string } => b.type === "text")
              const mdContent = textBlocks.map((b) => b.content).join("\n")
              return (
                <>
                  {thinkBlocks.map((block, i) => (
                    <box key={`think-${i}`}>
                      <text fg={c.dim}>{block.content}</text>
                    </box>
                  ))}
                  {mdContent ? <markdown content={mdContent} syntaxStyle={mdStyle} streaming={!!msg.streaming} conceal={true} width="100%" tableOptions={{ style: "grid", borders: true, borderStyle: "single" }} /> : null}
                </>
              )
            })()}
          </box>
        ) : (
          <text fg={c.text} paddingLeft={2}>{msg.content}</text>
        )}
      </box>
    )
  }

  if (msg.role === "tool") {
    const raw = msg.meta || ""
    const tName = raw.includes("(") ? raw.split("(")[0] : raw
    const rawArgs = raw.includes("(") ? raw.slice(raw.indexOf("(") + 1, raw.lastIndexOf(")")) : ""

    // Parse args: try JSON first, fall back to raw string
    let argsObj: Record<string, unknown> = {}
    let argsStr = rawArgs
    try {
      const parsed = JSON.parse(rawArgs)
      if (typeof parsed === "object" && parsed !== null) {
        argsObj = parsed
        argsStr = Object.values(parsed).filter(v => v !== undefined && v !== "undefined").map(v => String(v)).join(" ")
      }
    } catch {
      if (argsStr === "undefined") argsStr = ""
    }

    const output = stripAnsi(msg.content || "")
    const isReadingTool = ["read", "glob", "grep"].includes(tName)

    // Reading tools: only show inline indicator, never show output
    if (isReadingTool) {
      const displayTitle = argsStr ? `${tName === "read" ? "Read" : tName === "glob" ? "Glob" : "Grep"} ${argsStr}` : tName
      return <InlineTool icon={tName === "read" ? "→" : "✱"} title={displayTitle} color={tName === "read" ? c.info : c.tool} />
    }

    if (tName === "bash" || tName === "shell") {
      const displayTitle = argsStr ? `$ ${argsStr}` : "$ shell"
      if (!output) return <InlineTool icon="$" title={argsStr || "shell"} color={c.tool} />
      return (
        <BlockTool title={displayTitle} titleColor={c.tool}>
          <box flexDirection="column" gap={0}>
            <text fg={c.dim}>$ {argsStr}</text>
            <TruncatedContent text={output} maxLines={MAX_SHELL_LINES} />
          </box>
        </BlockTool>
      )
    }

    if (tName === "write") {
      const displayTitle = argsStr ? `Wrote ${argsStr}` : "Wrote"
      return (
        <BlockTool title={displayTitle} titleColor={c.success}>
          <text fg={c.dim}>File written</text>
        </BlockTool>
      )
    }

    if (tName === "edit") {
      const displayTitle = argsStr ? `Edit ${argsStr}` : "Edit"
      return (
        <BlockTool title={displayTitle} titleColor={c.thinking}>
          <text fg={c.dim}>Edit applied</text>
        </BlockTool>
      )
    }

    if (tName === "web_fetch") {
      const displayTitle = argsStr ? `Fetch ${argsStr}` : "Fetch"
      if (!output) return <InlineTool icon="↗" title={displayTitle} color={c.info} />
      return (
        <BlockTool title={displayTitle} titleColor={c.info}>
          <TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} />
        </BlockTool>
      )
    }

    if (!output) return <InlineTool icon="⚙" title={raw} color={c.tool} />
    const displayTitle = argsStr ? `${tName} ${argsStr}` : tName
    return (
      <BlockTool title={displayTitle} titleColor={c.tool}>
        <TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} />
      </BlockTool>
    )
  }

  return (
    <box paddingLeft={1} marginBottom={1}>
      <text fg={c.error}><strong>Error:</strong> {msg.content}</text>
    </box>
  )
}
