import { useRef, useCallback, useEffect, useMemo, useState } from "react"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { c, SPINNER } from "./theme.js"
import { ChatArea } from "./components/chat-area.js"
import { CommandPalette, type CmdItem } from "./components/command-palette.js"
import { SessionStore } from "../services/session-store.js"
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "@singularity-ai/spectra-ai"

export function App({ renderer }: { renderer: CliRenderer }) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions()
  const [route, setRoute] = useState<"home" | "chat">("home")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState("Ready")
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [showCmd, setShowCmd] = useState(false)
  const [cmdFilter, setCmdFilter] = useState("")
  const [cmdSelected, setCmdSelected] = useState(0)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [tokPerSec, setTokPerSec] = useState<number | null>(null)
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 })
  const [selectedAgent, setSelectedAgent] = useState("build")
  const [selectedModel] = useState("anthropic/claude-sonnet-4-20250514")
  const [submitKey, setSubmitKey] = useState(0)
  const sessionStore = useRef(new SessionStore())
  const sessionId = useRef<string | null>(null)

  const provider = selectedModel.split("/")[0]
  const mcpCount = 0
  const hasProviders = true

  // spinner
  useEffect(() => {
    if (!isLoading) return
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER.length), 80)
    renderer.requestLive()
    return () => { clearInterval(id); renderer.dropLive() }
  }, [isLoading, renderer])

  // keyboard
  useKeyboard((key) => {
    if (showCmd) {
      if (key.name === "escape" || (key.ctrl && key.name === "p")) { setShowCmd(false); return }
      if (key.name === "return" || key.name === "enter") {
        if (cmdFiltered.length > 0) { execCmd(cmdFiltered[cmdSelected]); return }
        return
      }
      if (key.name === "up") { setCmdSelected((p) => (p > 0 ? p - 1 : cmdFiltered.length - 1)); return }
      if (key.name === "down") { setCmdSelected((p) => (p < cmdFiltered.length - 1 ? p + 1 : 0)); return }
      if (key.name === "backspace") { setCmdFilter((p) => p.slice(0, -1)); setCmdSelected(0); return }
      if (key.name.length === 1 && !key.ctrl && !key.meta) { setCmdFilter((p) => p + key.name); setCmdSelected(0); return }
      return
    }
    if (key.name === "escape") { renderer.destroy(); return }
    if (key.ctrl && key.name === "p") { setShowCmd(true); setCmdFilter(""); setCmdSelected(0); return }
    if (key.ctrl && key.name === "l") { setMessages([]); setStatus("Cleared"); setTimeout(() => setStatus("Ready"), 2000); return }
  })

  const addMessage = useCallback((msg: ChatMessage) => setMessages((p) => [...p, msg]), [])
  const updateMessage = useCallback((id: string, u: Partial<ChatMessage>) => setMessages((p) => p.map((m) => (m.id === id ? { ...m, ...u } : m))), [])

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    setTokPerSec(null); setElapsedMs(null)
    addMessage({ id: genId(), role: "user", content: trimmed })
    setIsLoading(true); setStatus("Streaming..."); setRoute("chat")
    if (!sessionId.current) sessionId.current = sessionStore.current.create({ agent: selectedAgent, model: selectedModel }).id
    const aid = genId()
    addMessage({ id: aid, role: "assistant", content: "", blocks: [], streaming: true })
    const start = performance.now()
    let chunks = 0
    try {
      const { Agent } = await import("@singularity-ai/spectra-agent")
      const { initProviders } = await import("@singularity-ai/spectra-ai")
      initProviders()
      const agent = new Agent({
        model: { id: selectedModel, name: selectedModel, provider, api: provider },
        systemPrompt: `You are Spectra Code, an AI coding agent running on ${process.platform}.`,
      })
      for await (const ev of agent.run(trimmed)) {
        if (ev.type === "message_update" && ev.message.role === "assistant") {
          const m = ev.message as AssistantMessage
          const blocks = getMessageBlocks(m)
          const t = blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n")
          updateMessage(aid, { content: t, blocks })
          if (ev.assistantMessageEvent.type === "text_delta" || ev.assistantMessageEvent.type === "thinking_delta") chunks++
        }
        if (ev.type === "message_end" && ev.message.role === "assistant") {
          const m = ev.message as AssistantMessage
          const blocks = getMessageBlocks(m)
          const t = blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n")
          updateMessage(aid, { content: t, blocks, streaming: false })
          const e = performance.now() - start; setElapsedMs(e)
          const ot = m.usage.output
          if (ot > 0 && e > 0) setTokPerSec(ot / (e / 1000))
          setTokenUsage((p) => ({ input: p.input + m.usage.input, output: p.output + ot }))
        }
        if (ev.type === "tool_execution_start") addMessage({ id: genId(), role: "tool", content: "", meta: `${ev.toolName}(${JSON.stringify(ev.args)})` })
        if (ev.type === "agent_end") setStatus("Ready")
      }
    } catch (err) {
      updateMessage(aid, { content: `Error: ${err instanceof Error ? err.message : String(err)}`, streaming: false, role: "error" })
      setStatus("Error")
    } finally {
      setIsLoading(false)
      setSubmitKey((k) => k + 1)
    }
  }, [isLoading, selectedAgent, selectedModel, provider, addMessage, updateMessage])

  // commands
  const cmdItems: CmdItem[] = useMemo(() => [
    { id: "new", label: "new session", desc: "Start a fresh conversation", cat: "Session", action: () => { setMessages([]); sessionId.current = null; setRoute("home"); setStatus("Ready"); setElapsedMs(null); setTokPerSec(null) }},
    { id: "sessions", label: "list sessions", desc: "Browse saved conversations", cat: "Session", action: () => {
      const list = sessionStore.current.list()
      setStatus(list.length ? `Sessions: ${list.map(s => s.title).join(", ")}` : "No saved sessions")
      setTimeout(() => setStatus("Ready"), 5000)
    }},
    { id: "home", label: "go home", desc: "Return to home screen", cat: "Navigation", action: () => { setRoute("home") }},
    { id: "clear", label: "clear", desc: "Clear conversation", cat: "Session", action: () => { setMessages([]); setStatus("Cleared") }},
    { id: "agent-build", label: "build agent", desc: "Default — full tool access", cat: "Agent", action: () => { setSelectedAgent("build") }},
    { id: "agent-plan", label: "plan agent", desc: "Planning mode, limited tools", cat: "Agent", action: () => { setSelectedAgent("plan") }},
    { id: "agent-debug", label: "debug agent", desc: "Investigation mode", cat: "Agent", action: () => { setSelectedAgent("debug") }},
    { id: "agent-explore", label: "explore agent", desc: "Codebase exploration", cat: "Agent", action: () => { setSelectedAgent("explore") }},
    { id: "doctor", label: "doctor", desc: "Run system health check", cat: "System", action: () => { renderer.destroy(); import("../commands/doctor.js").then((m) => m.doctorCommand.handler({} as never)) }},
    { id: "theme", label: "toggle theme", desc: "Switch dark/light mode", cat: "Settings", action: () => { setStatus("Theme toggled"); setTimeout(() => setStatus("Ready"), 2000) }},
    { id: "help", label: "help", desc: "Show keyboard shortcuts", cat: "System", action: () => {
      setStatus("Esc quit · Ctrl+P palette · Ctrl+L clear")
      setTimeout(() => setStatus("Ready"), 4000)
    }},
    { id: "quit", label: "quit", desc: "Exit Spectra Code", cat: "System", action: () => renderer.destroy() },
  ], [renderer])

  const cmdFiltered = useMemo(() => {
    const q = cmdFilter.toLowerCase()
    return !q ? cmdItems : cmdItems.filter((i) => i.label.includes(q) || i.desc.includes(q) || (i.cat && i.cat.toLowerCase().includes(q)))
  }, [cmdItems, cmdFilter])

  const execCmd = useCallback((item: CmdItem) => { item.action(); setShowCmd(false) }, [])

  useEffect(() => { if (cmdSelected >= cmdFiltered.length && cmdFiltered.length > 0) setCmdSelected(cmdFiltered.length - 1) }, [cmdSelected, cmdFiltered.length])

  return (
    <box flexDirection="column" height={termHeight} backgroundColor={c.bg}>
      {/* === HOME === */}
      {route === "home" ? (
        <>
          {/* Top spacer */}
          <box flexGrow={1} />

          {/* Center content */}
          <box flexDirection="column" alignItems="center" flexGrow={2}>
            {/* ASCII Banner */}
            <ascii-font text="SPECTRA" font="block" color={c.accent} />

            <box height={3} />

            {/* Shared prompt bar */}
            <box marginTop={1} marginBottom={1}>
              <PromptBar
                isLoading={isLoading}
                spinnerFrame={spinnerFrame}
                submitKey={submitKey}
                placeholder="Ask anything..."
                onSubmit={handleSubmit}
                agent={selectedAgent}
                model={selectedModel}
                provider={provider}
                width={Math.min(68, termWidth - 8)}
              />
            </box>

            <box height={2} />

            {/* Hints */}
            <box flexDirection="row" gap={4}>
              <text fg={c.dim}>tab agents</text>
              <text fg={c.dim}>ctrl+p commands</text>
            </box>

            <box height={2} />

            {/* Stats with icons */}
            <box flexDirection="row" gap={4} alignItems="center">
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={c.accent}>◈</text>
                <text fg={c.dim}>{sessionStore.current.list().length} sessions</text>
              </box>
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={c.accent}>◉</text>
                <text fg={c.dim}>3 agents</text>
              </box>
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={c.accent}>◆</text>
                <text fg={c.dim}>7 tools</text>
              </box>
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={c.accent}>⬢</text>
                <text fg={c.dim}>{mcpCount} MCP</text>
              </box>
            </box>
          </box>

          <box flexGrow={1} />

          {/* Tip row */}
          <box flexDirection="row" justifyContent="center" alignItems="center" gap={1} height={1}>
            <text fg={c.warn}>●</text>
            <text fg={c.dim}>Tip: Press ctrl+p to open commands</text>
          </box>

          <box height={1} />

          {/* Bottom status bar */}
          <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} height={1} marginBottom={1}>
            <text fg={c.dim}>~  {mcpCount} MCP /status</text>
            <text fg={c.dim}>Spectra Code</text>
          </box>
        </>
      ) : (
        /* === CHAT === */
        <>
          {/* Messages */}
          <box flexDirection="column" flexGrow={1}>
            <ChatArea messages={messages} />
          </box>

          {/* Shared prompt bar */}
          <box marginTop={1} marginBottom={1}>
            <PromptBar
              isLoading={isLoading}
              spinnerFrame={spinnerFrame}
              submitKey={submitKey}
              placeholder="Reply..."
              onSubmit={handleSubmit}
              agent={selectedAgent}
              model={selectedModel}
              provider={provider}
              elapsedMs={elapsedMs}
              tokenUsage={tokenUsage}
            />
          </box>
        </>
      )}

      {/* Command palette overlay */}
      {showCmd && (
        <CommandPalette filter={cmdFilter} selected={cmdSelected} items={cmdFiltered}
          termWidth={termWidth} termHeight={termHeight} />
      )}
    </box>
  )
}

/* ------------------------------------------------------------------ */
/* Shared Prompt Bar — used by both home and chat                     */
/* ------------------------------------------------------------------ */

interface PromptBarProps {
  isLoading: boolean
  spinnerFrame: number
  submitKey: number
  placeholder: string
  onSubmit: (text: string) => void
  agent: string
  model: string
  provider: string
  width?: number
  elapsedMs?: number | null
  tokenUsage?: { input: number; output: number }
}

function PromptBar(props: PromptBarProps) {
  const { isLoading, spinnerFrame, submitKey, placeholder, onSubmit, agent, model, provider, width, elapsedMs, tokenUsage } = props

  return (
    <box flexDirection="row" alignItems="center" backgroundColor={c.bgBar} paddingLeft={1} paddingRight={2} paddingTop={1} paddingBottom={1} width={width}>
      {/* Left accent bar */}
      <box width={1} backgroundColor={c.accent} height={3} />

      <box flexDirection="column" flexGrow={1} paddingLeft={1}>
        {/* Input row */}
        <box flexDirection="row" alignItems="center" height={1}>
          {isLoading ? (
            <text fg={c.warn}>{SPINNER[spinnerFrame]}  Thinking...</text>
          ) : (
            <box flexDirection="row" flexGrow={1} alignItems="center" gap={1}>
              <text fg={c.accent}>›</text>
              <box flexGrow={1}>
                <input key={submitKey} placeholder={placeholder} onSubmit={(v) => onSubmit(String(v))} focused={true} />
              </box>
            </box>
          )}
        </box>

        {/* Spacer between input and meta */}
        <box height={1} />

        {/* Meta row */}
        <box flexDirection="row" justifyContent="space-between" alignItems="center" height={1}>
          <box flexDirection="row" gap={2} alignItems="center">
            <text fg={c.accent}>{agent}</text>
            <text fg={c.dim}>{model}</text>
            <text fg={c.subtext}>{provider}</text>
          </box>
          {tokenUsage && (
            <box flexDirection="row" gap={1}>
              {elapsedMs !== null && elapsedMs !== undefined && <text fg={c.dim}>{(elapsedMs / 1000).toFixed(1)}s</text>}
              <text fg={c.dim}>↑{tokenUsage.input} ↓{tokenUsage.output}</text>
            </box>
          )}
        </box>
      </box>
    </box>
  )
}

function genId(): string { return Math.random().toString(36).slice(2, 9) }

type ContentBlock =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "toolCall"; name: string; args: string }

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "tool" | "error"
  content: string
  blocks?: ContentBlock[]
  meta?: string
  streaming?: boolean
}

function getMessageBlocks(msg: AssistantMessage): ContentBlock[] {
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
