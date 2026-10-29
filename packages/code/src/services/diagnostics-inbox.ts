import type { DeferredDiagnosticsBatch } from '../lsp/writethrough.js';

export type DiagnosticsEntry = DeferredDiagnosticsBatch;

type Listener = (entry: DiagnosticsEntry) => void;

/** Receives diagnostics that missed the inline write/edit result. */
class DiagnosticsInbox {
	private listeners = new Set<Listener>();

	enqueue(entry: DiagnosticsEntry): void {
		for (const listener of this.listeners) {
			try {
				listener(entry);
			} catch {
				// A listener failure must not break delivery to the others.
			}
		}
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

export const diagnosticsInbox = new DiagnosticsInbox();

export function formatDiagnosticsEntry(entry: DiagnosticsEntry): string {
	return `LSP diagnostics for ${entry.path} (${entry.summary})\n${entry.messages.join('\n')}`;
}
