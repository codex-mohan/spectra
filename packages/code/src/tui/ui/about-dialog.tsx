import { useEffect } from "react"
import { c } from "../theme.js"

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
  const mh = 10
  const mt = Math.max(0, Math.floor((termHeight - mh) / 3))
  const innerW = mw - 4

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box height={1} paddingX={2} paddingTop={1} paddingBottom={1} border={["bottom"]} borderColor={c.border} borderStyle="single" backgroundColor={c.bgCard}>
          <text fg={c.accent}>About</text>
        </box>

        <box flexDirection="column" paddingX={2} paddingTop={1} gap={1} backgroundColor={c.bgCard}>
          <text fg={c.text}>Spectra Code</text>
          <text fg={c.dim}>Version 0.1.0</text>
          <box height={1} />
          <text fg={c.dim}>Minimal, ultra-fast AI coding agent</text>
          <text fg={c.dim}>Built with Spectra SDK</text>
        </box>

        <box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>esc or enter to close</text>
        </box>
      </box>
    </box>
  )
}
