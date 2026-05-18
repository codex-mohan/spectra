import { useState, useEffect, useMemo, useRef } from "react"
import { c } from "../theme.js"
import { getModels } from "@singularity-ai/spectra-ai"

export interface ModelSwitcherProps {
  providerId: string
  termWidth: number; termHeight: number
  onModelSelected: (modelId: string, providerId: string) => void
  onClose: () => void
  registerHandler: (fn: ((key: any) => void) | null) => void
}

export function ModelSwitcher(props: ModelSwitcherProps) {
  const { providerId, termWidth, termHeight, onModelSelected, onClose, registerHandler } = props
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [filter, setFilter] = useState("")
  const [sel, setSel] = useState(0)
  const scrollRef = useRef<any>(null)

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    if (!q) return models
    return models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
  }, [filter, models])

  useEffect(() => {
    getModels(providerId).then((m) => { setModels(m); setSel(0) })
  }, [providerId])

  useEffect(() => {
    registerHandler((key: any) => {
      if (key.name === "escape") { onClose(); return }
      if (key.name === "return" || key.name === "enter") {
        if (filtered.length > 0 && filtered[sel]) { onModelSelected(filtered[sel].id, providerId); onClose(); return }
        return
      }
      if (key.name === "up") { setSel((p) => (p > 0 ? p - 1 : filtered.length - 1)); return }
      if (key.name === "down") { setSel((p) => (p < filtered.length - 1 ? p + 1 : 0)); return }
      if (key.name === "backspace") { setFilter((p) => p.slice(0, -1)); setSel(0); return }
      if (key.name.length === 1 && !key.ctrl && !key.meta) { setFilter((p) => p + key.name); setSel(0); return }
    })
    return () => registerHandler(null)
  }, [filtered, sel, providerId, onModelSelected, onClose, registerHandler])

  useEffect(() => {
    const el = scrollRef.current
    if (el && typeof el.scrollChildIntoView === "function" && filtered[sel]) {
      el.scrollChildIntoView(filtered[sel].id)
    }
  }, [sel, filtered])

  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(22, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const listH = mh - 5

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" alignItems="center" height={1}>
          <box flexDirection="row" gap={1}>
            <text fg={c.accent}>{">"}</text>
            <text fg={c.text}>{filter || `Search ${providerId} models...`}</text>
          </box>
          <text fg={c.dim}>esc</text>
        </box>
        <box height={1} />
        <box height={1} paddingX={2}><text fg={c.border}>{"─".repeat(mw - 4)}</text></box>
        <scrollbox ref={(r: any) => { scrollRef.current = r }}
          paddingX={1} maxHeight={listH} scrollY={true}
          verticalScrollbarOptions={{ trackOptions: { backgroundColor: c.bgCard, foregroundColor: c.bgCard } }}>
          <box flexDirection="column">
            {filtered.length === 0
              ? <box height={1} paddingX={1} backgroundColor={c.bgCard}><text fg={c.dim}>No models</text></box>
              : filtered.map((m, i) => (
                  <box key={m.id} id={m.id} height={1} paddingX={1}
                    backgroundColor={i === sel ? c.bgSelect : c.bgCard}
                    flexDirection="row" justifyContent="space-between" alignItems="center">
                    <text fg={i === sel ? c.accent : c.text} overflow="hidden" wrapMode="none" flexGrow={1} paddingLeft={1}>
                      {m.name}
                    </text>
                    <text fg={c.dim} flexShrink={0}>{m.id}</text>
                  </box>
                ))}
          </box>
        </scrollbox>
        <box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>{"\u2191\u2193"} navigate · {"\u23CE"} select · esc close</text>
        </box>
      </box>
    </box>
  )
}
