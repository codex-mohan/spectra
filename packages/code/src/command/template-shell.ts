import { exec } from 'child_process';
import { promisify } from 'util';

import { getPlatformInfo } from '../utils/platform.js';
import type { TemplateDiagnostic } from './template-types.js';

const execAsync = promisify(exec);
const INLINE_COMMAND = /(^|\s)!`([^`]+)`/g;
const FENCED_COMMAND = /^\s*```!\r?\n([\s\S]*?)\r?\n```/gm;
const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

export interface ShellInterpolationResult {
	readonly text: string;
	readonly diagnostics: readonly TemplateDiagnostic[];
}

export async function interpolateShellCommands(
	text: string,
	sourcePath: string,
	cwd: string,
	enabled: boolean,
): Promise<ShellInterpolationResult> {
	const diagnostics: TemplateDiagnostic[] = [];
	const commands: string[] = [];
	const placeholders: string[] = [];
	let index = 0;
	const placeholder = () => `\u0000SPECTRA_TEMPLATE_COMMAND_${index++}\u0000`;
	let prepared = text.replace(FENCED_COMMAND, (_match, command: string) => {
		const token = placeholder();
		commands.push(command);
		placeholders.push(token);
		return token;
	});
	prepared = prepared.replace(INLINE_COMMAND, (_match, prefix: string, command: string) => {
		const token = placeholder();
		commands.push(command);
		placeholders.push(token);
		return `${prefix}${token}`;
	});

	if (commands.length === 0) return { text, diagnostics };
	if (!enabled) {
		diagnostics.push({
			kind: 'validation',
			sourcePath,
			message: 'Template shell execution is disabled by configuration',
		});
		return { text, diagnostics };
	}

	const output: string[] = [];
	for (const command of commands) {
		try {
			const result = await execAsync(command, {
				cwd,
				timeout: TIMEOUT_MS,
				maxBuffer: MAX_OUTPUT_BYTES,
				shell: getPlatformInfo().shell,
				windowsHide: true,
			});
			output.push(result.stdout.trimEnd());
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			diagnostics.push({
				kind: 'validation',
				sourcePath,
				message: `Template shell command failed: ${detail}`,
			});
		}
	}

	if (diagnostics.length > 0) return { text, diagnostics };
	for (let i = 0; i < placeholders.length; i++) {
		prepared = prepared.replace(placeholders[i]!, output[i]!);
	}
	return { text: prepared, diagnostics };
}
