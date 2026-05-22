import { useState, useMemo, useRef, useEffect } from "react"
import { c } from "../theme.js"
import { SessionStore } from "../../services/session-store.js"
import type { ChatMessage } from "../types.js"

export interface SessionListProps {
  store: SessionStore
  termWidth: number
  termHeight: number
  mode?: "load" | "delete" | "rename"
  onLoad?: (session: { id: string; messages: ChatMessage[]; model: string; provider: string; agent: string; title: string }) => void
  onDelete?: (id: string) => void
  onRename?: (id: string, title: string) => void
  onClose: () => void
  registerHandler: (fn: ((key: any) => void) | null) => void
}

export function SessionList(props: SessionListProps) {
  const { store, termWidth, termHeight, mode = "load", onLoad, onDelete, onRename, onClose, registerHandler } = props
  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(22, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const listH = mh - 5

  const [filter, setFilter] = useState("")
  const [sel, setSel] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renameInput, setRenameInput] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const scrollRef = useRef<any>(null)

  const sessions = useMemo(() => {
    const list = store.list()
    const q = filter.toLowerCase()
    if (!q) return list
    return list.filter((s) => s.title.toLowerCase().includes(q) || s.model.toLowerCase().includes(q) || s.id.includes(q))
  }, [store, filter, refreshKey])

  useEffect(() => {
    if (!scrollRef.current || !sessions[sel]) return
    const el = scrollRef.current
    if (typeof el.scrollChildIntoView === "function") {
      el.scrollChildIntoView(sessions[sel].id)
    } else {
      const child = el.getChildren?.()?.find?.((ch: any) => ch.id === sessions[sel].id)
      if (child) {
        const y = child.y - (el.y || 0)
        if (y >= (el.height || listH)) el.scrollBy?.(y - (el.height || listH) + 1)
        if (y < 0) el.scrollBy?.(y)
      }
    }
  }, [sel, sessions, listH])

  useEffect(() => {
    registerHandler((key: any) => {
      if (key.name === "escape") {
        if (confirmDelete) { setConfirmDelete(false); return }
        if (mode === "rename" && renameInput) { setRenameInput(""); return }
        onClose(); return
      }
      if (key.name === "return" || key.name === "enter") {
        if (mode === "rename") {
          if (renameInput && sessions.length > 0) {
            const s = sessions[sel]
            onRename?.(s.id, renameInput)
            setRenameInput("")
            setRefreshKey((k) => k + 1)
          }
          return
        }
        if (mode === "delete") {
          if (confirmDelete && sessions.length > 0) {
            const s = sessions[sel]
            onDelete?.(s.id)
            setConfirmDelete(false)
            setFilter("")
            setSel(0)
            setRefreshKey((k) => k + 1)
          } else if (!confirmDelete && sessions.length > 0) {
            setConfirmDelete(true)
          }
          return
        }
        // Load mode
        if (sessions.length > 0) {
          const s = sessions[sel]
          const data = store.get(s.id)
          if (!data) return
          onLoad?.({
            id: s.id,
            messages: data.messages as unknown as ChatMessage[],
            model: data.model, provider: data.provider,
            agent: data.agent, title: data.title,
          })
        }
        return
      }
      if (mode === "rename") {
        if (key.name === "backspace") { setRenameInput((p) => p.slice(0, -1)); return }
        if (key.name.length === 1 && !key.ctrl && !key.meta) { setRenameInput((p) => p + key.name); return }
        return
      }
      if (key.name === "up") { setSel((p) => (p > 0 ? p - 1 : sessions.length - 1)); return }
      if (key.name === "down") { setSel((p) => (p < sessions.length - 1 ? p + 1 : 0)); return }
      if (key.name === "backspace") { setFilter((p) => p.slice(0, -1)); setSel(0); return }
      if (key.name.length === 1 && !key.ctrl && !key.meta) { setFilter((p) => p + key.name); setSel(0); return }
    })
    return () => registerHandler(null)
  }, [sessions, sel, confirmDelete, mode, renameInput, onLoad, onDelete, onRename, onClose, registerHandler])

  const rows: any[] = []
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]
    const date = new Date(s.updated).toLocaleDateString()
    const isSelected = i === sel
    rows.push(
      <box key={s.id} id={s.id} height={1} paddingX={1}
        backgroundColor={isSelected ? c.bgSelect : c.bgCard}
        flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={isSelected ? c.accent : c.text} overflow="hidden" wrapMode="none" flexGrow={1} paddingLeft={1}>
          {s.title.slice(0, 40)}
        </text>
        <text fg={c.dim} flexShrink={0}>{date}</text>
      </box>
    )
  }

  const title = mode === "delete" ? (confirmDelete ? "Delete session" : "Delete session") : mode === "rename" ? "Rename session" : "Sessions"
  const hint = mode === "delete"
    ? (confirmDelete ? `Delete "${sessions[sel]?.title.slice(0, 30)}"? enter confirm · esc cancel` : "↑↓ navigate · enter select to delete · esc close")
    : mode === "rename"
    ? (renameInput ? `enter confirm · esc cancel` : "↑↓ navigate · enter select to rename · esc close")
    : "↑↓ navigate · enter load · esc close"

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" alignItems="center" height={1}>
          <box flexDirection="row" gap={1}>
            <text fg={mode === "delete" ? c.error : mode === "rename" ? c.warn : c.accent}>{">"}</text>
            <text fg={c.text}>
              {mode === "rename"
                ? (renameInput || (sessions[sel]?.title.slice(0, 40) || "New title..."))
                : (filter || "Search sessions...")}
            </text>
          </box>
          <box flexDirection="row" height={1}>
            <text fg={c.dim}>esc</text>
          </box>
        </box>
        <box height={1} />
        <box height={1} paddingX={2}><text fg={c.border}>{"─".repeat(mw - 4)}</text></box>
        <scrollbox ref={(r: any) => { scrollRef.current = r }} paddingX={1} maxHeight={listH} scrollY={true}
          scrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            {rows.length === 0
              ? <box height={1} paddingX={1} backgroundColor={c.bgCard}><text fg={c.dim}>No sessions</text></box>
              : rows}
          </box>
        </scrollbox>
        <box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="center">
          <text fg={mode === "delete" ? c.error : c.dim}>{hint}</text>
        </box>
      </box>
    </box>
  )
}
