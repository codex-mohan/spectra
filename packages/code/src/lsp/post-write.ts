import { diagnosticsInbox } from '../services/diagnostics-inbox.js';
import { runLspWritethrough } from './writethrough.js';
import type { LspConfig } from '../services/config.js';
import type { Diagnostic } from './protocol.js';

export interface PostWriteLspResult {
	formatted: boolean;
	diagnostics: Diagnostic[];
	text: string;
}

/** Inline format/diagnostics after a write; late diagnostics go to the session inbox. */
export async function applyLspAfterWrite(path: string, config?: LspConfig): Promise<PostWriteLspResult> {
	const outcome = await runLspWritethrough(path, config, {
		onDeferred: (entry) => diagnosticsInbox.enqueue(entry),
	});
	return { formatted: outcome.formatted, diagnostics: outcome.diagnostics, text: outcome.text };
}
