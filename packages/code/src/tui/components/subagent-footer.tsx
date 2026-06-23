import { c } from '../theme.js';
import { MessageView } from './message.js';
import type { ChatMessage } from '../types.js';
import type { SessionStore } from '../../services/session-store.js';
import { sdkMessagesToChatMessages } from '../utils/session-messages.js';
import { useState, useEffect } from 'react';

export function SubagentFooter({
	childSessionId,
	sessionStore,
	onBack,
	onNavigate,
}: {
	childSessionId: string;
	sessionStore: SessionStore;
	onBack: () => void;
	onNavigate: (id: string) => void;
}) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);

	useEffect(() => {
		const childData = sessionStore.get(childSessionId);
		if (!childData) {
			setMessages([]);
			return;
		}
		const converted = sdkMessagesToChatMessages({
			messages: childData.messages,
			model: childData.model,
			agent: childData.agent,
		});
		setMessages(converted.messages);
	}, [childSessionId, sessionStore]);

	const childData = sessionStore.get(childSessionId);
	const parent = childData?.parentId ? sessionStore.getParent(childSessionId) : null;
	const siblings = parent ? sessionStore.getChildren(parent.id) : [];
	const currentIdx = siblings.findIndex((s) => s.id === childSessionId);
	const prevSibling = currentIdx > 0 ? siblings[currentIdx - 1] : null;
	const nextSibling = currentIdx >= 0 && currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null;
	const positionLabel = currentIdx >= 0 ? `${currentIdx + 1}/${siblings.length}` : '';
	const title = childData?.title || 'Subagent Session';

	const labelFor = (sibling: { id: string; title: string; agent: string } | null, direction: 'prev' | 'next') => {
		if (!sibling) return null;
		const arrow = direction === 'prev' ? '◀' : '▶';
		return { id: sibling.id, label: `${arrow} ${sibling.title.slice(0, 30)}` };
	};

	const prev = labelFor(prevSibling as any, 'prev');
	const next = labelFor(nextSibling as any, 'next');

	return (
		<box flexDirection="column" height="100%" backgroundColor={c.bg}>
			<box flexDirection="column" flexGrow={1} paddingBottom={1}>
				<box paddingLeft={2} paddingRight={2}>
					<box flexDirection="row" gap={1} alignItems="center" height={1}>
						<text fg={c.accent}>◆</text>
						<text fg={c.text} attributes={1}>{title}</text>
						{childData?.agent && <text fg={c.dim}>· @{childData.agent}</text>}
						{childData?.model && <text fg={c.dim}>· {childData.model}</text>}
						{positionLabel && <text fg={c.dim}>· {positionLabel}</text>}
					</box>
				</box>
				<box flexDirection="column" flexGrow={1}>
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
						{messages.length === 0 ? (
							<text fg={c.dim} paddingLeft={3}>No messages in this subagent session yet.</text>
						) : (
							messages.map((msg, i) => (
								<MessageView key={msg.id} msg={msg} isFirst={i === 0} />
							))
						)}
					</scrollbox>
				</box>
			</box>
			<box flexShrink={0} flexDirection="row" justifyContent="space-between" alignItems="center" height={1} paddingLeft={2} paddingRight={2}>
				<box flexDirection="row" gap={3} alignItems="center">
					<text fg={c.user}>esc</text>
					<text fg={c.dim}>back to parent</text>
				</box>
				<box flexDirection="row" gap={3} alignItems="center">
					{parent && (
						<box flexDirection="row" gap={2} alignItems="center">
							<text fg={c.user}>p</text>
							<text fg={c.dim}>parent</text>
						</box>
					)}
					{prev && (
						<box flexDirection="row" gap={2} alignItems="center">
							<text fg={c.user}>[</text>
							<text fg={c.dim}>prev sibling</text>
						</box>
					)}
					{next && (
						<box flexDirection="row" gap={2} alignItems="center">
							<text fg={c.user}>]</text>
							<text fg={c.dim}>next sibling</text>
						</box>
					)}
				</box>
			</box>
		</box>
	);
}