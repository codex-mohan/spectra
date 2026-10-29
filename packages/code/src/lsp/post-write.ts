import { applyWorkspaceEdits, type WorkspaceTextEdit } from './edits.js';
import { formatDiagnostics } from './format.js';
import { getLspManager } from './manager.js';
import { resolveLspSettings } from './servers.js';
import type { LspConfig } from '../services/config.js';
import type { Diagnostic } from './protocol.js';

export interface PostWriteLspResult {
	formatted: boolean;
	diagnostics: Diagnostic[];
	text: string;
}

/** Optional format-on-write and cached diagnostics attached to a write/edit result. */
export async function applyLspAfterWrite(path: string, config?: LspConfig): Promise<PostWriteLspResult> {
	const settings = resolveLspSettings(config);
	if (!settings.enabled) return { formatted: false, diagnostics: [], text: '' };

	const manager = getLspManager(config);
	let formatted = false;
	if (settings.formatOnWrite) {
		try {
			const { result } = await manager.format(path, {});
			const edits: WorkspaceTextEdit[] = Array.isArray(result)
				? result.map((edit) => {
					const item = edit as { range: WorkspaceTextEdit['range']; newText: string };
					return { path, range: item.range, newText: item.newText };
				})
				: [];
			if (edits.length > 0) {
				applyWorkspaceEdits(edits, (target) => manager.validatePath(target));
				formatted = true;
			}
		} catch {
			// Formatting is best-effort; a broken server must not fail the write.
		}
	}

	manager.refreshDocument(path);
	manager.saveDocument(path);
	const diagnostics = settings.diagnosticsOnWrite ? manager.peekDiagnostics(path) : [];
	return {
		formatted,
		diagnostics,
		text: diagnostics.length > 0 ? `\n\nDiagnostics:\n${formatDiagnostics(diagnostics)}` : '',
	};
}
