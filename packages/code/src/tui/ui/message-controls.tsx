import { useState, useMemo, useRef, useEffect } from 'react';
import { c } from '../theme.js';
import type { ChatMessage } from '../types.js';
import clipboard from 'clipboardy';
import { showToast } from '../components/toast.js';

export interface MessageControlsProps {
	message: ChatMessage;
	sessionId: string | null;
	messages: ChatMessage[];
	revertPoint: string | null;
	onRevert: (messageId: string) => void;
	onRedo: () => void;
	onFork: (messageId: string) => void;
	onClose: () => void;
	registerHandler: (fn: ((key: any) => void) | null) => void;
	termWidth: number;
	termHeight: number;
}

function getActions(revertPoint: string | null) {
	const actions = [
		{ id: 'revert', label: 'Revert', desc: 'undo messages and file changes' },
		{ id: 'copy', label: 'Copy', desc: 'message text to clipboard' },
		{ id: 'fork', label: 'Fork', desc: 'create a new session' },
	];
	if (revertPoint) {
		actions.unshift({ id: 'redo', label: 'Redo', desc: 'restore reverted messages' });
	}
	return actions;
}

export function MessageControls(props: MessageControlsProps) {
	const {
		message,
		sessionId,
		messages,
		revertPoint,
		onRevert,
		onRedo,
		onFork,
		onClose,
		registerHandler,
		termWidth,
		termHeight,
	} = props;
	const mw = Math.min(64, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = Math.min(14, termHeight - 4);
	const mt = Math.max(1, Math.floor((termHeight - mh) / 2));
	const innerW = mw - 4;
	const listH = mh - 6;

	const [sel, setSel] = useState(0);
	const [confirmAction, setConfirmAction] = useState<string | null>(null);
	const scrollRef = useRef<any>(null);

	const ACTIONS = useMemo(() => getActions(revertPoint), [revertPoint]);

	const msgText = useMemo(() => {
		if (message.role === 'user') return message.content;
		if (message.role === 'assistant') {
			if (message.blocks) {
				return message.blocks
					.filter((b: any) => b.type === 'text')
					.map((b: any) => b.content)
					.join('\n');
			}
			return message.content || '';
		}
		return message.content || '';
	}, [message]);

	useEffect(() => {
		registerHandler((key: any) => {
			if (key.name === 'escape') {
				if (confirmAction) {
					setConfirmAction(null);
					return;
				}
				onClose();
				return;
			}
			if (key.name === 'return' || key.name === 'enter') {
				const action = ACTIONS[sel];
				if (!action) return;
				if (confirmAction === action.id) {
					if (action.id === 'revert' && sessionId) {
						onRevert(message.id);
					} else if (action.id === 'fork' && sessionId) {
						onFork(sessionId);
				} else if (action.id === 'copy') {
					clipboard.write(msgText).catch(() => {});
					showToast('Copied to clipboard', 'success');
					} else if (action.id === 'redo') {
						onRedo();
					}
					onClose();
					return;
				}
				if (action.id === 'revert' || action.id === 'fork') {
					setConfirmAction(action.id);
					return;
				}
				if (action.id === 'redo') {
					onRedo();
					onClose();
					return;
				}
			if (action.id === 'copy') {
				clipboard.write(msgText).catch(() => {});
				showToast('Copied to clipboard', 'success');
				onClose();
				}
				return;
			}
			if (key.name === 'up') {
				setSel((p) => (p > 0 ? p - 1 : ACTIONS.length - 1));
				return;
			}
			if (key.name === 'down') {
				setSel((p) => (p < ACTIONS.length - 1 ? p + 1 : 0));
				return;
			}
		});
	}, [
		sel,
		confirmAction,
		msgText,
		sessionId,
		message.id,
		onRevert,
		onRedo,
		onFork,
		onClose,
		registerHandler,
		ACTIONS,
	]);

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box
					height={1}
					paddingX={2}
					paddingTop={1}
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
				>
					<text fg={c.text} attributes={1}>
						Message Actions
					</text>
					<text fg={c.dim}>esc</text>
				</box>
				<box height={1} />
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<scrollbox
					ref={scrollRef}
					paddingX={1}
					maxHeight={listH}
					scrollY={true}
					scrollbarOptions={{ visible: false }}
				>
					<box flexDirection="column">
						{ACTIONS.map((action, i) => {
							const isSelected = i === sel;
							return (
								<box
									key={action.id}
									id={action.id}
									height={1}
									paddingLeft={2}
									paddingRight={1}
									backgroundColor={isSelected ? c.bgSelect : c.bgCard}
									flexDirection="row"
									justifyContent="space-between"
									alignItems="center"
								>
									<text fg={isSelected ? c.accent : c.text} overflow="hidden" wrapMode="none" flexGrow={1}>
										{action.label}
									</text>
									<text fg={c.dim} flexShrink={0}>
										{action.desc}
									</text>
								</box>
							);
						})}
					</box>
				</scrollbox>
				{confirmAction && (
					<box height={1} paddingX={2} backgroundColor={c.bgBar}>
						<text fg={c.warn}>
							Confirm {confirmAction === 'revert' ? 'Revert' : confirmAction === 'fork' ? 'Fork' : 'Action'}?
							Press Enter
						</text>
					</box>
				)}
				<box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center">
					<text fg={c.dim}>
						{'\u2191\u2193'} navigate · {'\u23CE'} select · esc close
					</text>
				</box>
			</box>
		</box>
	);
}
