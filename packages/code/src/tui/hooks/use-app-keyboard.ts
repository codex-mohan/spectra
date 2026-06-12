import { useCallback, useMemo, useRef, useEffect, type RefObject } from 'react';
import { useKeyboard } from '@opentui/react';
import type { CliRenderer } from '@opentui/core';
import type { CmdItem } from '../components/command-palette.js';
import type { ChatMessage } from '../types.js';
import type { PromptHistoryService } from '../../services/prompt-history.js';
import { cycleEffort } from '../variant-cycle.js';
import { AGENTS } from '../app-constants.js';

interface UseAppKeyboardDeps {
	renderer: CliRenderer;
	isStreamingRef: React.MutableRefObject<boolean>;
	currentTurnStartRef: React.MutableRefObject<number | null>;
	currentTurnMsgIdRef: React.MutableRefObject<string | null>;
	revertPoint: string | null;
	revertedMessagesRef: React.MutableRefObject<ChatMessage[]>;
	runRedo: () => void;
	promptHistoryService: React.MutableRefObject<PromptHistoryService>;
	promptTextareaRef: React.MutableRefObject<any>;

	dialogStep: any;
	updateVersion: string | null;
	msgControls: ChatMessage | null;
	permissionRequest: any;
	dialogKeyHandler: React.MutableRefObject<((key: any) => void) | null>;

	showCmd: boolean;
	cmdFilter: string;
	cmdSelected: number;
	cmdFiltered: CmdItem[];

	draftText: string;
	slashActive: boolean;
	slashFiltered: CmdItem[];
	slashSelected: number;

	interruptKey: number;
	selectedAgent: string;
	thinkingEffort: string | undefined;
	provider: string | null;

	agentRef: React.MutableRefObject<any>;
	securityRef: React.MutableRefObject<any>;

	setShowCmd: (v: boolean) => void;
	setCmdFilter: React.Dispatch<React.SetStateAction<string>>;
	setCmdSelected: React.Dispatch<React.SetStateAction<number>>;
	setDraftText: React.Dispatch<React.SetStateAction<string>>;
	setSlashSelected: React.Dispatch<React.SetStateAction<number>>;
	setNavKey: React.Dispatch<React.SetStateAction<number>>;
	setInterruptKey: React.Dispatch<React.SetStateAction<number>>;
	setSelectedAgent: React.Dispatch<React.SetStateAction<string>>;
	setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setStatus: React.Dispatch<React.SetStateAction<string>>;
	setThinkingEffort: React.Dispatch<React.SetStateAction<string | undefined>>;
	updateMessage: (id: string, u: Partial<ChatMessage>) => void;
	updateLastAssistantMeta: (meta: Record<string, unknown>) => void;

	execCmd: (item: any) => void;
	handleCycleVariant: () => void;
}

export function useAppKeyboard(deps: UseAppKeyboardDeps) {
	const {
		renderer,
		isStreamingRef,
		currentTurnStartRef,
		currentTurnMsgIdRef,
		revertPoint,
		revertedMessagesRef,
		runRedo,
		promptHistoryService,
		promptTextareaRef,
		dialogStep,
		updateVersion,
		msgControls,
		permissionRequest,
		dialogKeyHandler,
		showCmd,
		cmdFilter,
		cmdSelected,
		cmdFiltered,
		draftText,
		slashActive,
		slashFiltered,
		slashSelected,
		interruptKey,
		selectedAgent,
		thinkingEffort,
		provider,
		agentRef,
		securityRef,
		setShowCmd,
		setCmdFilter,
		setCmdSelected,
		setDraftText,
		setSlashSelected,
		setNavKey,
		setInterruptKey,
		setSelectedAgent,
		setMessages,
		setStatus,
		setThinkingEffort,
		updateMessage,
		updateLastAssistantMeta,
		execCmd,
		handleCycleVariant,
	} = deps;

	const lastCursorRef = useRef<number>(-1);

	useKeyboard((key) => {
		if (dialogStep || updateVersion || msgControls || permissionRequest !== null) {
			dialogKeyHandler.current?.(key);
			return;
		}
		if (showCmd) {
			if (key.name === 'escape' || (key.ctrl && key.name === 'p')) {
				setShowCmd(false);
				return;
			}
			if (key.name === 'return' || key.name === 'enter') {
				if (cmdFiltered.length > 0) {
					execCmd(cmdFiltered[cmdSelected]);
					return;
				}
				return;
			}
			if (key.name === 'up') {
				setCmdSelected((p) => (p > 0 ? p - 1 : cmdFiltered.length - 1));
				return;
			}
			if (key.name === 'down') {
				setCmdSelected((p) => (p < cmdFiltered.length - 1 ? p + 1 : 0));
				return;
			}
			if (key.name === 'backspace') {
				setCmdFilter((p) => p.slice(0, -1));
				setCmdSelected(() => 0);
				return;
			}
			if (key.name.length === 1 && !key.ctrl && !key.meta) {
				setCmdFilter((p) => p + key.name);
				setCmdSelected(() => 0);
				return;
			}
			return;
		}
		if (slashActive && slashFiltered.length > 0) {
			if (key.name === 'escape') {
				setDraftText('');
				setSlashSelected(0);
				if (promptTextareaRef.current) {
					promptTextareaRef.current.setText('');
				}
				return;
			}
			if (key.name === 'tab') {
				const item = slashFiltered[slashSelected];
				if (item && promptTextareaRef.current) {
					const cmdName = item.slashName || item.id;
					promptTextareaRef.current.setText(`/${cmdName} `);
					setDraftText(`/${cmdName} `);
					setSlashSelected(0);
				}
				return;
			}
			if (key.name === 'up') {
				setSlashSelected((p) => (p > 0 ? p - 1 : slashFiltered.length - 1));
				return;
			}
			if (key.name === 'down') {
				setSlashSelected((p) => (p < slashFiltered.length - 1 ? p + 1 : 0));
				return;
			}
		}
		if (key.ctrl && key.name === 'c') {
			renderer.destroy();
			return;
		}
		if (key.ctrl && key.name === 'y') {
			if (revertPoint !== null && revertedMessagesRef.current.length > 0) {
				runRedo();
			}
			return;
		}
		if (key.name === 'escape') {
			if (isStreamingRef.current) {
				if (interruptKey === 1) {
					agentRef.current?.abort();
					const duration = Math.round(performance.now() - (currentTurnStartRef.current ?? 0));
					if (currentTurnMsgIdRef.current) {
						updateMessage(currentTurnMsgIdRef.current, {
							turnStatus: 'interrupted',
							streaming: false,
							turnDurationMs: duration,
						});
					}
					updateLastAssistantMeta({ turnStatus: 'interrupted', turnDurationMs: duration });
					setInterruptKey(0);
					return;
				}
				setInterruptKey(1);
				setTimeout(() => setInterruptKey(0), 3000);
				return;
			}
			return;
		}
		if (key.name === 'up' || key.name === 'down') {
			if (slashActive) return;
			const textarea = promptTextareaRef.current;
			if (!textarea) return;
			const text: string = textarea.plainText ?? '';
			const cursor: number = textarea.cursorOffset ?? text.length;
			const prevCursor = lastCursorRef.current;
			lastCursorRef.current = cursor;

			const isUp = key.name === 'up';
			const boundary = isUp ? 0 : text.length;
			const dir = isUp ? -1 : 1;

			if (cursor === boundary && prevCursor === boundary) {
				const result = promptHistoryService.current.move(dir, text, cursor);
				if (result !== undefined) {
					textarea.setText(result);
					textarea.cursorOffset = isUp ? 0 : result.length;
					lastCursorRef.current = isUp ? 0 : result.length;
				}
			}
			return;
		}
		if (key.name === 'tab') {
			setSelectedAgent((p) => AGENTS[(AGENTS.indexOf(p) + 1) % AGENTS.length]);
			securityRef.current?.getReadTracker().reset();
			securityRef.current?.getDoomLoop().reset();
			return;
		}
		if (key.ctrl && key.name === 'p') {
			setShowCmd(true);
			setCmdFilter(() => '');
			setCmdSelected(() => 0);
			return;
		}
		if (key.ctrl && key.name === 'l') {
			setMessages(() => []);
			setStatus('Cleared');
			setTimeout(() => setStatus('Ready'), 2000);
			securityRef.current?.getReadTracker().reset();
			securityRef.current?.getDoomLoop().reset();
			return;
		}
		if (key.ctrl && key.name === 't') {
			handleCycleVariant();
			return;
		}
	});
}
