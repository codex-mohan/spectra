import { c } from '../theme.js';
import { MessageView } from './message.js';
import type { ChatMessage } from '../types.js';

export function ChatArea({
	messages,
	showThinking = true,
	showToolCalls = true,
	revertPoint,
	onMessageClick,
}: {
	messages: ChatMessage[];
	showThinking?: boolean;
	showToolCalls?: boolean;
	revertPoint?: string | null;
	onMessageClick?: (msg: ChatMessage) => void;
}) {
	const visible = messages.filter((msg) => {
		if (msg.role === 'tool' && !showToolCalls) return false;
		return true;
	});

	return (
		<box flexDirection="column">
			<scrollbox
				flexGrow={1}
				stickyScroll={true}
				stickyStart="bottom"
				scrollY={true}
				backgroundColor={c.bg}
				viewportCulling={false}
				focusable={false}
				paddingRight={2}
				verticalScrollbarOptions={{ trackOptions: { backgroundColor: c.sbTrack, foregroundColor: c.sbThumb } }}
			>
				<box height={1} />
				{visible.length === 0 ? (
					<box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
						<text fg={c.dim}>No messages yet</text>
						<text fg={c.dim}>Type below to start chatting</text>
					</box>
				) : (
					visible.map((msg, i) => (
						<MessageView
							key={msg.id}
							msg={msg}
							showThinking={showThinking}
							isFirst={i === 0}
							isRevertPoint={msg.id === revertPoint}
							onClick={msg.role === 'user' ? () => onMessageClick?.(msg) : undefined}
						/>
					))
				)}
			</scrollbox>
		</box>
	);
}
