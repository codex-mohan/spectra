import { c } from "../theme.js"
import { MessageView } from "./message.js"
import type { ChatMessage } from "../types.js"

export function ChatArea({ messages }: { messages: ChatMessage[] }) {
  return (
    <scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom" scrollY={true}
      paddingTop={1} paddingLeft={2} paddingRight={2}
      backgroundColor={c.bg} viewportCulling={false}
      focusable={false}
      verticalScrollbarOptions={{ trackOptions: { backgroundColor: c.sbTrack, foregroundColor: c.sbThumb } }}>
      {messages.length === 0 ? (
        <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <text fg={c.dim}>No messages yet</text>
          <text fg={c.dim}>Type below to start chatting</text>
        </box>
      ) : messages.map((msg) => (
        <box key={msg.id} flexDirection="column" marginBottom={1}>
          <MessageView msg={msg} />
        </box>
      ))}
    </scrollbox>
  )
}
