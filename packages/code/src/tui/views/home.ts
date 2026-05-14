import { Box, Text } from "@opentui/core";
import type { SpectraTuiApp } from "../app.js";
import { createInputArea } from "../components/input-area.js";
import { createFooter } from "../components/footer.js";

export function createHomeView(app: SpectraTuiApp): any {
  return Box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      padding: 2,
    },

    Text({
      content: "Spectra Code",
      fg: "#7C3AED",
      attributes: 1,
    }),

    Text({
      content: "──────────────────────────────",
      fg: "#6B7280",
    }),

    Box({ height: 1 }),

    Box(
      {
        flexDirection: "row",
        gap: 4,
      },
      Text({ content: `Sessions`, fg: "#9CA3AF" }),
      Text({ content: `Models`, fg: "#9CA3AF" }),
      Text({ content: `Tools`, fg: "#9CA3AF" }),
    ),

    Box(
      {
        flexDirection: "row",
        gap: 4,
      },
      Text({ content: `${app.sessionStore.list().length}`, fg: "#FFFFFF" }),
      Text({ content: `3`, fg: "#FFFFFF" }),
      Text({ content: `7`, fg: "#FFFFFF" }),
    ),

    Box({ height: 2 }),

    createInputArea(app),
    createFooter(app),
  );
}
