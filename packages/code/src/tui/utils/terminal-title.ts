export function setTerminalTitle(title: string): void {
	if (process.env.TERM_PROGRAM === 'vscode') return;
	try {
		process.stderr.write(`\x1b]0;${title}\x07`);
	} catch {}
}

export function formatSessionTitle(sessionName: string | null): string {
	if (!sessionName || sessionName === 'New Session') return 'Spectra';
	return `Spectra | ${sessionName}`;
}
