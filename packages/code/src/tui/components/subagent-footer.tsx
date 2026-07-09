import { c } from '../theme.js';
import type { SessionStore } from '../../services/session-store.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function taskArgsForChild(parent: { messages: unknown[] } | null, childSessionId: string): Record<string, unknown> | null {
	if (!parent) return null;
	const argsByToolCallId = new Map<string, Record<string, unknown>>();
	for (const message of parent.messages) {
		if (!isRecord(message) || message.role !== 'assistant' || !Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (!isRecord(block) || block.type !== 'toolCall' || typeof block.id !== 'string') continue;
			argsByToolCallId.set(block.id, isRecord(block.arguments) ? block.arguments : {});
		}
	}
	for (const message of parent.messages) {
		if (!isRecord(message) || message.role !== 'toolResult' || message.toolName !== 'task') continue;
		const details = isRecord(message.details) ? message.details : {};
		if (details.childSessionId !== childSessionId) continue;
		if (isRecord(details.args)) return details.args;
		if (typeof message.toolCallId === 'string') return argsByToolCallId.get(message.toolCallId) || null;
	}
	return null;
}

function subagentDisplayTitle(childData: { title?: string; agent?: string } | null | undefined, parent: { messages: unknown[] } | null, childSessionId: string): string {
	const agent = childData?.agent || 'subagent';
	const args = taskArgsForChild(parent, childSessionId);
	if (args) {
		const taskAgent = String(args.agent || args.subagent_type || agent);
		const description = typeof args.description === 'string' ? args.description.trim() : '';
		return `@${taskAgent}${description ? ` ${description}` : ''}`.slice(0, 60);
	}
	const title = childData?.title?.trim();
	if (title && !title.startsWith('#')) {
		const prefix = `${agent}: `;
		return title.startsWith(prefix) ? `@${agent} ${title.slice(prefix.length)}` : title;
	}
	return `@${agent}`;
}

function shouldShowAgentMeta(title: string, agentType: string): boolean {
	return !!agentType && !title.startsWith(agentType);
}

/** Shared data computed from child session context. */
function useChildSessionData(childSessionId: string, sessionStore: SessionStore) {
	const childData = sessionStore.get(childSessionId);
	const parent = childData?.parentId ? sessionStore.getParent(childSessionId) : null;
	const siblings = parent ? sessionStore.getChildren(parent.id) : [];
	const currentIdx = siblings.findIndex((s) => s.id === childSessionId);
	const prevSibling = currentIdx > 0 ? siblings[currentIdx - 1] : null;
	const nextSibling = currentIdx >= 0 && currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null;
	const positionLabel = currentIdx >= 0 ? `${currentIdx + 1}/${siblings.length}` : '';
	const title = subagentDisplayTitle(childData, parent, childSessionId);
	const agentType = childData?.agent ? `@${childData.agent}` : '';
	return { childData, parent, prevSibling, nextSibling, positionLabel, title, agentType };
}


/** Bottom nav controls bar with title + read-only indicator, shown where PromptBar normally sits. */
export function SubagentNav({
	childSessionId,
	sessionStore,
}: {
	childSessionId: string;
	sessionStore: SessionStore;
}) {
	const { parent, prevSibling, nextSibling, title, agentType, childData, positionLabel } = useChildSessionData(childSessionId, sessionStore);

	return (
    <box flexShrink={0} flexDirection="column" backgroundColor={c.bgBar} gap={1} paddingY={1}>
			<box flexDirection="row" justifyContent="space-between" alignItems="center" height={1} paddingLeft={2} paddingRight={2}>
				<box flexDirection="row" gap={1} alignItems="center">
					<text fg={c.accent}>◆</text>
					<text fg={c.text} attributes={1} wrapMode="none">{title}</text>
					{shouldShowAgentMeta(title, agentType) && <text fg={c.dim}>· {agentType}</text>}
					{childData?.model && <text fg={c.dim} wrapMode="none">· {childData.model}</text>}
					{positionLabel && <text fg={c.dim}>· {positionLabel}</text>}
				</box>
        <text height={1} fg={c.accent}>◆ read-only</text>
			</box>
			<box flexDirection="row" justifyContent="space-between" alignItems="center" height={1} paddingLeft={2} paddingRight={2} gap={1}>
				<box flexDirection="row" gap={3} alignItems="center">
					<box flexDirection="row" gap={1} alignItems="center">
						<text fg={c.user}>← esc</text>
						<text fg={c.dim}>back</text>
					</box>
					{parent && (
						<box flexDirection="row" gap={1} alignItems="center">
							<text fg={c.user}>↑ p</text>
							<text fg={c.dim}>parent</text>
						</box>
					)}
				</box>
				<box flexDirection="row" gap={3} alignItems="center">
					{prevSibling && (
						<box flexDirection="row" gap={1} alignItems="center">
							<text fg={c.user}>[</text>
							<text fg={c.dim}>left</text>
						</box>
					)}
					{nextSibling && (
						<box flexDirection="row" gap={1} alignItems="center">
							<text fg={c.user}>]</text>
							<text fg={c.dim}>right</text>
						</box>
					)}
				</box>
			</box>
		</box>
	);
}
