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

export function useSessionState() {
	const activeIdRef = useRef<string | null>(null);
	const [, forceRender] = useState(0);
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

	function getActiveId(): string | null {
		return activeIdRef.current;
	}

	const switchSession = useCallback((newSessionId: string | null) => {
		activeIdRef.current = newSessionId;
		forceRender((n) => n + 1);
	}, []);

	const activeState = getState(activeIdRef.current);

	function setMessages(value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: ChatMessage[]) => ChatMessage[])(current.messages) : value;
		updateState(id, { messages: resolved });
		forceRender((n) => n + 1);
	}

	function setIsLoading(value: boolean | ((prev: boolean) => boolean)) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: boolean) => boolean)(current.isLoading) : value;
		updateState(id, { isLoading: resolved });
		forceRender((n) => n + 1);
	}

	function setStatus(value: string | ((prev: string) => string)) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: string) => string)(current.status) : value;
		updateState(id, { status: resolved });
		forceRender((n) => n + 1);
	}

	function setTokenUsage(value: { input: number; output: number } | ((prev: { input: number; output: number }) => { input: number; output: number })) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: { input: number; output: number }) => { input: number; output: number })(current.tokenUsage) : value;
		updateState(id, { tokenUsage: resolved });
		forceRender((n) => n + 1);
	}

	function setElapsedMs(value: number | null | ((prev: number | null) => number | null)) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: number | null) => number | null)(current.elapsedMs) : value;
		updateState(id, { elapsedMs: resolved });
		forceRender((n) => n + 1);
	}

	function setTokPerSec(value: number | null | ((prev: number | null) => number | null)) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: number | null) => number | null)(current.tokPerSec) : value;
		updateState(id, { tokPerSec: resolved });
		forceRender((n) => n + 1);
	}

	function setSelectedAgent(value: string | ((prev: string) => string)) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: string) => string)(current.selectedAgent) : value;
		updateState(id, { selectedAgent: resolved });
		forceRender((n) => n + 1);
	}

	function setSelectedModel(value: string | null | ((prev: string | null) => string | null)) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: string | null) => string | null)(current.selectedModel) : value;
		updateState(id, { selectedModel: resolved });
		forceRender((n) => n + 1);
	}

	function setSelectedProvider(value: string | null | ((prev: string | null) => string | null)) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: string | null) => string | null)(current.selectedProvider) : value;
		updateState(id, { selectedProvider: resolved });
		forceRender((n) => n + 1);
	}

	function setThinkingEffort(value: string | undefined | ((prev: string | undefined) => string | undefined)) {
		const id = activeIdRef.current;
		if (!id) return;
		const current = getState(id);
		const resolved = typeof value === 'function' ? (value as (prev: string | undefined) => string | undefined)(current.thinkingEffort) : value;
		updateState(id, { thinkingEffort: resolved });
		forceRender((n) => n + 1);
	}

	return {
		activeSessionId: activeIdRef.current,
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
