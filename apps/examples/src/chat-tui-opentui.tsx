/** @jsxImportSource @opentui/react */

import { useState, useCallback, useRef, useEffect } from "react"
import { createCliRenderer } from "@opentui/core"
import { createRoot, flushSync, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Agent } from "@spectra/agent"
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "@spectra/ai"
import "dotenv/config"

// ---------------------------------------------------------------------------
// Theme — Catppuccin, purple-forward, borderless card layout
// ---------------------------------------------------------------------------

const c = {
  text: "#CDD6F4",
  dim: "#6C7086",
  accent: "#CBA6F7",
  success: "#A6E3A1",
  warn: "#F9E2AF",
  error: "#F38BA8",
  user: "#89B4FA",
  tool: "#FAB387",
  thinking: "#B4BEFE",
  tps: "#B4BEFE",
  debug: "#6C7086",
  // backgrounds
  bgBar: "#181825",
  bgChat: "#1E1E2E",
  bgCard: "#252536",
  bgThink: "#232438",
  bgTool: "#272535",
  bgDebug: "#11111B",
  // scrollbar
  sbThumb: "#45475A",
  sbTrack: "#313244",
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODEL = {
  id: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet",
  name: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet",
  provider: "openrouter" as const,
  api: "openai-completions" as const,
}

const SYSTEM_PROMPT = process.env.OPENROUTER_SYSTEM_PROMPT || "You are a helpful assistant."

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return Math.random().toString(36).slice(2, 9)
}

type ContentBlock =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "toolCall"; name: string; args: string }

function getMessageBlocks(msg: AssistantMessage): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const c of msg.content) {
    if (c.type === "text") {
      blocks.push({ type: "text", content: (c as TextContent).text })
    } else if (c.type === "thinking") {
      blocks.push({ type: "thinking", content: (c as ThinkingContent).thinking })
    } else if (c.type === "toolCall") {
      const tc = c as ToolCall
      blocks.push({ type: "toolCall", name: tc.name, args: JSON.stringify(tc.arguments, null, 2) })
    }
  }
  if (msg.errorMessage) {
    blocks.push({ type: "text", content: `[error] ${msg.errorMessage}` })
  }
  return blocks
}

const SPINNER = [
  "\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826",
  "\u2827", "\u2807", "\u280F",
]

interface ChatMessage {
  id: string
  role: "user" | "assistant" | "tool" | "error"
  content: string
  blocks?: ContentBlock[]
  meta?: string
  streaming?: boolean
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RoleLabel(props: {
  role: ChatMessage["role"]
  streaming?: boolean
  meta?: string
  spinnerFrame: number
}) {
  const { role, streaming, meta, spinnerFrame } = props
  if (role === "user") {
    return (
      <box justifyContent="flex-end">
        <text fg={c.user}><strong>You</strong></text>
      </box>
    )
  }
  if (role === "assistant") {
    return (
      <box>
        <text fg={c.accent}><strong>Assistant</strong></text>
        {streaming && <text fg={c.warn}> {SPINNER[spinnerFrame]}</text>}
      </box>
    )
  }
  if (role === "tool") {
    return (
      <box>
        <text fg={c.tool}><strong>{">"} {meta}</strong></text>
      </box>
    )
  }
  return (
    <box>
      <text fg={c.error}><strong>Error</strong></text>
    </box>
  )
}

function ThinkingBlock(props: { content: string }) {
  return (
    <box backgroundColor={c.bgThink} padding={1} marginTop={0}>
      <text fg={c.thinking}>{props.content || "(thinking...)"}</text>
    </box>
  )
}

function ToolCallBlock(props: { name: string; args: string }) {
  return (
    <box backgroundColor={c.bgTool} padding={1} marginTop={0}>
      <text fg={c.tool}>{props.args}</text>
    </box>
  )
}

function MessageContent(props: { msg: ChatMessage }) {
  const { msg } = props
  if (msg.role === "assistant" && msg.blocks) {
    if (msg.blocks.length === 0 && msg.streaming) {
      return <text fg={c.dim}>(waiting for first token...)</text>
    }
    return (
      <box flexDirection="column" gap={1}>
        {msg.blocks.map((block, idx) => {
          if (block.type === "thinking") {
            return <ThinkingBlock key={idx} content={block.content} />
          }
          if (block.type === "toolCall") {
            return <ToolCallBlock key={idx} name={block.name} args={block.args} />
          }
          return (
            <box key={idx}>
              <text fg={c.text}>{block.content}</text>
            </box>
          )
        })}
      </box>
    )
  }
  if (msg.role === "tool") {
    return null
  }
  return (
    <box marginLeft={0} marginRight={0}>
      < text fg={msg.role === "error" ? c.error : c.text}>
        {msg.content || " "}
      </text>
    </box >
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const renderer = useRenderer()
  const { height: termHeight } = useTerminalDimensions()

  // -- state --
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState("Ready")
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [showDebug, setShowDebug] = useState(false)
  const [debugLines, setDebugLines] = useState<string[]>([])
  const [tps, setTps] = useState<number | null>(null)
  const [tpsIsFallback, setTpsIsFallback] = useState(false)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [submitCounter, setSubmitCounter] = useState(0)

  // -- refs --
  const agentRef = useRef(
    new Agent({ model: MODEL, systemPrompt: SYSTEM_PROMPT, maxTurns: 10 }),
  )
  const streamingIdRef = useRef<string | null>(null)
  const assistantStartTimeRef = useRef<number | null>(null)
  const assistantChunkCountRef = useRef(0)

  // -- debug logger --
  const pushDebug = useCallback((line: string) => {
    setDebugLines((prev) => {
      const next = [...prev, line]
      if (next.length > 40) next.shift()
      return next
    })
  }, [])

  // -- spinner + live render --
  useEffect(() => {
    if (!isLoading) return
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER.length), 80)
    renderer.requestLive()
    return () => {
      clearInterval(id)
      renderer.dropLive()
    }
  }, [isLoading, renderer])

  // -- layout --
  const debugHeight = showDebug ? Math.max(Math.floor(termHeight * 0.3), 8) : 0

  // -- keyboard --
  useKeyboard((key) => {
    if (key.name === "escape") {
      agentRef.current.abort()
      renderer.destroy()
      return
    }
    if (key.ctrl && key.name === "l") {
      setMessages([])
      setDebugLines([])
      agentRef.current.reset()
      setStatus("Cleared")
      return
    }
    if (key.ctrl && key.name === "d") {
      setShowDebug((s) => !s)
      return
    }
  })

  // -- message helpers --
  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
  }, [])

  // -- submit --
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed || isLoading) return

      setTps(null)
      setTpsIsFallback(false)
      setElapsedMs(null)
      assistantChunkCountRef.current = 0

      addMessage({ id: generateId(), role: "user", content: trimmed })
      setIsLoading(true)
      setStatus("Streaming...")
      setSubmitCounter((c) => c + 1)

      const assistantId = generateId()
      streamingIdRef.current = assistantId
      addMessage({ id: assistantId, role: "assistant", content: "", blocks: [], streaming: true })

      const agent = agentRef.current
      assistantStartTimeRef.current = performance.now()

      try {
        for await (const event of agent.run(trimmed)) {
          pushDebug(`[EVT:${event.type}]`)

          switch (event.type) {
            case "agent_start":
              break
            case "turn_start":
              break
            case "message_start":
              if (event.message.role === "assistant") {
                pushDebug(`[MSG_START] usage=${JSON.stringify(event.message.usage)}`)
              }
              break
            case "message_update":
              if (event.message.role === "assistant" && streamingIdRef.current) {
                const blocks = getMessageBlocks(event.message)
                const text = blocks
                  .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
                  .map((b) => b.content)
                  .join("\n")
                flushSync(() => {
                  updateMessage(streamingIdRef.current!, { content: text, blocks })
                })
                if (
                  event.assistantMessageEvent.type === "text_delta" ||
                  event.assistantMessageEvent.type === "thinking_delta" ||
                  event.assistantMessageEvent.type === "toolcall_delta"
                ) {
                  assistantChunkCountRef.current += 1
                }
              }
              break
            case "message_end":
              if (event.message.role === "assistant" && streamingIdRef.current) {
                const blocks = getMessageBlocks(event.message)
                const text = blocks
                  .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
                  .map((b) => b.content)
                  .join("\n")
                flushSync(() => {
                  updateMessage(streamingIdRef.current!, { content: text, blocks, streaming: false })
                })
                const start = assistantStartTimeRef.current
                if (start !== null) {
                  const elapsed = performance.now() - start
                  setElapsedMs(elapsed)
                  const outputTokens = event.message.usage.output
                  if (outputTokens > 0 && elapsed > 0) {
                    setTps(outputTokens / (elapsed / 1000))
                    setTpsIsFallback(false)
                  } else if (elapsed > 0 && assistantChunkCountRef.current > 0) {
                    setTps(assistantChunkCountRef.current / (elapsed / 1000))
                    setTpsIsFallback(true)
                  }
                }
                streamingIdRef.current = null
              }
              break
            case "tool_execution_start":
              setStatus(`Tool: ${event.toolName}`)
              addMessage({
                id: generateId(),
                role: "tool",
                content: "",
                meta: `${event.toolName}(${JSON.stringify(event.args)})`,
              })
              break
            case "tool_execution_end":
              pushDebug(`[TOOL_END] ${event.toolName} isError=${event.isError}`)
              setStatus("Streaming...")
              break
            case "turn_end":
              pushDebug(`[TURN_END] stopReason=${event.message.stopReason}`)
              break
            case "agent_end":
              setStatus("Ready")
              break
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        pushDebug(`[CATCH] ${errorMsg}`)
        if (streamingIdRef.current) {
          updateMessage(streamingIdRef.current, {
            content: `Error: ${errorMsg}`,
            streaming: false,
            role: "error",
          })
          streamingIdRef.current = null
        } else {
          addMessage({ id: generateId(), role: "error", content: errorMsg })
        }
        setStatus("Error")
      } finally {
        setIsLoading(false)
        streamingIdRef.current = null
      }
    },
    [isLoading, addMessage, updateMessage, pushDebug],
  )

  // -- derived --
  const statusColor =
    status === "Error" ? c.error : status === "Ready" ? c.success : c.warn
  const statusText = status === "Cleared" ? "Ready" : status

  // -- render --
  return (
    <box flexDirection="column" height={termHeight}>
      {/* Header */}
      <box
        backgroundColor={c.bgBar}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={2}
        flexDirection="row"
        justifyContent="space-between"
        height={2}
      >
        <box flexDirection="row" gap={1}>
          <text fg={c.accent}><strong>Spectra Chat</strong></text>
          {tps !== null && (
            <text fg={c.tps}>{tps.toFixed(1)} {tpsIsFallback ? "chunks/s" : "tok/s"}</text>
          )}
          {elapsedMs !== null && (
            <text fg={c.dim}>({(elapsedMs / 1000).toFixed(1)}s)</text>
          )}
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={c.dim}>{MODEL.id}</text>
          <text fg={c.dim}>·</text>
          <text fg={statusColor}>{statusText}</text>
          <text fg={c.dim}>· Ctrl+D debug</text>
        </box>
      </box>

      {/* Messages ScrollBox */}
      <scrollbox
        flexGrow={1}
        stickyScroll={true}
        stickyStart="bottom"
        scrollY={true}
        viewportCulling={false}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={c.bgChat}
        verticalScrollbarOptions={{ trackOptions: { backgroundColor: c.sbTrack, foregroundColor: c.sbThumb } }}
      >
        {messages.length === 0 ? (
          <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <text fg={c.dim}>Welcome to Spectra Chat</text>
            <text fg={c.dim}>Type a message and press Enter</text>
            <text fg={c.dim}>Esc to quit  ·  Ctrl+L to clear  ·  Ctrl+D debug</text>
          </box>
        ) : null}
        {messages.map((msg) => (
          <box key={msg.id} flexDirection="column" marginBottom={1}>
            <RoleLabel role={msg.role} streaming={msg.streaming} meta={msg.meta} spinnerFrame={spinnerFrame} />
            <MessageContent msg={msg} />
          </box>
        ))}
      </scrollbox>

      {/* Debug Panel */}
      {showDebug && (
        <box
          backgroundColor={c.bgDebug}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
          height={debugHeight}
        >
          <text fg={c.debug}><strong>Debug Log ({debugLines.length} lines)</strong></text>
          <box flexDirection="column" flexGrow={1}>
            {debugLines.length === 0 && <text fg={c.dim}>No events yet...</text>}
            {debugLines.slice(-Math.max(debugHeight - 3, 3)).map((line, i) => (
              <text key={i} fg={c.debug}>{line}</text>
            ))}
          </box>
        </box>
      )}

      {/* Input */}
      <box
        backgroundColor={c.bgBar}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="row"
        alignItems="center"
        height={3}
      >
        {isLoading ? (
          <text fg={c.warn}>{SPINNER[spinnerFrame]}  Thinking...</text>
        ) : (
          <box flexDirection="row" flexGrow={1} alignItems="center">
            <text fg={c.accent}>›</text>
            <box marginLeft={1} flexGrow={1}>
              <input
                key={`msg-${submitCounter}`}
                placeholder="Type a message..."
                onSubmit={(v) => handleSubmit(String(v))}
                focused={true}
              />
            </box>
          </box>
        )}
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true })
createRoot(renderer).render(<App />)
