import { c } from '../theme.js';
import type { PendingQueueMessage } from '../types.js';

interface PendingQueueProps {
	steering: PendingQueueMessage[];
	followUp: PendingQueueMessage[];
	width: number;
}


export function PendingQueue({ steering, followUp, width }: PendingQueueProps) {
	if (steering.length === 0 && followUp.length === 0) return null;

	const boxWidth = Math.max(28, Math.min(80, width));
	const innerWidth = boxWidth - 4;
	const title = 'pending';
	const topFill = Math.max(1, boxWidth - title.length - 5);
	const messageCount = steering.length + followUp.length;
	const label = steering.length > 0 && followUp.length > 0
		? 'Queued messages'
		: steering.length > 0
			? 'Steering queued'
			: 'Follow-up queued';
	const maxMessageWidth = Math.max(8, innerWidth - (messageCount > 1 ? 5 : 2));
	const pendingItems = [
		...steering.map((message) => ({ id: `steering-${message.id}`, content: message.content })),
		...followUp.map((message) => ({ id: `follow-up-${message.id}`, content: message.content })),
	].map((message, index) => {
		const normalized = message.content.replace(/\s+/g, ' ').trim();
		const quoteInnerWidth = Math.max(0, maxMessageWidth - 2);
		const quotedContent = normalized.length <= quoteInnerWidth
			? `"${normalized}"`
			: `"${normalized.slice(0, Math.max(0, quoteInnerWidth - 1))}…"`;
		return {
			id: message.id,
			text: `${messageCount > 1 ? `${index + 1}. ` : ''}${quotedContent}`,
		};
	});

	return (
		<box flexDirection="column" flexShrink={0} marginBottom={1} paddingLeft={1}>
			<box flexDirection="row">
				<text fg={c.dim}>┌─ </text>
				<text fg={c.dim} attributes={1}>{title}</text>
				<text fg={c.dim}> {'─'.repeat(topFill)}</text>
			</box>
			<box flexDirection="row">
				<text fg={c.dim}>│  </text>
				<text fg={c.dim}>{label}</text>
			</box>
			{pendingItems.map((message) => (
				<box key={message.id} flexDirection="row">
					<text fg={c.dim}>│  </text>
					<text fg={c.dim}>{message.text}</text>
				</box>
			))}
			<text fg={c.dim}>└{'─'.repeat(boxWidth - 1)}</text>
		</box>
	);
}
