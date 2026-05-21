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

function InlineTool(props: { icon: string; title: string; meta?: string; color?: string; marginTop?: number }) {
  return (
    <box flexDirection="row" paddingLeft={3} marginTop={props.marginTop ?? 0}>
      <text fg={props.color || c.tool}>{props.icon} </text>
      <text fg={c.dim}>{props.title}</text>
      {props.meta ? <text fg={c.dim}> {props.meta}</text> : null}
    </box>
  )
}

function BlockTool(props: { title: string; titleColor?: string; children: any; marginTop?: number }) {
  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} marginTop={props.marginTop ?? 1} gap={1}
      backgroundColor={c.bgTool} border={["left"]} customBorderChars={SB} borderColor={c.bg}>
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

export function MessageView({ msg, showThinking = true, isFirst = false }: { msg: ChatMessage; showThinking?: boolean; isFirst?: boolean }) {
  const mt = isFirst ? 0 : 1

  if (msg.role === "user") {
    return (
      <box flexDirection="column" marginTop={mt} backgroundColor={c.bg}
        border={["left"]} customBorderChars={SB} borderColor={c.user} paddingLeft={2} paddingRight={1}>
        <text fg={c.user} attributes={1}>You</text>
        <text fg={c.text}>{msg.content}</text>
      </box>
    )
  }

  if (msg.role === "assistant") {
    return (
      <box flexDirection="column" marginTop={mt}>
        {msg.blocks && msg.blocks.length === 0 && msg.streaming ? (
          <text fg={c.dim} paddingLeft={2}>(streaming...)</text>
        ) : null}
        {msg.blocks ? (
          <box flexDirection="column" paddingLeft={3}>
            {(() => {
              const thinkBlocks = msg.blocks.filter((b): b is { type: "thinking"; content: string } => b.type === "thinking")
              const textBlocks = msg.blocks.filter((b): b is { type: "text"; content: string } => b.type === "text")
              const mdContent = textBlocks.map((b) => b.content).join("\n")
              const hasThinking = showThinking && thinkBlocks.length > 0
              return (
                <>
                  {hasThinking && thinkBlocks.map((block, i) => (
                    <box key={`think-${i}`} marginTop={i === 0 ? 0 : 1}>
                      <text fg={c.dim}>{block.content}</text>
                    </box>
                  ))}
                  {mdContent ? <markdown content={mdContent} syntaxStyle={mdStyle} streaming={!!msg.streaming} conceal={true} width="100%" tableOptions={{ style: "grid", borders: true, borderStyle: "single" }} marginTop={hasThinking ? 1 : 0} /> : null}
                </>
              )
            })()}
          </box>
        ) : (
          <text fg={c.text} paddingLeft={3}>{msg.content}</text>
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
      return <InlineTool icon={tName === "read" ? "→" : ""} title={displayTitle} color={tName === "read" ? c.info : c.tool} marginTop={mt} />
    }

    if (tName === "bash" || tName === "shell") {
      const command = (argsObj as any)?.command || argsStr
      const description = (argsObj as any)?.description
      if (!output) return <InlineTool icon="$" title={command || "shell"} color={c.tool} marginTop={mt} />

      // Parse exit code from output
      const exitCodeMatch = output.match(/^Exit code: (\d+)\n?/)
      const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : null
      const cleanOutput = exitCodeMatch ? output.slice(exitCodeMatch[0].length) : output
      const exitColor = exitCode === 0 ? c.success : c.error

      return (
        <box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={2} marginTop={mt} gap={1}
          backgroundColor={c.bgTool} border={["left"]} customBorderChars={SB} borderColor={c.bg}>
          <box flexDirection="row" justifyContent="space-between" alignItems="flex-start" paddingLeft={1}>
            <box flexDirection="column" gap={1}>
              {description ? <text fg={c.info} attributes={1}>{description}</text> : null}
              <text fg={c.tool}>$ {command}</text>
            </box>
            {exitCode !== null && <text fg={exitColor}>Exit {exitCode}</text>}
          </box>
          <box paddingLeft={2}>
            <TruncatedContent text={cleanOutput} maxLines={MAX_SHELL_LINES} />
          </box>
        </box>
      )
    }

    if (tName === "write") {
      const displayTitle = argsStr ? `Wrote ${argsStr}` : "Wrote"
      return (
        <BlockTool title={displayTitle} titleColor={c.success} marginTop={mt}>
          <text fg={c.dim}>File written</text>
        </BlockTool>
      )
    }

    if (tName === "edit") {
      const displayTitle = argsStr ? `Edit ${argsStr}` : "Edit"
      return (
        <BlockTool title={displayTitle} titleColor={c.thinking} marginTop={mt}>
          <text fg={c.dim}>Edit applied</text>
        </BlockTool>
      )
    }

    if (tName === "web_fetch") {
      const displayTitle = argsStr ? `Fetch ${argsStr}` : "Fetch"
      if (!output) return <InlineTool icon="↗" title={displayTitle} color={c.info} marginTop={mt} />
      return (
        <BlockTool title={displayTitle} titleColor={c.info} marginTop={mt}>
          <TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} />
        </BlockTool>
      )
    }

    if (!output) return <InlineTool icon="⚙" title={raw} color={c.tool} marginTop={mt} />
    const displayTitle = argsStr ? `${tName} ${argsStr}` : tName
    return (
      <BlockTool title={displayTitle} titleColor={c.tool} marginTop={mt}>
        <TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} />
      </BlockTool>
    )
  }

  return (
    <box paddingLeft={2} border={["left"]} customBorderChars={SB} borderColor={c.error} marginTop={mt}>
      <text fg={c.error}><strong>Error:</strong> {msg.content}</text>
    </box>
  )
}
