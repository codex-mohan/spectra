import { describe, expect, it } from 'vitest';

/**
 * Mirrors useSessionState pre-session prefs (home screen has no activeSessionId).
 * Regression: Tab / agent menu used setActive which no-op'd when id was null.
 */
describe('pre-session agent prefs', () => {
	it('setActive without session updates prefs and getState reflects them', () => {
		const DEFAULT = {
			selectedAgent: 'build',
			selectedModel: null as string | null,
			selectedProvider: null as string | null,
			thinkingEffort: undefined as string | undefined,
		};
		let activeId: string | null = null;
		const sessions = new Map<string, typeof DEFAULT & { messages: unknown[] }>();
		let pre = { ...DEFAULT };

		const getState = (sessionId: string | null) => {
			if (!sessionId) return { messages: [], ...pre };
			return sessions.get(sessionId) ?? { messages: [], ...pre };
		};

		const setActive = (patch: Partial<typeof DEFAULT>) => {
			if (!activeId) {
				pre = { ...pre, ...patch };
				return;
			}
			const cur = getState(activeId);
			sessions.set(activeId, { ...cur, ...patch, messages: cur.messages ?? [] });
			pre = {
				selectedAgent: (patch.selectedAgent ?? cur.selectedAgent) as string,
				selectedModel: patch.selectedModel !== undefined ? patch.selectedModel : cur.selectedModel,
				selectedProvider: patch.selectedProvider !== undefined ? patch.selectedProvider : cur.selectedProvider,
				thinkingEffort: patch.thinkingEffort !== undefined ? patch.thinkingEffort : cur.thinkingEffort,
			};
		};

		const switchSession = (id: string | null) => {
			if (activeId) {
				const cur = sessions.get(activeId);
				if (cur) {
					pre = {
						selectedAgent: cur.selectedAgent,
						selectedModel: cur.selectedModel,
						selectedProvider: cur.selectedProvider,
						thinkingEffort: cur.thinkingEffort,
					};
				}
			}
			activeId = id;
			if (id && !sessions.has(id)) {
				sessions.set(id, { messages: [], ...pre });
			}
		};

		// Home: cycle agents
		expect(getState(null).selectedAgent).toBe('build');
		setActive({ selectedAgent: 'plan' });
		expect(getState(null).selectedAgent).toBe('plan');
		setActive({ selectedAgent: 'debug' });
		expect(getState(null).selectedAgent).toBe('debug');

		// First message creates session — seed with pref
		switchSession('sess-1');
		expect(sessions.get('sess-1')?.selectedAgent).toBe('debug');

		// Change agent mid-session
		setActive({ selectedAgent: 'build' });
		expect(sessions.get('sess-1')?.selectedAgent).toBe('build');
		expect(getState('sess-1').selectedAgent).toBe('build');
	});

	it('tab cycle list advances primary agents', () => {
		const list = ['build', 'debug', 'plan'];
		let current = 'build';
		const cycle = () => {
			const idx = list.indexOf(current);
			current = list[(idx >= 0 ? idx + 1 : 0) % list.length];
			return current;
		};
		expect(cycle()).toBe('debug');
		expect(cycle()).toBe('plan');
		expect(cycle()).toBe('build');
	});
});
