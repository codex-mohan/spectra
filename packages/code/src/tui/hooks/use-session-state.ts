import { useState, useRef } from 'react';
import type { ChatMessage } from '../types.js';

export interface SessionViewState {
	messages: ChatMessage[];
	isLoading: boolean;
	status: string;
	tokenUsage: { input: number; output: number };
	elapsedMs: number | null;
	tokPerSec: number | null;
	selectedAgent: string;
	selectedModel: string | null;
	selectedProvider: string | null;
	thinkingEffort: string | undefined;
}

const DEFAULT_STATE: SessionViewState = {
	messages: [],
	isLoading: false,
	status: 'Ready',
	tokenUsage: { input: 0, output: 0 },
	elapsedMs: null,
	tokPerSec: null,
	selectedAgent: 'build',
	selectedModel: null,
	selectedProvider: null,
	thinkingEffort: undefined,
};

export function useSessionState() {
	const activeIdRef = useRef<string | null>(null);
	const [, forceRender] = useState(0);
	const sessionsRef = useRef(new Map<string, SessionViewState>());

	function getState(sessionId: string | null): SessionViewState {
		if (!sessionId) return DEFAULT_STATE;
		return sessionsRef.current.get(sessionId) || DEFAULT_STATE;
	}

	function set(sessionId: string, patch: Partial<SessionViewState>) {
		const current = getState(sessionId);
		sessionsRef.current.set(sessionId, { ...current, ...patch });
		forceRender((n) => n + 1);
	}

	function switchSession(newSessionId: string | null) {
		activeIdRef.current = newSessionId;
		forceRender((n) => n + 1);
	}

	// --- Per-session mutations (target specific session, not active) ---

	function addMessageTo(sessionId: string, msg: ChatMessage) {
		const current = getState(sessionId);
		set(sessionId, { messages: [...current.messages, msg] });
	}

	function updateMessageIn(sessionId: string, msgId: string, patch: Partial<ChatMessage>) {
		const current = getState(sessionId);
		set(sessionId, {
			messages: current.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
		});
	}

	function setMessagesIn(sessionId: string, fn: (prev: ChatMessage[]) => ChatMessage[]) {
		const current = getState(sessionId);
		set(sessionId, { messages: fn(current.messages) });
	}

	function setLoadingIn(sessionId: string, value: boolean) {
		set(sessionId, { isLoading: value });
	}

	function setStatusIn(sessionId: string, value: string) {
		set(sessionId, { status: value });
	}

	function setTokenUsageIn(sessionId: string, fn: (prev: { input: number; output: number }) => { input: number; output: number }) {
		const current = getState(sessionId);
		set(sessionId, { tokenUsage: fn(current.tokenUsage) });
	}

	function setElapsedMsIn(sessionId: string, value: number | null) {
		set(sessionId, { elapsedMs: value });
	}

	function setTokPerSecIn(sessionId: string, value: number | null) {
		set(sessionId, { tokPerSec: value });
	}

	// --- Active-session setters (for UI-driven changes like model switch) ---

	function setActive(patch: Partial<SessionViewState>) {
		const id = activeIdRef.current;
		if (!id) return;
		set(id, patch);
	}

	return {
		activeSessionId: activeIdRef.current,
		switchSession,
		getState,
		set,
		setActive,

		// Per-session mutations (for streaming loops)
		addMessageTo,
		updateMessageIn,
		setMessagesIn,
		setLoadingIn,
		setStatusIn,
		setTokenUsageIn,
		setElapsedMsIn,
		setTokPerSecIn,

		// Convenience: active session state for rendering
		get activeState() {
			return getState(activeIdRef.current);
		},
	};
}
