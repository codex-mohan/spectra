import { Box, Text } from "@opentui/core";
import type { SpectraTuiApp } from "../app.js";

export function createFooter(app: SpectraTuiApp): any {
  const cwd = process.cwd();
  const { tokenUsage } = app.state;
  const isChatView = app.state.route === "chat";

  return Box(
    {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
    },
    Text({
      content: cwd,
      fg: "#6B7280",
    }),
    ...(isChatView
      ? [
          Text({
            content: `↑${tokenUsage.input} ↓${tokenUsage.output} tokens`,
            fg: "#6B7280",
          }),
        ]
      : [
          Text({
            content: "Ctrl+P: commands",
            fg: "#4B5563",
          }),
        ]),
  );
}
