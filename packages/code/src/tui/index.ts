import { createCliRenderer } from "@opentui/core";
import type { SpectraConfig } from "../services/config.js";
import { loadConfig } from "../services/config.js";
import { loadContext } from "../services/context.js";
import { SpectraTuiApp } from "./app.js";

export interface TuiOptions {
  sessionId?: string;
  config?: SpectraConfig;
}

export async function launchTui(options: TuiOptions = {}): Promise<void> {
  const config = options.config || loadConfig();
  const context = loadContext();

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
    useMouse: true,
    screenMode: "alternate-screen",
  });

  const app = new SpectraTuiApp(renderer, config, context);
  app.initialize();

  await new Promise<void>((resolve) => {
    renderer.on("destroy", () => resolve());
  });
}
