import type { ChatMessage } from '../types.js';

/** Scripts where terminal width, shaping, or combining marks commonly desync from the cell grid. */
const COMPLEX_SCRIPT = /[\u0300-\u036f\u0590-\u05ff\u0600-\u06ff\u0900-\u0dff\u0e00-\u0eff\u1ab0-\u1aff\u1dc0-\u1dff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u;

export function hasComplexScript(text: string | undefined): boolean {
	return typeof text === 'string' && COMPLEX_SCRIPT.test(text);
}

/**
 * Disable scrollbox viewport culling when the transcript contains scripts whose
 * terminal cell width or shaping can leave stale cells after a scroll repaint.
 */
export function needsStableRepaint(messages: readonly ChatMessage[]): boolean {
	for (const message of messages) {
		if (hasComplexScript(message.content)) return true;
		for (const block of message.blocks ?? []) {
			if ('content' in block && hasComplexScript(block.content)) return true;
		}
		if (message.toolArguments && hasComplexScript(JSON.stringify(message.toolArguments))) return true;
	}
	return false;
}
