import { useState, useCallback, useRef } from 'react';
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

type Setter<T> = (value: T | ((prev: T) => T)) => void;

function makeSetter<T>(
	getSessionId: () => string | null,
	getState: (id: string) => SessionViewState,
	updateState: (id: string, patch: Partial<SessionViewState>) => void,
	key: keyof SessionViewState,
): Setter<T> {
	return ((value: T | ((prev: T) => T)) => {
		const id = getSessionId();
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: T) => T)(current[key] as T) : value;
		updateState(id, { [key]: resolved } as Partial<SessionViewState>);
	}) as Setter<T>;
}

export function useSessionState() {
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const sessionsRef = useRef(new Map<string, SessionViewState>());

	function getState(sessionId: string | null): SessionViewState {
		if (!sessionId) return DEFAULT_STATE;
		return sessionsRef.current.get(sessionId) || DEFAULT_STATE;
	}

	function updateState(sessionId: string | null, patch: Partial<SessionViewState>) {
		if (!sessionId) return;
		const current = getState(sessionId);
		sessionsRef.current.set(sessionId, { ...current, ...patch });
	}

	const getActiveId = () => activeSessionId;

	const switchSession = useCallback((newSessionId: string | null) => {
		setActiveSessionId(newSessionId);
	}, []);

	const activeState = getState(activeSessionId);

	const setMessages = makeSetter<ChatMessage[]>(getActiveId, getState, updateState, 'messages');
	const setIsLoading = makeSetter<boolean>(getActiveId, getState, updateState, 'isLoading');
	const setStatus = makeSetter<string>(getActiveId, getState, updateState, 'status');
	const setTokenUsage = makeSetter<{ input: number; output: number }>(getActiveId, getState, updateState, 'tokenUsage');
	const setElapsedMs = makeSetter<number | null>(getActiveId, getState, updateState, 'elapsedMs');
	const setTokPerSec = makeSetter<number | null>(getActiveId, getState, updateState, 'tokPerSec');
	const setSelectedAgent = makeSetter<string>(getActiveId, getState, updateState, 'selectedAgent');
	const setSelectedModel = makeSetter<string | null>(getActiveId, getState, updateState, 'selectedModel');
	const setSelectedProvider = makeSetter<string | null>(getActiveId, getState, updateState, 'selectedProvider');
	const setThinkingEffort = makeSetter<string | undefined>(getActiveId, getState, updateState, 'thinkingEffort');

	return {
		activeSessionId,
		switchSession,
		activeState,
		getState,
		updateState,
		setMessages,
		setIsLoading,
		setStatus,
		setTokenUsage,
		setElapsedMs,
		setTokPerSec,
		setSelectedAgent,
		setSelectedModel,
		setSelectedProvider,
		setThinkingEffort,
	};
}
