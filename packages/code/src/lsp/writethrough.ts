import { applyWorkspaceEdits, type WorkspaceTextEdit } from './edits.js';
import { formatDiagnostics } from './format.js';
import { getLspManager, type LspManager } from './manager.js';
import { reduceDiagnostics, summarizeDiagnostics } from './diagnostics-ledger.js';
import { resolveLspSettings } from './servers.js';
import { collectLinterDiagnostics } from './linters.js';
import type { LspConfig } from '../services/config.js';
import type { Diagnostic } from './protocol.js';

export const INLINE_DIAGNOSTICS_MS = 500;

export interface DeferredDiagnosticsBatch {
	path: string;
	messages: string[];
	summary: string;
	errored: boolean;
}

export interface WritethroughOptions {
	inlineWaitMs?: number;
	manager?: LspManager;
	signal?: AbortSignal;
	onDeferred?: (batch: DeferredDiagnosticsBatch) => void;
}

export interface WritethroughOutcome {
	formatted: boolean;
	diagnostics: Diagnostic[];
	text: string;
}

/**
 * Post-write LSP pipeline: optional formatting, document refresh/save, then
 * diagnostics with a short inline budget and a deferred channel for cold servers.
 */
export async function runLspWritethrough(
	path: string,
	config: LspConfig | undefined,
	options: WritethroughOptions = {},
): Promise<WritethroughOutcome> {
	const manager = options.manager ?? getLspManager(config);
	const settings = options.manager ? options.manager.resolved : resolveLspSettings(config);
	if (!settings.enabled) return { formatted: false, diagnostics: [], text: '' };
	if (!settings.formatOnWrite && !settings.diagnosticsOnWrite) {
		return { formatted: false, diagnostics: [], text: '' };
	}
	let formatted = false;

	try {
		await manager.ensureClient(path);
	} catch {
		return { formatted: false, diagnostics: [], text: '' };
	}

	if (settings.formatOnWrite) {
		try {
			const { result } = await manager.format(path, {}, options.signal);
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
			// Formatting is best-effort.
		}
	}

	manager.refreshDocument(path);
	manager.saveDocument(path);
	manager.notifyWatchedFile(path, 2);
	if (!settings.diagnosticsOnWrite) return { formatted, diagnostics: [], text: '' };
	const baseline = manager.documentVersion(path);

	const fetchDiagnostics = async () => {
		const result = await manager.diagnostics(path, options.signal, baseline);
		const lint = await collectLinterDiagnostics(path, settings);
		return { ...result, diagnostics: [...result.diagnostics, ...lint] };
	};
	const fetchPromise = fetchDiagnostics();
	const inlineWaitMs = options.inlineWaitMs ?? INLINE_DIAGNOSTICS_MS;
	const timeout = Symbol('inline-timeout');
	const raced = await Promise.race([
		fetchPromise,
		new Promise<typeof timeout>((resolvePromise) => setTimeout(() => resolvePromise(timeout), inlineWaitMs)),
	]);

	if (raced === timeout) {
		const onDeferred = options.onDeferred;
		if (onDeferred) {
			void fetchPromise.then((result) => {
				if (options.signal?.aborted) return;
				const batch = buildBatch(path, result.diagnostics);
				if (batch) onDeferred(batch);
			}).catch(() => {});
		}
		return { formatted, diagnostics: [], text: '' };
	}

	const batch = buildBatch(path, raced.diagnostics);
	return {
		formatted,
		diagnostics: raced.diagnostics,
		text: batch ? `\n\nDiagnostics:\n${batch.messages.join('\n')}` : '',
	};
}

function buildBatch(path: string, diagnostics: Diagnostic[]): DeferredDiagnosticsBatch | null {
	if (diagnostics.length === 0) return null;
	const messages = formatDiagnostics(diagnostics).split('\n');
	const reduced = reduceDiagnostics(path, messages);
	if (!reduced.changed) return null;
	const summary = summarizeDiagnostics(reduced.messages);
	return { path, messages: reduced.messages, summary: summary.summary, errored: summary.errored };
}
