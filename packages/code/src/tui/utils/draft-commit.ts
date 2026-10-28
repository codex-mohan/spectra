/**
 * Only slash and @-mention input needs the draft in App state (menus and their
 * cursor). Ordinary prose must not re-render the app on every keystroke.
 */
export function shouldCommitDraft(text: string): boolean {
	return text.length === 0 || text.includes('/') || text.includes('@');
}
