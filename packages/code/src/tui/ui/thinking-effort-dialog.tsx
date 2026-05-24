import { useState, useEffect, useMemo, useRef } from "react"
import { c } from "../theme.js"
import { getProviderEfforts, getEffortLabel } from "../variant-cycle.js"

export interface ThinkingEffortDialogProps {
  provider: string | null
  currentEffort?: string
  termWidth: number; termHeight: number
  onEffortSelected: (effort: string) => void
  onClose: () => void
  registerHandler: (fn: ((key: any) => void) | null) => void
}

export function ThinkingEffortDialog(props: ThinkingEffortDialogProps) {
  const { provider, currentEffort, termWidth, termHeight, onEffortSelected, onClose, registerHandler } = props
  const [filter, setFilter] = useState("")
  const [sel, setSel] = useState(0)
  const scrollRef = useRef<any>(null)

  const mw = Math.min(52, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(18, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const innerW = mw - 4
  const listH = mh - 6

  const efforts = useMemo(() => {
    if (!provider) return [{ effort: "none", label: "off" }]
    return getProviderEfforts(provider).map((e) => ({
      effort: e,
      label: getEffortLabel(e),
    }))
  }, [provider])

  const filtered = useMemo(() => {
    if (!filter) return efforts.map((e, idx) => ({ ...e, idx }))
    const q = filter.toLowerCase()
    return efforts
      .map((e, idx) => ({ ...e, idx }))
      .filter((e) => e.label.includes(q) || e.effort.includes(q))
  }, [efforts, filter])

  useEffect(() => {
    registerHandler((key: any) => {
      if (key.name === "up") { setSel((s) => Math.max(0, s - 1)); return }
      if (key.name === "down") { setSel((s) => Math.min(filtered.length - 1, s + 1)); return }
      if (key.name === "return" || key.name === "enter") {
        if (filtered[sel]) onEffortSelected(filtered[sel].effort); return
      }
      if (key.name === "escape") { onClose(); return }
      if (key.name === "backspace") { setFilter((f) => f.slice(0, -1)); setSel(0); return }
      if (key.name?.length === 1) { setFilter((f) => f + key.name); setSel(0); return }
    })
    return () => registerHandler(null)
  }, [filtered, sel, onEffortSelected, onClose, registerHandler])

  useEffect(() => {
    if (scrollRef.current && filtered[sel]) {
      const el = scrollRef.current
      if (typeof el.scrollChildIntoView === "function") {
        el.scrollChildIntoView(`effort-${filtered[sel].effort}`)
      }
    }
  }, [sel, filtered])

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box height={1} paddingX={2} paddingTop={1}
          flexDirection="row" justifyContent="space-between" alignItems="center">
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={c.accent}>{">"}</text>
            <text fg={c.text}>{filter || "Type to filter thinking effort..."}</text>
          </box>
          <box height={1}><text fg={c.dim}>esc</text></box>
        </box>
        <box height={1} />
        <box height={1} paddingX={2}>
          <text fg={c.border}>{"─".repeat(innerW)}</text>
        </box>
        <scrollbox ref={(r: any) => { scrollRef.current = r }}
          paddingX={1} maxHeight={listH} scrollY={true} scrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            {filtered.length === 0 ? (
              <box height={1} paddingX={1}><text fg={c.dim}>No matching efforts</text></box>
            ) : filtered.map((item, i) => {
              const isSelected = i === sel
              const isCurrent = item.effort === (currentEffort || "none")
              const effortVal = item.effort === "none" ? "off" : item.effort
              return (
                <box key={item.effort} id={`effort-${item.effort}`} height={1} paddingLeft={2} paddingRight={1}
                  backgroundColor={isSelected ? c.bgSelect : c.bgCard}
                  flexDirection="row" alignItems="center" gap={1}>
                  <text fg={isCurrent ? c.accent : c.dim}>{isCurrent ? "●" : " "}</text>
                  <text fg={isSelected ? c.accent : isCurrent ? c.text : c.dim}>{effortVal}</text>
                </box>
              )
            })}
          </box>
        </scrollbox>
        <box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>{"\u2191\u2193"} navigate · {"\u23CE"} select · esc close</text>
        </box>
      </box>
    </box>
  )
}
