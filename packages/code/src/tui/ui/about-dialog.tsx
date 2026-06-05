import { useEffect } from "react"
import { c } from "../theme.js"
import { VERSION } from "../utils/version.js"

export interface AboutDialogProps {
  onClose: () => void
  termWidth: number
  termHeight: number
  registerHandler?: (fn: (key: any) => void) => void
}

export function AboutDialog({ onClose, termWidth, termHeight, registerHandler }: AboutDialogProps) {
  useEffect(() => {
    const handler = (key: any) => {
      if (key.name === "escape" || key.name === "return" || key.name === "enter") {
        onClose()
      }
    }
    registerHandler?.(handler)
  }, [onClose, registerHandler])

  const mw = Math.min(50, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = 14
  const mt = Math.max(0, Math.floor((termHeight - mh) / 3))
  const innerW = mw - 4
  const maxH = mh - 5

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box height={1} paddingX={2} paddingTop={1} paddingBottom={1}
          flexDirection="row" justifyContent="space-between" backgroundColor={c.bgCard}>
          <text fg={c.accent} flexDirection="row" attributes={1} height={1}>About</text>
          <text fg={c.dim} flexDirection="row" height={1}>esc</text>
        </box>
        <box height={1} paddingX={2}>
          <text fg={c.border}>{"─".repeat(innerW)}</text>
        </box>
        <box flexDirection="column" paddingX={2} gap={1} flexGrow={1}>
          <box>
            <text fg={c.text}>Spectra Code</text>
            <text fg={c.dim}>Version {VERSION}</text>
          </box>
          <box>
            <text fg={c.dim}>Minimal, ultra-fast AI coding agent</text>
          <text fg={c.dim}>Built with Spectra SDK</text>
          </box>
          
        </box>
        <box paddingX={2} paddingY={1} paddingBottom={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>esc/enter close</text>
        </box>
      </box>
    </box>
  )
}
