import { c, SPINNER } from "../theme.js"

export interface InputAreaProps {
  isLoading: boolean
  agent: string
  model: string
  provider: string
  mcpCount: number
  elapsedMs: number | null
  tokenUsage: { input: number; output: number }
  cwd: string
  route: "home" | "chat"
  spinnerFrame: number
  onSubmit: (text: string) => void
  inputKey: number
}

export function InputArea(props: InputAreaProps) {
  const { isLoading, agent, model, provider, mcpCount, elapsedMs, tokenUsage, cwd, route, spinnerFrame, onSubmit } = props

  return (
    <box flexDirection="column">
      {/* Input row */}
      <box backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={0}
        flexDirection="row" alignItems="center" height={3}>
        {isLoading ? (
          <text fg={c.warn}>{SPINNER[spinnerFrame]}  Thinking...</text>
        ) : (
          <box flexDirection="row" flexGrow={1} alignItems="center">
            <text fg={c.accent}>›</text>
            <box marginLeft={1} flexGrow={1}>
              <input
                key={`msg-${props.inputKey}`}
                placeholder="Type a message..."
                onSubmit={(v) => onSubmit(String(v))}
                focused={true}
              />
            </box>
          </box>
        )}
      </box>

      {/* Agent / Model / Provider / MCP row */}
      <box backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={0} paddingBottom={1}
        flexDirection="row" justifyContent="space-between" height={2}>
        <box flexDirection="row" gap={2} alignItems="center">
          <text fg={c.accent}>{agent}</text>
          <text fg={c.dim}>{model}</text>
          <text fg={c.subtext}>{provider}</text>
          <text fg={c.dim}>{mcpCount} MCP</text>
        </box>
        {route === "chat" && (
          <box flexDirection="row" gap={1}>
            {elapsedMs !== null && <text fg={c.dim}>{(elapsedMs / 1000).toFixed(1)}s</text>}
            <text fg={c.dim}>↑{tokenUsage.input} ↓{tokenUsage.output}</text>
          </box>
        )}
      </box>

      {/* Footer */}
      <box backgroundColor={c.bg} paddingLeft={2} paddingRight={2} paddingTop={0} paddingBottom={0} height={1}
        flexDirection="row" justifyContent="space-between">
        <text fg={c.dim}>{cwd}</text>
        {route === "home" ? <text fg={c.dim}>Ctrl+P: commands</text> : null}
      </box>
    </box>
  )
}
