import { useState, useRef } from 'react';
import type { ChatMessage, PendingQueueMessage } from '../types.js';

export interface SessionViewState {
	messages: ChatMessage[];
	pendingSteering: PendingQueueMessage[];
	pendingFollowUp: PendingQueueMessage[];
	isLoading: boolean;
	status: string;
	tokenUsage: { input: number; output: number };
	costSoFar: number;
	elapsedMs: number | null;
	tokPerSec: number | null;
	selectedAgent: string;
	selectedModel: string | null;
	selectedProvider: string | null;
	thinkingEffort: string | undefined;
}

/** UI prefs that must work before any chat session exists (home screen). */
export type SessionPrefs = Pick<
	SessionViewState,
	'selectedAgent' | 'selectedModel' | 'selectedProvider' | 'thinkingEffort'
>;

const DEFAULT_STATE: SessionViewState = {
	messages: [],
	pendingSteering: [],
	pendingFollowUp: [],
	isLoading: false,
	status: 'Ready',
	tokenUsage: { input: 0, output: 0 },
	costSoFar: 0,
	elapsedMs: null,
	tokPerSec: null,
	selectedAgent: 'build',
	selectedModel: null,
	selectedProvider: null,
	thinkingEffort: undefined,
};

const DEFAULT_PREFS: SessionPrefs = {
	selectedAgent: DEFAULT_STATE.selectedAgent,
	selectedModel: DEFAULT_STATE.selectedModel,
	selectedProvider: DEFAULT_STATE.selectedProvider,
	thinkingEffort: DEFAULT_STATE.thinkingEffort,
};

function prefsFromState(state: SessionViewState): SessionPrefs {
	return {
		selectedAgent: state.selectedAgent,
		selectedModel: state.selectedModel,
		selectedProvider: state.selectedProvider,
		thinkingEffort: state.thinkingEffort,
	};
}

export function useSessionState() {
	const activeIdRef = useRef<string | null>(null);
	const [, forceRender] = useState(0);
	const sessionsRef = useRef(new Map<string, SessionViewState>());
	/** Survives home screen (no active session) so Tab / agent menu work. */
	const preSessionPrefsRef = useRef<SessionPrefs>({ ...DEFAULT_PREFS });

	function getState(sessionId: string | null): SessionViewState {
		if (!sessionId) {
			return { ...DEFAULT_STATE, ...preSessionPrefsRef.current };
		}
		return sessionsRef.current.get(sessionId) || { ...DEFAULT_STATE, ...preSessionPrefsRef.current };
	}

	function set(sessionId: string, patch: Partial<SessionViewState>) {
		const current = getState(sessionId);
		const next = { ...current, ...patch };
		sessionsRef.current.set(sessionId, next);
		// Keep pre-session prefs in sync so returning home preserves agent/model.
		if (
			patch.selectedAgent !== undefined ||
			patch.selectedModel !== undefined ||
			patch.selectedProvider !== undefined ||
			patch.thinkingEffort !== undefined
		) {
			preSessionPrefsRef.current = prefsFromState(next);
		}
		forceRender((n) => n + 1);
	}

	function switchSession(newSessionId: string | null) {
		// Leaving a session: remember its prefs for the next home/new session.
		if (activeIdRef.current) {
			const current = sessionsRef.current.get(activeIdRef.current);
			if (current) preSessionPrefsRef.current = prefsFromState(current);
		}
		activeIdRef.current = newSessionId;
		// Entering a session that has no map entry yet: seed with pre-session prefs.
		if (newSessionId && !sessionsRef.current.has(newSessionId)) {
			sessionsRef.current.set(newSessionId, { ...DEFAULT_STATE, ...preSessionPrefsRef.current });
		}
		forceRender((n) => n + 1);
	}

	// --- Per-session mutations ---

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

	function addPendingSteeringTo(sessionId: string, msg: PendingQueueMessage) {
		const current = getState(sessionId);
		set(sessionId, { pendingSteering: [...current.pendingSteering, msg] });
	}

	function removePendingSteeringFrom(sessionId: string, msgId: string) {
		const current = getState(sessionId);
		set(sessionId, { pendingSteering: current.pendingSteering.filter((msg) => msg.id !== msgId) });
	}

	function addPendingFollowUpTo(sessionId: string, msg: PendingQueueMessage) {
		const current = getState(sessionId);
		set(sessionId, { pendingFollowUp: [...current.pendingFollowUp, msg] });
	}

	function removePendingFollowUpFrom(sessionId: string, msgId: string) {
		const current = getState(sessionId);
		set(sessionId, { pendingFollowUp: current.pendingFollowUp.filter((msg) => msg.id !== msgId) });
	}

	function clearPendingQueuesIn(sessionId: string) {
		set(sessionId, { pendingSteering: [], pendingFollowUp: [] });
	}

	function setLoadingIn(sessionId: string, value: boolean) {
		set(sessionId, { isLoading: value });
	}

	function setStatusIn(sessionId: string, value: string) {
		set(sessionId, { status: value });
	}

	function setTokenUsageIn(
		sessionId: string,
		fn: (prev: { input: number; output: number }) => { input: number; output: number },
	) {
		const current = getState(sessionId);
		set(sessionId, { tokenUsage: fn(current.tokenUsage) });
	}

	function setElapsedMsIn(sessionId: string, value: number | null) {
		set(sessionId, { elapsedMs: value });
	}

	function setTokPerSecIn(sessionId: string, value: number | null) {
		set(sessionId, { tokPerSec: value });
	}

	function addCostIn(sessionId: string, amount: number) {
		const current = getState(sessionId);
		set(sessionId, { costSoFar: current.costSoFar + amount });
	}

	/**
	 * UI prefs for the active session, or pre-session prefs when on home
	 * (no active session yet). This is what makes Tab / agent menu work
	 * before the first message creates a session.
	 */
	function setActive(patch: Partial<SessionViewState>) {
		const id = activeIdRef.current;
		if (!id) {
			const nextPrefs = { ...preSessionPrefsRef.current };
			if (patch.selectedAgent !== undefined) nextPrefs.selectedAgent = patch.selectedAgent;
			if (patch.selectedModel !== undefined) nextPrefs.selectedModel = patch.selectedModel;
			if (patch.selectedProvider !== undefined) nextPrefs.selectedProvider = patch.selectedProvider;
			if (patch.thinkingEffort !== undefined) nextPrefs.thinkingEffort = patch.thinkingEffort;
			preSessionPrefsRef.current = nextPrefs;
			forceRender((n) => n + 1);
			return;
		}
		set(id, patch);
	}

	return {
		activeSessionId: activeIdRef.current,
		switchSession,
		getState,
		set,
		setActive,

		addMessageTo,
		updateMessageIn,
		setMessagesIn,
		addPendingSteeringTo,
		removePendingSteeringFrom,
		addPendingFollowUpTo,
		removePendingFollowUpFrom,
		clearPendingQueuesIn,
		setLoadingIn,
		setStatusIn,
		setTokenUsageIn,
		setElapsedMsIn,
		setTokPerSecIn,
		addCostIn,

		get activeState() {
			return getState(activeIdRef.current);
		},
	};
}
