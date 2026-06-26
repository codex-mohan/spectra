import { c } from '../theme.js';
import type { SessionStore } from '../../services/session-store.js';

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
	const childData = sessionStore.get(childSessionId);
	const parent = childData?.parentId ? sessionStore.getParent(childSessionId) : null;
	const siblings = parent ? sessionStore.getChildren(parent.id) : [];
	const currentIdx = siblings.findIndex((s) => s.id === childSessionId);
	const prevSibling = currentIdx > 0 ? siblings[currentIdx - 1] : null;
	const nextSibling = currentIdx >= 0 && currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null;
	const positionLabel = currentIdx >= 0 ? `${currentIdx + 1}/${siblings.length}` : '';
	const title = childData?.title || 'Subagent Session';
	const agentType = childData?.agent ? `@${childData.agent}` : '';

	return (
		<box flexShrink={0} flexDirection="column" backgroundColor={c.bg}>
			<box flexDirection="row" gap={1} alignItems="center" height={1} paddingLeft={2} paddingRight={2}>
				<text fg={c.accent}>◆</text>
				<text fg={c.text} attributes={1} wrapMode="none">{title}</text>
				{agentType && <text fg={c.dim}>· {agentType}</text>}
				{childData?.model && <text fg={c.dim} wrapMode="none">· {childData.model}</text>}
				{positionLabel && <text fg={c.dim}>· {positionLabel}</text>}
			</box>
			<box flexDirection="row" justifyContent="space-between" alignItems="center" height={1} paddingLeft={2} paddingRight={2}>
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
							<text fg={c.user}>← [</text>
							<text fg={c.dim}>prev</text>
						</box>
					)}
					{nextSibling && (
						<box flexDirection="row" gap={1} alignItems="center">
							<text fg={c.user}>] →</text>
							<text fg={c.dim}>next</text>
						</box>
					)}
				</box>
			</box>
		</box>
	);
}