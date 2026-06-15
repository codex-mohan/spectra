import { useRef, useCallback } from 'react';
import type { ChatMessage, Patch } from '../types.js';
import type { Message } from '@mohanscodex/spectra-ai';
import type { SessionStore } from '../../services/session-store.js';
import type { SnapshotManager, RevertResult } from '../../services/snapshot-manager.js';
import { showToast } from '../components/toast.js';

interface RevertDeps {
	sessionStore: React.MutableRefObject<SessionStore>;
	sessionId: React.MutableRefObject<string | null>;
	agentsMapRef: React.MutableRefObject<Map<string, any>>;
	setMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
	setRevertPoint: (id: string | null) => void;
	snapshotManager: React.MutableRefObject<SnapshotManager>;
	promptTextareaRef: React.MutableRefObject<any>;
}

export function useRevert(deps: RevertDeps) {
	const {
		sessionStore,
		sessionId,
		agentsMapRef,
		setMessages,
		setRevertPoint,
		snapshotManager,
		promptTextareaRef,
	} = deps;

	const revertedMessagesRef = useRef<ChatMessage[]>([]);
	const revertedSdkMessagesRef = useRef<Message[]>([]);
	const revertDraftRef = useRef('');
	const revertedPreRevertSnapshotRef = useRef<string | undefined>(undefined);

	// Remove all agents for a session from the map (forces recreation on next send)
	const removeSessionAgents = useCallback(
		(sid: string) => {
			for (const [key, agent] of agentsMapRef.current.entries()) {
				if (key.startsWith(`${sid}:`)) {
					agent.reset();
					agentsMapRef.current.delete(key);
				}
			}
		},
		[agentsMapRef],
	);

	const runRevert = useCallback(
		async (messages: ChatMessage[], msgId: string) => {
			const targetIdx = messages.findIndex((m) => m.id === msgId);
			if (targetIdx < 0) return;

			const keptMessages = messages.slice(0, targetIdx);
			const removedMessages = messages.slice(targetIdx);

			// 1. Collect patches from all removed messages
			const sess = sessionStore.current.get(sessionId.current!);
			const patches: Patch[] = [];
			if (sess) {
				for (let i = targetIdx; i < sess.messages.length; i++) {
					const meta = sess.messages[i].metadata as Record<string, unknown> | undefined;
					const patch = meta?.patch as Patch | undefined;
					if (patch && patch.files.length > 0) {
						patches.push(patch);
					}
				}
			}

			// 2. Capture current state (for redo) before reverting
			let preRevertSnapshot: string | undefined;
			if (patches.length > 0) {
				try {
					preRevertSnapshot = await snapshotManager.current.track();
				} catch (err) {
					console.error('Failed to capture pre-revert snapshot:', err);
				}
			}

			// 3. Revert files
			let revertResult: RevertResult | undefined;
			if (patches.length > 0) {
				try {
					revertResult = await snapshotManager.current.revert(patches);
				} catch (err) {
					console.error('Failed to revert files:', err);
					showToast('File revert failed — messages were still reverted', 'warn');
				}
			}

			// 4. Stash for redo
			revertedMessagesRef.current = removedMessages;
			revertedSdkMessagesRef.current = sess?.messages.slice(targetIdx) ?? [];
			revertedPreRevertSnapshotRef.current = preRevertSnapshot;
			setRevertPoint(messages[targetIdx].id);
			revertDraftRef.current = messages[targetIdx].content;

			// Set the reverted message text in the prompt (cursor goes to end)
			if (promptTextareaRef.current) {
				promptTextareaRef.current.setText(revertDraftRef.current);
			}

			// 5. Truncate messages
			setMessages(() => keptMessages);
			if (sess) {
				sess.messages = sess.messages.slice(0, targetIdx);
				sessionStore.current.save(sess);
			}

			// 6. Remove session agents from map — forces recreation with correct history on next send
			if (sessionId.current) {
				removeSessionAgents(sessionId.current);
			}

			// 7. Toast
			const fileCount = revertResult?.restored ?? 0;
			const deleteCount = revertResult?.deleted ?? 0;
			if (fileCount > 0 || deleteCount > 0) {
				showToast(`Reverted — ${fileCount} files restored, ${deleteCount} deleted. Ctrl+Y to redo`, 'success');
			} else if (patches.length > 0) {
				showToast('Reverted — Ctrl+Y to redo', 'success');
			} else {
				showToast('Reverted — Ctrl+Y to redo', 'success');
			}
		},
		[sessionStore, sessionId, agentsMapRef, removeSessionAgents, setMessages, setRevertPoint, snapshotManager, promptTextareaRef],
	);

	const runRedo = useCallback(async () => {
		if (revertedMessagesRef.current.length === 0) return;

		// 1. Restore files to pre-revert state
		if (revertedPreRevertSnapshotRef.current) {
			try {
				await snapshotManager.current.restore(revertedPreRevertSnapshotRef.current);
			} catch (err) {
				console.error('Failed to restore files on redo:', err);
				showToast('File restore failed — messages were still restored', 'warn');
			}
		}

		// 2. Restore messages
		setMessages((prev) => [...prev, ...revertedMessagesRef.current]);

		const sess = sessionStore.current.get(sessionId.current!);
		if (sess) {
			sess.messages = [...sess.messages, ...revertedSdkMessagesRef.current];
			sessionStore.current.save(sess);
		}

		// 3. Remove session agents — forces recreation with correct history on next send
		if (sessionId.current) {
			removeSessionAgents(sessionId.current);
		}

		// 4. Clear revert state
		setRevertPoint(null);
		revertDraftRef.current = '';
		revertedMessagesRef.current = [];
		revertedSdkMessagesRef.current = [];
		revertedPreRevertSnapshotRef.current = undefined;

		// Clear the prompt textarea
		if (promptTextareaRef.current) {
			promptTextareaRef.current.setText('');
		}

		if (revertedPreRevertSnapshotRef.current) {
			showToast('Messages and files restored', 'success');
		} else {
			showToast('Messages restored', 'success');
		}
	}, [sessionStore, sessionId, agentsMapRef, removeSessionAgents, setMessages, setRevertPoint, snapshotManager, promptTextareaRef]);

	const discardRevert = useCallback(() => {
		revertedMessagesRef.current = [];
		revertedSdkMessagesRef.current = [];
		revertDraftRef.current = '';
		revertedPreRevertSnapshotRef.current = undefined;
		setRevertPoint(null);
	}, [setRevertPoint]);

	return {
		revertedMessagesRef,
		revertedSdkMessagesRef,
		revertDraftRef,
		runRevert,
		runRedo,
		discardRevert,
	};
}
