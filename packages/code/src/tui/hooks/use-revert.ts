import { useRef, useState, useCallback } from 'react';
import type { ChatMessage } from '../types.js';
import type { Message } from '@mohanscodex/spectra-ai';
import type { SessionStore } from '../../services/session-store.js';
import type { SnapshotManager } from '../../services/snapshot-manager.js';
import { showToast } from '../components/toast.js';

interface RevertDeps {
	sessionStore: React.MutableRefObject<SessionStore>;
	sessionId: React.MutableRefObject<string | null>;
	agentRef: React.MutableRefObject<any>;
	loadedSessionMessages: React.MutableRefObject<Message[]>;
	setMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
	setRevertPoint: (id: string | null) => void;
	setHistoryIdx: (idx: number) => void;
	setNavKey: (fn: (k: number) => number) => void;
	snapshotManager: React.MutableRefObject<SnapshotManager>;
}

export function useRevert(deps: RevertDeps) {
	const {
		sessionStore,
		sessionId,
		agentRef,
		loadedSessionMessages,
		setMessages,
		setRevertPoint,
		setHistoryIdx,
		setNavKey,
		snapshotManager,
	} = deps;

	const revertedMessagesRef = useRef<ChatMessage[]>([]);
	const revertedSdkMessagesRef = useRef<Message[]>([]);
	const revertDraftRef = useRef('');

	const runRevert = useCallback(
		(messages: ChatMessage[], msgId: string) => {
			const targetIdx = messages.findIndex((m) => m.id === msgId);
			if (targetIdx < 0) return;

			const keptMessages = messages.slice(0, targetIdx);
			const removedMessages = messages.slice(targetIdx);

			revertedMessagesRef.current = removedMessages;
			setRevertPoint(messages[targetIdx].id);
			revertDraftRef.current = messages[targetIdx].content;

			setMessages(() => keptMessages);

			const sess = sessionStore.current.get(sessionId.current!);
			if (sess) {
				const keptSdkMessages = sess.messages.slice(0, targetIdx);
				revertedSdkMessagesRef.current = sess.messages.slice(targetIdx);
				sess.messages = keptSdkMessages;
				sessionStore.current.save(sess);
				loadedSessionMessages.current = keptSdkMessages;
			}

			if (agentRef.current) {
				agentRef.current.reset();
				if (loadedSessionMessages.current.length > 0) {
					agentRef.current.restoreHistory(loadedSessionMessages.current);
				}
			}

			setHistoryIdx(-1);
			setNavKey((k) => k + 1);

			showToast('Reverted — Ctrl+Y to redo', 'success');
		},
		[sessionStore, sessionId, agentRef, loadedSessionMessages, setMessages, setRevertPoint, setHistoryIdx, setNavKey],
	);

	const runRedo = useCallback(() => {
		if (revertedMessagesRef.current.length === 0) return;

		setMessages((prev) => [...prev, ...revertedMessagesRef.current]);

		const sess = sessionStore.current.get(sessionId.current!);
		if (sess) {
			sess.messages = [...sess.messages, ...revertedSdkMessagesRef.current];
			sessionStore.current.save(sess);
			loadedSessionMessages.current = sess.messages;
		}

		if (agentRef.current) {
			agentRef.current.reset();
			if (loadedSessionMessages.current.length > 0) {
				agentRef.current.restoreHistory(loadedSessionMessages.current);
			}
		}

		setRevertPoint(null);
		revertDraftRef.current = '';
		revertedMessagesRef.current = [];
		revertedSdkMessagesRef.current = [];

		setHistoryIdx(-1);
		setNavKey((k) => k + 1);

		showToast('Messages restored', 'success');
	}, [
		sessionStore,
		sessionId,
		agentRef,
		loadedSessionMessages,
		setMessages,
		setRevertPoint,
		setHistoryIdx,
		setNavKey,
	]);

	const runRollbackFiles = useCallback(() => {
		const result = snapshotManager.current.rollback('user requested file rollback');
		if (result.restored > 0 || result.deleted > 0) {
			showToast(`Files rolled back: ${result.restored} restored, ${result.deleted} deleted`, 'success');
		} else if (result.errors.length > 0) {
			showToast(`Rollback errors: ${result.errors.map((e) => e.error).join(', ')}`, 'warn');
		} else {
			showToast('No files to rollback', 'info');
		}
	}, [snapshotManager]);

	const discardRevert = useCallback(() => {
		revertedMessagesRef.current = [];
		revertedSdkMessagesRef.current = [];
		revertDraftRef.current = '';
		setRevertPoint(null);
	}, [setRevertPoint]);

	return {
		revertedMessagesRef,
		revertedSdkMessagesRef,
		revertDraftRef,
		runRevert,
		runRedo,
		runRollbackFiles,
		discardRevert,
	};
}
