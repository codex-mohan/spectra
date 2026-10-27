export type EscapeAction = 'ignore' | 'interrupt' | 'keep-draft' | 'none';

/**
 * The editor-level Escape ladder. Menus and dialogs consume Escape before this
 * runs; everything below decides what a plain Escape means.
 *
 * - `ignore`: a completion surface (file @-mention) is open.
 * - `interrupt`: abort the running turn.
 * - `keep-draft`: a draft exists; Escape never destroys it.
 * - `none`: nothing to do. The empty-editor double-Escape action is not bound.
 */
export function resolveEscapeAction(input: {
	fileAtActive: boolean;
	isStreaming: boolean;
	hasDraft: boolean;
}): EscapeAction {
	if (input.fileAtActive) return 'ignore';
	if (input.isStreaming) return 'interrupt';
	if (input.hasDraft) return 'keep-draft';
	return 'none';
}
