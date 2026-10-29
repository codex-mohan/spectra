const seen = new Map<string, string>();

/**
 * Suppress diagnostics identical to the last batch shown for a file. Any change
 * (new, fixed, or reworded) passes through and updates the ledger.
 */
export function reduceDiagnostics(path: string, messages: string[]): { messages: string[]; changed: boolean } {
	const key = JSON.stringify(messages);
	if (seen.get(path) === key) return { messages: [], changed: false };
	seen.set(path, key);
	return { messages, changed: true };
}

export function resetDiagnosticsLedger(): void {
	seen.clear();
}

export function summarizeDiagnostics(messages: string[]): { summary: string; errored: boolean } {
	let errors = 0;
	let warnings = 0;
	for (const message of messages) {
		if (message.includes(' error:')) errors++;
		else if (message.includes(' warning:')) warnings++;
	}
	const parts = [
		errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : '',
		warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : '',
	].filter(Boolean);
	return { summary: parts.join(', ') || `${messages.length} diagnostic${messages.length === 1 ? '' : 's'}`, errored: errors > 0 };
}
