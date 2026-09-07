import { beforeEach, describe, expect, it, vi } from 'vitest';

const keyboard = vi.hoisted(() => ({ handler: (_key: any) => {} }));
vi.mock('react', () => ({
	useRef: (current: unknown) => ({ current }),
	useCallback: (fn: unknown) => fn,
	useMemo: (fn: () => unknown) => fn(),
	useEffect: () => {},
}));
vi.mock('@opentui/react', () => ({ useKeyboard: (fn: typeof keyboard.handler) => { keyboard.handler = fn; } }));
vi.mock('../tui/components/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../tools/index.js', () => ({ getToolStreamingDisplay: vi.fn() }));

import { useAppKeyboard } from '../tui/hooks/use-app-keyboard.js';
import { useChatSubmit } from '../tui/hooks/use-chat-submit.js';

describe('permission keyboard ownership', () => {
	it.each(['return', 'enter', 'escape', 'up', 'down', 'left', 'right'])(
		'does not send %s to a stale message-controls handler', (name) => {
			const staleRevertHandler = vi.fn();
			useAppKeyboard({
				permissionRequest: { id: 'permission-1' },
				dialogKeyHandler: { current: staleRevertHandler },
			} as unknown as Parameters<typeof useAppKeyboard>[0]);
			keyboard.handler({ name });
			expect(staleRevertHandler).not.toHaveBeenCalled();
		},
	);

	it('still routes keys to an active shared dialog', () => {
		const handler = vi.fn();
		useAppKeyboard({
			permissionRequest: null,
			msgControls: { id: 'message-1' },
			dialogKeyHandler: { current: handler },
		} as unknown as Parameters<typeof useAppKeyboard>[0]);
		keyboard.handler({ name: 'return' });
		expect(handler).toHaveBeenCalledOnce();
	});
});

describe('drafts typed during a response', () => {
	beforeEach(() => vi.clearAllMocks());
	it.each(['completed', 'error', 'interrupted'])('preserves the next draft when the stream is %s', async (outcome) => {
		let finish!: () => void;
		let started!: () => void;
		const pending = new Promise<void>((resolve) => { finish = resolve; });
		const streaming = new Promise<void>((resolve) => { started = resolve; });
		let draft = 'first prompt';
		const resetInput = vi.fn(() => { draft = ''; });
		const setLoadingIn = vi.fn();
		const ref = <T,>(current: T) => ({ current });
		const hook = useChatSubmit({
			sessionId: ref('session-1'),
			selectedAgentRef: ref('build'), selectedModelRef: ref('test-model'),
			selectedProviderRef: ref('openai'), thinkingEffortRef: ref(undefined),
			revertPoint: null,
			sessionStore: ref({ get: () => undefined, addMessage: vi.fn() }),
			sessionState: { addMessageTo: vi.fn(), setLoadingIn, setStatusIn: vi.fn() },
			snapshotManager: ref({ track: async () => undefined }),
			promptHistoryService: ref({ append: vi.fn() }),
			isStreamingRef: ref(false), currentTurnStartRef: ref(null), currentTurnMsgIdRef: ref(null),
			setDraftText: (text: string) => { draft = text; }, setSubmitKey: resetInput,
			setSlashSelected: vi.fn(), setTokPerSec: vi.fn(), setElapsedMs: vi.fn(),
			setRoute: vi.fn(), setInterruptKey: vi.fn(),
			getOrCreateAgent: async () => ({
				async *run() {
					started();
					await pending;
					if (outcome === 'error') throw new Error('stream failed');
					if (outcome === 'completed') yield { type: 'agent_end' };
				},
			}),
		} as unknown as Parameters<typeof useChatSubmit>[0]);
		const run = hook.submitPrompt({ text: 'first prompt', attachments: [] });
		await streaming;
		expect(resetInput).toHaveBeenCalledOnce();
		draft = 'keep this next message';
		finish();
		await run;
		expect(setLoadingIn).toHaveBeenLastCalledWith('session-1', false);
		expect(draft).toBe('keep this next message');
		expect(resetInput).toHaveBeenCalledOnce();
	});
});
