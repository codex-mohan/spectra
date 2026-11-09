import { existsSync } from 'fs';

export interface ResolveBrowserOptions {
	configuredPath?: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
}

function candidates(platform: NodeJS.Platform): string[] {
	if (platform === 'win32') {
		return [
			'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
			'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
			`${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
			'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
			'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		];
	}
	if (platform === 'darwin') {
		return [
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Chromium.app/Contents/MacOS/Chromium',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		];
	}
	return [
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/microsoft-edge',
	];
}

/** Resolve a Chromium-family executable; returns undefined when none exists. */
export function resolveBrowserExecutable(options: ResolveBrowserOptions = {}): string | undefined {
	const env = options.env ?? process.env;
	const explicit = options.configuredPath?.trim() || env.SPECTRA_CHROME_PATH?.trim();
	if (explicit) return existsSync(explicit) ? explicit : undefined;
	return candidates(options.platform ?? process.platform).find((candidate) => candidate && existsSync(candidate));
}

export function browserExecutableError(options: ResolveBrowserOptions = {}): string {
	const configured = options.configuredPath?.trim() || (options.env ?? process.env).SPECTRA_CHROME_PATH?.trim();
	const tried = configured ? configured : candidates(options.platform ?? process.platform).join(', ');
	return [
		'Chromium not found.',
		`Set SPECTRA_CHROME_PATH or browser.executablePath. Tried: ${tried}`,
	].join('\n');
}
