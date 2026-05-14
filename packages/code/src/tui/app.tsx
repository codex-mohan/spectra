import { useRef, useCallback, useEffect, useMemo, useState } from "react"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { c, SPINNER } from "./theme.js"
import { ChatArea } from "./components/chat-area.js"
import { InputArea } from "./components/input-area.js"
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
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [tokPerSec, setTokPerSec] = useState<number | null>(null)
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 })
  const [selectedAgent, setSelectedAgent] = useState("build")
  const [selectedModel] = useState("anthropic/claude-sonnet-4-20250514")
  const [submitKey, setSubmitKey] = useState(0)
  const sessionStore = useRef(new SessionStore())
  const sessionId = useRef<string | null>(null)

  const provider = selectedModel.split("/")[0] || "anthropic"
  const mcpCount = 0

  // spinner animation
  useEffect(() => {
    if (!isLoading) return
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER.length), 80)
    renderer.requestLive()
    return () => { clearInterval(id); renderer.dropLive() }
  }, [isLoading, renderer])

  // keyboard — only handles global commands, NOT text input
  useKeyboard((key) => {
    if (showCmd) {
      if (key.name === "escape") { setShowCmd(false); return }
      if (key.name === "return" || key.name === "enter") {
        if (cmdFiltered.length > 0) execCmd(cmdFiltered[cmdSelected])
        return
      }
      if (key.name === "up") { setCmdSelected((p) => (p > 0 ? p - 1 : cmdFiltered.length - 1)); return }
      if (key.name === "down") { setCmdSelected((p) => (p < cmdFiltered.length - 1 ? p + 1 : 0)); return }
      if (key.name === "backspace") { setCmdFilter((p) => p.slice(0, -1)); setCmdSelected(0); return }
      if (key.ctrl && key.name === "p") { setShowCmd(false); return }
      if (key.name.length === 1 && !key.ctrl && !key.meta) { setCmdFilter((p) => p + key.name); setCmdSelected(0); return }
      return
    }

    if (key.name === "escape") { renderer.destroy(); return }
    if (key.ctrl && key.name === "p") { setShowCmd(true); setCmdFilter(""); setCmdSelected(0); return }
    if (key.ctrl && key.name === "l") {
      setMessages([]); setStatus("Cleared")
      setTimeout(() => setStatus("Ready"), 2000)
      return
    }
  })

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)))
  }, [])

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return

    setTokPerSec(null)
    setElapsed(null)

    addMessage({ id: genId(), role: "user", content: trimmed })
    setIsLoading(true)
    setStatus("Streaming...")
    if (route === "home") setRoute("chat")

    if (!sessionId.current) {
      sessionId.current = sessionStore.current.create({
        agent: selectedAgent, model: selectedModel,
      }).id
    }

    const assistantId = genId()
    addMessage({ id: assistantId, role: "assistant", content: "", blocks: [], streaming: true })
    const startTime = performance.now()
    let chunkCount = 0

    try {
      const { Agent } = await import("@singularity-ai/spectra-agent")
      const { initProviders } = await import("@singularity-ai/spectra-ai")
      initProviders()

      const agent = new Agent({
        model: { id: selectedModel, name: selectedModel, provider, api: provider },
        systemPrompt: `You are Spectra Code, an AI coding agent running on ${process.platform}.`,
      })

      for await (const event of agent.run(trimmed)) {
        switch (event.type) {
          case "message_update":
            if (event.message.role === "assistant") {
              const m = event.message as AssistantMessage
              const blocks = getMessageBlocks(m)
              const text = blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n")
              updateMessage(assistantId, { content: text, blocks })
              if (event.assistantMessageEvent.type === "text_delta" || event.assistantMessageEvent.type === "thinking_delta") {
                chunkCount++
              }
            }
            break
          case "message_end":
            if (event.message.role === "assistant") {
              const m = event.message as AssistantMessage
              const blocks = getMessageBlocks(m)
              const text = blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n")
              updateMessage(assistantId, { content: text, blocks, streaming: false })
              const elapsedMs = performance.now() - startTime
              setElapsed(elapsedMs)
              const outputTokens = m.usage.output
              if (outputTokens > 0 && elapsedMs > 0) setTokPerSec(outputTokens / (elapsedMs / 1000))
              setTokenUsage((p) => ({ input: p.input + m.usage.input, output: p.output + outputTokens }))
            }
            break
          case "tool_execution_start":
            addMessage({ id: genId(), role: "tool", content: "", meta: `${event.toolName}(${JSON.stringify(event.args)})` })
            break
          case "agent_end":
            setStatus("Ready")
            break
        }
      }
    } catch (err) {
      updateMessage(assistantId, { content: `Error: ${err instanceof Error ? err.message : String(err)}`, streaming: false, role: "error" })
      setStatus("Error")
    } finally {
      setIsLoading(false)
      setSubmitKey((k) => k + 1)
    }
  }, [isLoading, route, selectedAgent, selectedModel, provider, addMessage, updateMessage])

  // commands
  const cmdItems: CmdItem[] = useMemo(() => [
    { id: "new", label: "new session", desc: "Start a fresh conversation", action: () => {
      setMessages([]); sessionId.current = null; setRoute("home"); setStatus("Ready"); setElapsed(null); setTokPerSec(null)
    }},
    { id: "home", label: "go home", desc: "Return to home screen", action: () => { setRoute("home") }},
    { id: "clear", label: "clear", desc: "Clear conversation", action: () => { setMessages([]); setStatus("Cleared") }},
    { id: "agent-build", label: "agent: build", desc: "Full tool access", action: () => { setSelectedAgent("build") }},
    { id: "agent-plan", label: "agent: plan", desc: "Planning mode, limited tools", action: () => { setSelectedAgent("plan") }},
    { id: "agent-debug", label: "agent: debug", desc: "Investigation mode", action: () => { setSelectedAgent("debug") }},
    { id: "agent-explore", label: "agent: explore", desc: "Codebase exploration", action: () => { setSelectedAgent("explore") }},
    { id: "doctor", label: "doctor", desc: "Run health check", action: () => { renderer.destroy(); import("../commands/doctor.js").then((m) => m.doctorCommand.handler({} as never)) }},
    { id: "help", label: "help", desc: "Show keyboard shortcuts", action: () => {
      setStatus("Esc quit · Ctrl+P commands · Ctrl+L clear")
      setTimeout(() => setStatus("Ready"), 4000)
    }},
    { id: "quit", label: "quit", desc: "Exit Spectra Code", action: () => renderer.destroy() },
  ], [renderer])

  const cmdFiltered = useMemo(() => {
    const q = cmdFilter.toLowerCase()
    return !q ? cmdItems : cmdItems.filter((i) => i.label.includes(q) || i.desc.includes(q))
  }, [cmdItems, cmdFilter])

  const execCmd = useCallback((item: CmdItem) => { item.action(); setShowCmd(false) }, [])

  useEffect(() => {
    if (cmdSelected >= cmdFiltered.length && cmdFiltered.length > 0) setCmdSelected(cmdFiltered.length - 1)
  }, [cmdSelected, cmdFiltered.length])

  const statusColor = status === "Error" ? c.error : status === "Ready" ? c.success : c.warn

  return (
    <box flexDirection="column" height={termHeight}>
      {/* Header bar */}
      <box backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}
        flexDirection="row" justifyContent="space-between" height={2}>
        <box flexDirection="row" gap={1}>
          <text fg={c.accent}><strong>Spectra Code</strong></text>
          {elapsed !== null && <text fg={c.dim}>({(elapsed / 1000).toFixed(1)}s)</text>}
          {tokPerSec !== null && <text fg={c.info}>{tokPerSec.toFixed(0)} t/s</text>}
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={statusColor}>{status}</text>
          <text fg={c.dim}>· Ctrl+P</text>
        </box>
      </box>

      {/* Main content */}
      {route === "home" ? (
        <box flexDirection="column" flexGrow={1} backgroundColor={c.bg}
          alignItems="center" justifyContent="center" padding={4}>
          <text fg={c.accent}><strong>Spectra Code</strong></text>
          <box height={1} />
          <text fg={c.dim}>AI coding agent in your terminal</text>
          <box height={2} />
          <box flexDirection="row" gap={4}>
            {[
              { val: sessionStore.current.list().length, label: "sessions" },
              { val: 3, label: "agents" },
              { val: 7, label: "tools" },
              { val: mcpCount, label: "MCP" },
            ].map((s) => (
              <box key={s.label} flexDirection="column" alignItems="center">
                <text fg={c.text}>{s.val}</text>
                <text fg={c.dim}>{s.label}</text>
              </box>
            ))}
          </box>
          <box height={2} />
          <text fg={c.dim}>Type a message and press Enter</text>
          <text fg={c.dim}>Esc to quit · Ctrl+P commands</text>
        </box>
      ) : (
        <box flexDirection="column" flexGrow={1} backgroundColor={c.bg}>
          <ChatArea messages={messages} />
        </box>
      )}

      {/* Input + footer */}
      <InputArea
        isLoading={isLoading}
        agent={selectedAgent}
        model={selectedModel}
        provider={provider}
        mcpCount={mcpCount}
        elapsedMs={elapsed}
        tokenUsage={tokenUsage}
        cwd={process.cwd()}
        route={route}
        spinnerFrame={spinnerFrame}
        onSubmit={handleSubmit}
        inputKey={submitKey}
      />

      {/* Command palette overlay */}
      {showCmd && (
        <CommandPalette
          filter={cmdFilter}
          selected={cmdSelected}
          items={cmdFiltered}
          termWidth={termWidth}
          termHeight={termHeight}
        />
      )}
    </box>
  )
}

// --- helpers ---

function genId(): string {
  return Math.random().toString(36).slice(2, 9)
}

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
