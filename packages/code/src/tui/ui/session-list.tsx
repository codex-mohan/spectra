import { useState, useMemo, useRef, useEffect } from "react"
import { c } from "../theme.js"
import { SessionStore } from "../../services/session-store.js"
import type { ChatMessage } from "../types.js"

export interface SessionListProps {
  store: SessionStore
  termWidth: number
  termHeight: number
  onLoad: (session: { messages: ChatMessage[]; model: string; agent: string; title: string }) => void
  onClose: () => void
  registerHandler: (fn: ((key: any) => void) | null) => void
}

export function SessionList(props: SessionListProps) {
  const { store, termWidth, termHeight, onLoad, onClose, registerHandler } = props
  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(22, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const listH = mh - 5

  const [filter, setFilter] = useState("")
  const [sel, setSel] = useState(0)
  const [mode, setMode] = useState<"list" | "confirm-delete">("list")
  const scrollRef = useRef<any>(null)

  const sessions = useMemo(() => {
    const list = store.list()
    const q = filter.toLowerCase()
    if (!q) return list
    return list.filter((s) => s.title.toLowerCase().includes(q) || s.model.toLowerCase().includes(q) || s.id.includes(q))
  }, [store, filter])

  useEffect(() => {
    registerHandler((key: any) => {
      if (key.name === "escape") { onClose(); return }
      if (key.name === "return" || key.name === "enter") {
        if (sessions.length > 0) {
          const s = sessions[sel]
          const data = store.get(s.id)
          if (!data) return
          onLoad({
            messages: data.messages as unknown as ChatMessage[],
            model: data.model,
            agent: data.agent,
            title: data.title,
          })
        }
        return
      }
      if (key.name === "up") { setSel((p) => (p > 0 ? p - 1 : sessions.length - 1)); return }
      if (key.name === "down") { setSel((p) => (p < sessions.length - 1 ? p + 1 : 0)); return }
      if (key.name === "backspace") { setFilter((p) => p.slice(0, -1)); setSel(0); return }
      if (key.name.length === 1 && !key.ctrl && !key.meta) { setFilter((p) => p + key.name); setSel(0); return }
    })
    return () => registerHandler(null)
  }, [sessions, sel, onLoad, onClose, registerHandler])

  const rows: any[] = []
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]
    const date = new Date(s.updated).toLocaleDateString()
    rows.push(
      <box key={s.id} height={1} paddingX={1}
        backgroundColor={i === sel ? c.bgSelect : c.bgCard}
        flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={i === sel ? c.accent : c.text} overflow="hidden" wrapMode="none" flexGrow={1} paddingLeft={1}>
          {s.title.slice(0, 40)}
        </text>
        <text fg={c.dim} flexShrink={0}>{date}</text>
      </box>
    )
  }

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" alignItems="center" height={1}>
          <box flexDirection="row" gap={1}>
            <text fg={c.accent}>{">"}</text>
            <text fg={c.text}>{filter || "Search sessions..."}</text>
          </box>
          <text fg={c.dim}>esc</text>
        </box>
        <box height={1} />
        <box height={1} paddingX={2}><text fg={c.border}>{"─".repeat(mw - 4)}</text></box>
        <scrollbox paddingX={1} maxHeight={listH} scrollY={true}
          verticalScrollbarOptions={{ trackOptions: { backgroundColor: c.bgCard, foregroundColor: c.bgCard } }}>
          <box flexDirection="column">
            {rows.length === 0
              ? <box height={1} paddingX={1} backgroundColor={c.bgCard}><text fg={c.dim}>No sessions</text></box>
              : rows}
          </box>
        </scrollbox>
        <box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>{"\u2191\u2193"} navigate · {"\u23CE"} load · esc close</text>
        </box>
      </box>
    </box>
  )
}
