import { useEffect } from "react"
import type { DoctorResult } from "../../commands/doctor.js"
import { c } from "../theme.js"

export function DoctorDialog({ result, onClose, termWidth, termHeight, registerHandler }: { result: DoctorResult; onClose: () => void; termWidth: number; termHeight: number; registerHandler?: (fn: (key: any) => void) => void }) {
  useEffect(() => {
    const handler = (key: any) => {
      if (key.name === "escape" || key.name === "return" || key.name === "enter") {
        onClose()
      }
    }
    registerHandler?.(handler)
  }, [onClose, registerHandler])
  const mw = Math.min(60, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2) + Math.floor(mw / 4)
  const mh = Math.min(22, termHeight - 4)
  const mt = Math.max(0, Math.floor((termHeight - mh) / 3))
  const listH = mh - 5

  const sections = new Map<string, DoctorResult["checks"]>()
  for (const check of result.checks) {
    const list = sections.get(check.section) || []
    list.push(check)
    sections.set(check.section, list)
  }

  const failedCount = result.checks.filter((check) => !check.passed).length

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bg}>
        <box paddingX={2} paddingTop={1} paddingBottom={1} border={["bottom"]} borderColor={c.border} borderStyle="single">
          <text fg={result.allPassed ? c.success : c.error}>{result.allPassed ? "✓ All checks passed" : `✗ ${failedCount}/${result.checks.length} failed`}</text>
        </box>

        <box flexDirection="column" height={listH} paddingLeft={2} paddingRight={1}>
          {[...sections.entries()].map(([section, checks]) => (
            <box key={section} flexDirection="column" marginTop={1}>
              <text fg={c.accent}>{section}</text>
              {checks.map((check: DoctorResult["checks"][number]) => (
                <box key={check.name} flexDirection="row" paddingLeft={2} gap={1}>
                  <text fg={check.passed ? c.success : c.error} width={1}>{check.passed ? "✓" : "✗"}</text>
                  <text fg={c.text}>{check.name}</text>
                  <text fg={c.dim}>{check.detail}</text>
                </box>
              ))}
            </box>
          ))}
        </box>

        <box paddingX={2} paddingTop={1}>
          <text fg={c.dim}>esc or enter to close</text>
        </box>
      </box>
    </box>
  )
}
