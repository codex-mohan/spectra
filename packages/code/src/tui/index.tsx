import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./app.js"

export interface TuiOptions {
  sessionId?: string
}

export async function launchTui(_options: TuiOptions = {}): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    targetFps: 30,
    useMouse: true,
    screenMode: "alternate-screen",
  })

  const root = createRoot(renderer)
  root.render(<App renderer={renderer} />)

  await new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve())
  })
}
