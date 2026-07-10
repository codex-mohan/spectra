// ---------------------------------------------------------------------------
// Command action executor — applies CommandAction[] sequentially.
// ---------------------------------------------------------------------------

import type { CommandAction } from '../command/index.js';
import type { PromptSubmitPayload } from './prompt-bar.js';

/** Callbacks the executor invokes for each action type. */
export interface ActionContext {
	/** Called for submit_prompt actions with the full payload. */
	readonly onSubmitPrompt: (payload: PromptSubmitPayload) => void | Promise<void>;
	readonly onOpenDialog: (dialog: { readonly type: string; readonly [key: string]: unknown }) => void;
	readonly onShowToast: (message: string, variant?: 'info' | 'success' | 'warn' | 'error') => void;
}

/** Result of applying a set of actions. */
export interface ActionResult {
	/** Whether any submit_prompt action was applied (used for slash-reset guard). */
	readonly submitted: boolean;
}

/**
 * Apply a sequence of command actions sequentially.
 *
 * - `submit_prompt` → delegates to `ctx.onSubmitPrompt`
 * - `open_dialog`   → delegates to `ctx.onOpenDialog`
 * - `show_toast`    → calls the toast system directly
 *
 * Returns an ActionResult indicating whether a submit_prompt was dispatched.
 */
export async function executeActions(
	actions: readonly CommandAction[],
	ctx: ActionContext,
): Promise<ActionResult> {
	let submitted = false;
	for (const action of actions) {
		switch (action.type) {
			case 'submit_prompt':
				await ctx.onSubmitPrompt({ text: action.text, attachments: [] });
				submitted = true;
				break;
			case 'open_dialog':
				ctx.onOpenDialog(action.dialog);
				break;
			case 'show_toast':
				ctx.onShowToast(action.message, action.variant);
				break;
		}
	}
	return { submitted };
}
