import { createCliRenderer, addDefaultParsers } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { parsers } from './parsers-config.js';
import { App } from './app.js';

export interface TuiOptions {
	sessionId?: string;
}

export async function launchTui(_options: TuiOptions = {}): Promise<void> {
	console.error = (() => {
		const orig = console.error.bind(console);
		return (...args: unknown[]) => {
			orig('[spectra]', ...args);
		};
	})();

	process.on('unhandledRejection', (err) => {
		console.error('Unhandled rejection:', err);
	});

	process.on('uncaughtException', (err) => {
		console.error('Uncaught exception:', err);
	});

	// Register tree-sitter parsers for syntax highlighting
	addDefaultParsers(parsers);

	try {
		const renderer = await createCliRenderer({
			exitOnCtrlC: false,
			targetFps: 30,
			useMouse: true,
			screenMode: 'alternate-screen',
		});

		const root = createRoot(renderer);
		root.render(<App renderer={renderer} />);

		await new Promise<void>((resolve) => {
			renderer.on('destroy', () => {
				resolve();
			});
		});
	} catch (err) {
		console.error('TUI launch failed:', err);
		process.exit(1);
	}
}
