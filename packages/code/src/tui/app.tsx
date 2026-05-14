import { useRef, useCallback, useEffect, useMemo, useState } from "react"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { c, SPINNER } from "./theme.js"
import { ChatArea } from "./components/chat-area.js"
import { CommandPalette, type CmdItem } from "./components/command-palette.js"
import { SessionStore } from "../services/session-store.js"
import type { AssistantMessage, TextContent, ThinkingContent, ToolCall } from "@singularity-ai/spectra-ai"

export function App({ renderer }: { renderer: CliRenderer }) {
  const { height: termHeight } = useTerminalDimensions()
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

  const statusColor = status === "Error" ? c.error : status === "Ready" ? c.success : c.warn

  return (
    <box flexDirection="column" height={termHeight} backgroundColor={c.bg}>
      {/* === HOME === */}
      {route === "home" ? (
        <>
          {/* Spacer */}
          <box flexGrow={1} />

          {/* Greeting */}
          <box flexDirection="column" alignItems="center">
            <text fg={c.accent}><strong>Spectra Code</strong></text>
            <text fg={c.dim}>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</text>
          </box>

          <box height={2} />

          {/* Stats */}
          <box flexDirection="row" gap={6} justifyContent="center">
            {[
              { val: String(sessionStore.current.list().length), label: "sessions" },
              { val: "3", label: "agents" },
              { val: "7", label: "tools" },
              { val: String(mcpCount), label: "MCP" },
            ].map((s) => (
              <box key={s.label} flexDirection="column" alignItems="center">
                <text fg={c.text}>{s.val}</text>
                <text fg={c.dim}>{s.label}</text>
              </box>
            ))}
          </box>

          {/* Fill space before input */}
          <box flexGrow={1} />

          {/* Input area — fixed at bottom */}
          <box flexDirection="column">
            <UnderConstructionInput />

            <box backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={0}
              flexDirection="row" alignItems="center" height={3}>
              {isLoading ? (
                <text fg={c.warn}>{SPINNER[spinnerFrame]}  Thinking...</text>
              ) : (
                <box flexDirection="row" flexGrow={1} alignItems="center">
                  <text fg={c.accent}>›</text>
                  <box marginLeft={1} flexGrow={1}>
                    <input key={`h-${submitKey}`} placeholder="Type a message..." onSubmit={(v) => handleSubmit(String(v))} focused={true} />
                  </box>
                </box>
              )}
            </box>

            <box backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={0} paddingBottom={1}
              flexDirection="row" justifyContent="space-between" height={2}>
              <box flexDirection="row" gap={2} alignItems="center">
                <text fg={c.accent}>{selectedAgent}</text>
                <text fg={c.dim}>{selectedModel}</text>
                <text fg={c.subtext}>{provider}</text>
              </box>
              <text fg={c.dim}>{mcpCount} MCP</text>
            </box>

            {/* Footer */}
            <box backgroundColor={c.bg} paddingLeft={2} paddingRight={2} height={1}
              flexDirection="row" justifyContent="space-between">
              <text fg={c.dim}>{process.cwd()}</text>
              <text fg={c.dim}>Ctrl+P: commands</text>
            </box>
          </box>
        </>
      ) : (
        /* === CHAT === */
        <>
          {/* Messages */}
          <box flexDirection="column" flexGrow={1}>
            <ChatArea messages={messages} />
          </box>

          {/* Input — 2 rows + footer at bottom */}
          <box flexDirection="column">
            <box backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={0}
              flexDirection="row" alignItems="center" height={3}>
              {isLoading ? (
                <text fg={c.warn}>{SPINNER[spinnerFrame]}  Thinking...</text>
              ) : (
                <box flexDirection="row" flexGrow={1} alignItems="center">
                  <text fg={c.accent}>›</text>
                  <box marginLeft={1} flexGrow={1}>
                    <input key={`c-${submitKey}`} placeholder="Reply..." onSubmit={(v) => handleSubmit(String(v))} focused={true} />
                  </box>
                </box>
              )}
            </box>

            {/* Row 2: agent left, tokens right */}
            <box backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={0} paddingBottom={1}
              flexDirection="row" justifyContent="space-between" height={2}>
              <box flexDirection="row" gap={2} alignItems="center">
                <text fg={c.accent}>{selectedAgent}</text>
                <text fg={c.dim}>{selectedModel}</text>
                <text fg={c.subtext}>{provider}</text>
              </box>
              <box flexDirection="row" gap={1}>
                {elapsedMs !== null && <text fg={c.dim}>{(elapsedMs / 1000).toFixed(1)}s</text>}
                <text fg={c.dim}>↑{tokenUsage.input} ↓{tokenUsage.output}</text>
              </box>
            </box>

            {/* Footer */}
            <box backgroundColor={c.bg} paddingLeft={2} paddingRight={2} height={1}
              flexDirection="row" justifyContent="space-between">
              <text fg={c.dim}>{process.cwd()}</text>
              <text fg={c.dim}>↑{tokenUsage.input + tokenUsage.output} context</text>
            </box>
          </box>
        </>
      )}

      {/* Command palette overlay */}
      {showCmd && (
        <CommandPalette filter={cmdFilter} selected={cmdSelected} items={cmdFiltered}
          termWidth={100} termHeight={termHeight} />
      )}
    </box>
  )
}

function UnderConstructionInput() {
  return null
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
