import type { CliRenderer, MouseEvent } from '@opentui/core';
import { openTarget } from '../../utils/platform.js';
import { showToast } from '../components/toast.js';

/**
 * Open the link under a mouse pointer, if any. Modified clicks are left to the
 * terminal so its native Cmd/Ctrl+click behavior is not duplicated.
 */
export function openLinkAtPointer(renderer: Pick<CliRenderer, 'getLinkAt'>, event: MouseEvent): void {
	if (event.button !== 0 || event.modifiers.ctrl || event.modifiers.alt || event.modifiers.shift || event.isDragging) {
		return;
	}
	const link = renderer.getLinkAt(event.x, event.y);
	if (!link) return;
	event.stopPropagation();
	void openTarget(link).catch((error: unknown) => {
		showToast(`Could not open link: ${error instanceof Error ? error.message : String(error)}`, 'error');
	});
}
