export const EXIT_CONFIRM_MS = 500;

export type ExitReason = 'ctrl-c' | 'ctrl-d';
export type ClearKeyResult = 'cleared' | 'armed' | 'exit';

export interface ExitGateDeps {
	hasDraft: () => boolean;
	clearDraft: () => void;
	exit: (reason: ExitReason) => void;
	now?: () => number;
}

/**
 * Ctrl+C clears an unsent draft and only exits when pressed twice on an empty
 * editor within {@link EXIT_CONFIRM_MS}. Ctrl+D always exits.
 */
export function createExitGate(deps: ExitGateDeps) {
	const now = deps.now ?? Date.now;
	let lastClearAt = 0;

	return {
		ctrlC(): ClearKeyResult {
			const at = now();
			if (deps.hasDraft()) {
				deps.clearDraft();
				lastClearAt = at;
				return 'cleared';
			}
			if (lastClearAt > 0 && at - lastClearAt <= EXIT_CONFIRM_MS) {
				deps.exit('ctrl-c');
				return 'exit';
			}
			lastClearAt = at;
			return 'armed';
		},
		ctrlD(): 'exit' {
			deps.exit('ctrl-d');
			return 'exit';
		},
	};
}
