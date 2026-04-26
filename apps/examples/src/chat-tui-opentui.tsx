/** @jsxImportSource @opentui/react */

import { readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { createCliRenderer, RGBA, SyntaxStyle } from "@opentui/core"
import { createRoot, flushSync, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Agent } from "@spectra/agent"
import { defineTool } from "@spectra/agent"
import { z } from "zod"
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall, Message } from "@spectra/ai"
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
  bgBar: "#181825",
  bgChat: "#1E1E2E",
  bgCard: "#252536",
  bgThink: "#232438",
  bgTool: "#272535",
  bgDebug: "#11111B",
  bgOverlay: "#11111BBB",
  sbThumb: "#45475A",
  sbTrack: "#313244",
}

// ---------------------------------------------------------------------------
// Markdown syntax style
// ---------------------------------------------------------------------------

const mdStyle = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex(c.accent), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex(c.accent), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex(c.accent), bold: true },
  "markup.heading.4": { fg: RGBA.fromHex(c.accent) },
  "markup.bold": { bold: true },
  "markup.italic": { italic: true },
  "markup.list": { fg: RGBA.fromHex(c.text) },
  "markup.raw": { fg: RGBA.fromHex(c.thinking) },
  "markup.link": { fg: RGBA.fromHex(c.user) },
  "markup.quote": { fg: RGBA.fromHex(c.dim) },
  "markup.table": { fg: RGBA.fromHex(c.text) },
  "markup.table.header": { fg: RGBA.fromHex(c.accent), bold: true },
  "keyword": { fg: RGBA.fromHex(c.accent) },
  "string": { fg: RGBA.fromHex(c.success) },
  "comment": { fg: RGBA.fromHex(c.dim), italic: true },
  "number": { fg: RGBA.fromHex(c.tool) },
  "function": { fg: RGBA.fromHex(c.user) },
  "type": { fg: RGBA.fromHex(c.accent) },
  default: { fg: RGBA.fromHex(c.text) },
})

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
// Tools
// ---------------------------------------------------------------------------

const tools = [
  defineTool({
    name: "calculate",
    description: "Evaluate a mathematical expression",
    parameters: z.object({ expression: z.string() }),
    execute: async (args) => {
      try {
        const result = Function(`"use strict"; return (${args.expression})`)()
        return { content: [{ type: "text", text: `${args.expression} = ${result}` }] }
      } catch {
        return { content: [{ type: "text", text: `Error evaluating: ${args.expression}` }] }
      }
    },
  }),
  defineTool({
    name: "get_time",
    description: "Get the current date and time",
    parameters: z.object({}),
    execute: async () => ({ content: [{ type: "text", text: new Date().toISOString() }] }),
  }),
  defineTool({
    name: "echo",
    description: "Echo back whatever the user says",
    parameters: z.object({ text: z.string() }),
    execute: async (args) => ({ content: [{ type: "text", text: `You said: ${args.text}` }] }),
  }),
]

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

const MAX_SESSIONS = 20

interface SavedSession {
  id: string
  title: string
  date: string
  messages: ChatMessage[]
  agentMessages?: Message[]
}

function storagePath(): string {
  return `${homedir()}/.spectra-sessions.json`
}

function loadSessions(): SavedSession[] {
  try {
    return JSON.parse(readFileSync(storagePath(), "utf-8"))
  } catch {
    return []
  }
}

function persistSessions(sessions: SavedSession[]): void {
  try {
    writeFileSync(storagePath(), JSON.stringify(sessions.slice(0, MAX_SESSIONS)), "utf-8")
  } catch {}
}

function sessionTitle(messages: ChatMessage[]): string {
  const user = messages.find((m) => m.role === "user")
  return user ? user.content.slice(0, 48).replace(/\n.*/, "") : "New session"
}

function toAgentMessages(chat: ChatMessage[]): Message[] {
  const msgs: Message[] = []
  for (const m of chat) {
    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content, timestamp: Date.now() })
    } else if (m.role === "assistant" && m.blocks) {
      const blocks = m.blocks.map((b) => {
        if (b.type === "text") return { type: "text" as const, text: b.content }
        if (b.type === "thinking") return { type: "thinking" as const, thinking: b.content }
        return { type: "toolCall" as const, id: "", name: b.name, arguments: { raw: b.args } }
      })
      msgs.push({
        role: "assistant",
        content: blocks,
        provider: MODEL.provider,
        model: MODEL.name,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: "stop",
        timestamp: Date.now(),
      })
    }
  }
  return msgs
}

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
    const nonText = msg.blocks.filter((b) => b.type !== "text")
    const textBlocks = msg.blocks.filter((b) => b.type === "text")
    const mdContent = textBlocks.map((b) => b.content).join("\n")
    return (
      <box flexDirection="column" gap={1}>
        {nonText.map((block, idx) => {
          if (block.type === "thinking") {
            return <ThinkingBlock key={`think-${idx}`} content={block.content} />
          }
          return <ToolCallBlock key={`tool-${idx}`} name={block.name!} args={block.args!} />
        })}
        {mdContent && (
          <markdown content={mdContent} syntaxStyle={mdStyle} streaming={msg.streaming} conceal={true} width="100%" />
        )}
      </box>
    )
  }
  if (msg.role === "tool") {
    return null
  }
  return (
    <box>
      <text fg={msg.role === "error" ? c.error : c.text}>{msg.content || " "}</text>
    </box>
  )
}

// ---------------------------------------------------------------------------
// Command menu
// ---------------------------------------------------------------------------

interface CmdItem {
  id: string
  label: string
  desc: string
  action: () => void
  navigate?: boolean
}

function CommandMenu(props: {
  filter: string
  selected: number
  items: CmdItem[]
  termWidth: number
  termHeight: number
  prefix?: string
  footerHint?: string
}) {
  const { filter, selected, items, termWidth, termHeight, prefix, footerHint } = props
  const mw = Math.min(56, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(20, termHeight - 4)
  const listH = mh - 4

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0}>
      <box position="absolute" left={ml} top={2} width={mw} height={mh} backgroundColor={c.bgChat}>
        {/* Search bar */}
        <box paddingX={2} paddingTop={1} paddingBottom={1}>
          {prefix && <text fg={c.accent}>{prefix}</text>}
          <text fg={c.accent}>{">"}</text>
          <text fg={c.text}> {filter}</text>
        </box>
        <box border />
        {/* Items */}
        <box flexDirection="column" height={listH} paddingLeft={1} paddingRight={1}>
          {items.length === 0 ? (
            <text fg={c.dim}>  No matching items</text>
          ) : (
            items.slice(0, listH).map((item, i) => (
              <box key={item.id} backgroundColor={i === selected ? c.bgThink : undefined}>
                <text fg={i === selected ? c.accent : c.text}>
                  {item.label.padEnd(12)}
                </text>
                <text fg={c.dim}>{item.desc}</text>
              </box>
            ))
          )}
        </box>
        {/* Footer */}
        <box paddingX={2} paddingTop={1}>
          <text fg={c.dim}>{"\u2191\u2193"} navigate  {"\u23CE"} {footerHint || "select"}  esc {prefix ? "back" : "close"}</text>
        </box>
      </box>
    </box>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const renderer = useRenderer()
  const { width: termWidth, height: termHeight } = useTerminalDimensions()

  // -- chat state --
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

  // -- command palette state --
  const [showCmd, setShowCmd] = useState(false)
  const [cmdFilter, setCmdFilter] = useState("")
  const [cmdSelected, setCmdSelected] = useState(0)
  const [cmdView, setCmdView] = useState<"main" | "sessions">("main")

  // -- refs --
  const agentRef = useRef(
    new Agent({ model: MODEL, systemPrompt: SYSTEM_PROMPT, tools }),
  )
  const streamingIdRef = useRef<string | null>(null)
  const assistantStartTimeRef = useRef<number | null>(null)
  const assistantChunkCountRef = useRef(0)
  const currentSessionIdRef = useRef<string>(generateId())
  const agentMessagesRef = useRef<Message[] | null>(null)

  // -- auto-save sessions (debounced) --
  useEffect(() => {
    if (messages.length === 0) return
    const timer = setTimeout(() => {
      const saved = loadSessions()
      const id = currentSessionIdRef.current
      const idx = saved.findIndex((s) => s.id === id)
      const entry: SavedSession = {
        id, title: sessionTitle(messages), date: new Date().toISOString(), messages,
        agentMessages: agentMessagesRef.current ?? undefined,
      }
      if (idx >= 0) {
        saved[idx] = entry
      } else {
        saved.push(entry)
      }
      persistSessions(saved)
    }, 1500)
    return () => clearTimeout(timer)
  }, [messages])

  // -- commands --
  const openCmd = useCallback(() => {
    setSavedSessions(loadSessions())
    setShowCmd(true)
    setCmdView("main")
    setCmdFilter("")
    setCmdSelected(0)
  }, [])

  const closeCmd = useCallback(() => {
    setShowCmd(false)
  }, [])

  const execCmd = useCallback(
    (item: CmdItem) => {
      item.action()
      if (!item.navigate) closeCmd()
    },
    [closeCmd],
  )

  // -- sessions --
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(() => loadSessions())

  const currentSessions = useMemo(() => savedSessions, [savedSessions])

  const cmdItems: CmdItem[] = useMemo(() => {
    return [
      { id: "new", label: "new", desc: "New session", action: () => {
        setMessages([])
        currentSessionIdRef.current = generateId()
        setStatus("Ready")
        setDebugLines([])
        setTps(null)
        setTpsIsFallback(false)
        setElapsedMs(null)
        agentRef.current.reset()
      }},
      { id: "clear", label: "clear", desc: "Clear conversation", action: () => {
        setMessages([])
        currentSessionIdRef.current = generateId()
        setDebugLines([])
        agentRef.current.reset()
        setStatus("Cleared")
      }},
      { id: "debug", label: "debug", desc: "Toggle debug panel", action: () => setShowDebug((s) => !s) },
      { id: "sessions", label: "sessions", desc: `Browse saved conversations (${currentSessions.length})`, navigate: true, action: () => {
        setCmdView("sessions")
        setCmdFilter("")
        setCmdSelected(0)
      }},
      { id: "help", label: "help", desc: "Keyboard shortcuts", action: () => {
        setStatus("Esc quit  ·  Ctrl+L clear  ·  Ctrl+D debug  ·  Ctrl+P command palette  ·  PgUp/PgDn scroll")
        setTimeout(() => { setStatus("Ready") }, 4000)
      }},
      { id: "quit", label: "quit", desc: "Quit Spectra Chat", action: () => renderer.destroy() },
    ]
  }, [currentSessions, renderer])

  const sessionItems: CmdItem[] = useMemo(() => {
    return currentSessions.map((s) => ({
      id: s.id,
      label: `${s.date.slice(0, 10)}`,
      desc: s.title,
      action: () => {
        currentSessionIdRef.current = s.id
        agentRef.current.reset()
        if (s.agentMessages && s.agentMessages.length > 0) {
          agentRef.current.restoreHistory(s.agentMessages)
        } else {
          agentRef.current.restoreHistory(toAgentMessages(s.messages))
        }
        agentMessagesRef.current = s.agentMessages ?? null
        setMessages(s.messages)
        setStatus("Ready")
      },
    }))
  }, [currentSessions])

  const displayItems = useMemo(() => {
    return cmdView === "sessions" ? sessionItems : cmdItems
  }, [cmdView, cmdItems, sessionItems])

  const filteredItems = useMemo(() => {
    const q = cmdFilter.toLowerCase()
    if (!q) return displayItems
    return displayItems.filter(
      (item) => item.label.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q),
    )
  }, [displayItems, cmdFilter])

  // clamp selection to valid range
  useEffect(() => {
    if (cmdSelected >= filteredItems.length && filteredItems.length > 0) {
      setCmdSelected(filteredItems.length - 1)
    }
  }, [cmdSelected, filteredItems.length])

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
    // When command palette is open, handle its keys
    if (showCmd) {
      if (key.name === "escape") {
        if (cmdView === "sessions") {
          setCmdView("main")
          setCmdFilter("")
          setCmdSelected(0)
        } else {
          closeCmd()
        }
        return
      }
      if (key.name === "return" || key.name === "enter") {
        if (filteredItems.length > 0) {
          execCmd(filteredItems[cmdSelected])
        }
        return
      }
      if (key.name === "up") {
        setCmdSelected((p) => (p > 0 ? p - 1 : filteredItems.length - 1))
        return
      }
      if (key.name === "down") {
        setCmdSelected((p) => (p < filteredItems.length - 1 ? p + 1 : 0))
        return
      }
      if (key.ctrl && key.name === "p") {
        closeCmd()
        return
      }
      // Text input for search
      if (key.name === "backspace") {
        setCmdFilter((p) => p.slice(0, -1))
        setCmdSelected(0)
        return
      }
      if (key.name.length === 1 && !key.ctrl && !key.meta) {
        setCmdFilter((p) => p + key.name)
        setCmdSelected(0)
        return
      }
      return
    }

    // Normal mode keyboard
    if (key.name === "escape") {
      agentRef.current.abort()
      renderer.destroy()
      return
    }
    if (key.ctrl && key.name === "p") {
      openCmd()
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
              agentMessagesRef.current = event.messages
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
          <text fg={c.dim}>· Ctrl+P commands</text>
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
            <text fg={c.dim}>Esc to quit  ·  Ctrl+L clear  ·  Ctrl+D debug  ·  Ctrl+P commands</text>
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
                focused={!showCmd}
              />
            </box>
          </box>
        )}
      </box>

      {/* Command palette overlay */}
      {showCmd && (
        <CommandMenu
          filter={cmdFilter}
          selected={cmdSelected}
          items={filteredItems}
          termWidth={termWidth}
          termHeight={termHeight}
          prefix={cmdView === "sessions" ? "Sessions / " : undefined}
          footerHint={cmdView === "sessions" ? "load  esc back to commands" : "select"}
        />
      )}
    </box>
  )
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true })
createRoot(renderer).render(<App />)
