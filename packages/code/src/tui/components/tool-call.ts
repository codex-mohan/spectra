import { Box, Text } from "@opentui/core";
import type { ToolCall } from "@singularity-ai/spectra-ai";
import type { SpectraTuiApp } from "../app.js";

export function createToolCallView(toolCall: ToolCall, app?: SpectraTuiApp): any {
  const args = toolCall.arguments || {};
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");

  return Box(
    {
      flexDirection: "column",
      paddingLeft: 1,
      paddingTop: 0,
      paddingBottom: 0,
      borderStyle: "single",
      borderColor: "#374151",
    },
    Box(
      {
        flexDirection: "row",
        gap: 1,
      },
      Text({ content: "🛠", fg: "#F59E0B" }),
      Text({ content: toolCall.name, fg: "#F59E0B", attributes: 1 }),
    ),
    ...(argsStr
      ? [Text({ content: `  ${argsStr}`, fg: "#6B7280" })]
      : []),
  );
}
