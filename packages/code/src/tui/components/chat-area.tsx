import { c } from '../theme.js';
import { MessageView } from './message.js';
import type { ChatMessage } from '../types.js';

export function ChatArea({
	messages,
	showThinking = true,
	showToolCalls = true,
	revertPoint,
	onMessageClick,
	onTaskClick,
}: {
	messages: ChatMessage[];
	showThinking?: boolean;
	showToolCalls?: boolean;
	revertPoint?: string | null;
	onMessageClick?: (msg: ChatMessage) => void;
	onTaskClick?: (childSessionId: string) => void;
}) {
	const visible = messages.filter((msg) => {
		if (msg.role === 'tool' && !showToolCalls) return false;
		return true;
	});

	// Find the last assistant message's turn status for the interrupted/error indicator
	let lastTurnStatus: ChatMessage['turnStatus'] = undefined;
	for (let i = visible.length - 1; i >= 0; i--) {
		if (visible[i].role === 'assistant') {
			lastTurnStatus = visible[i].turnStatus;
			break;
		}
	}
	const showInterrupted = lastTurnStatus === 'interrupted';
	const showError = lastTurnStatus === 'error';

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
							onTaskClick={onTaskClick}
						/>
					))
				)}
				{(showInterrupted || showError) && (
					<box height={1} flexDirection="row" justifyContent="center" marginTop={1} paddingLeft={3}>
						<text fg={showInterrupted ? c.warn : c.error}>
							{'─'.repeat(16)} {showInterrupted ? '⊘ interrupted' : '✖ error'} {'─'.repeat(16)}
						</text>
					</box>
				)}
			</scrollbox>
		</box>
	);
}
