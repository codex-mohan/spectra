import { Box, Text, ScrollBox } from "@opentui/core";
import type { SpectraTuiApp } from "../app.js";
import { createMessageView } from "../components/message.js";
import { createInputArea } from "../components/input-area.js";
import { createFooter } from "../components/footer.js";

export function createChatView(app: SpectraTuiApp): any {
  const headerText = app.state.session?.title || "Chat";
  const messageCount = app.state.messages.length;

  return Box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
    },

    Box(
      {
        padding: 1,
        borderStyle: "single",
        borderColor: "#374151",
      },
      Text({ content: ` ${headerText} `, fg: "#9CA3AF" }),
      Text({ content: `${messageCount} messages`, fg: "#6B7280" }),
    ),

    ScrollBox(
      {
        scrollY: true,
        flexGrow: 1,
        viewportCulling: true,
        stickyScroll: true,
        stickyStart: "bottom",
      },

      Box(
        {
          flexDirection: "column",
          padding: 1,
          gap: 1,
        },
        ...(messageCount === 0
          ? [Text({ content: "No messages yet. Start the conversation!", fg: "#6B7280" })]
          : app.state.messages.map((msg, i) => createMessageView(msg, i, app))),
      ),
    ),

    createInputArea(app),
    createFooter(app),
  );
}
