import { z } from 'zod';
import type { ToolResult } from '@mohanscodex/spectra-agent';
import type { SpectraTool, ToolContext } from './types.js';
import { spawn, type ChildProcess } from 'child_process';
import { getPlatformInfo } from '../utils/platform.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const DEFAULT_TIMEOUT = 2 * 60 * 1000;
const MAX_OUTPUT_LINES = 2000;
const MAX_OUTPUT_BYTES = 50 * 1024;
const SIGKILL_GRACE_MS = 200;
const UPDATE_MIN_INTERVAL_MS = 100;
const PREVIEW_BYTES = 30_000;

interface ShellDetails {
	exitCode: number;
	command: string;
	truncated?: boolean;
	outputPath?: string;
}

function killProcess(pid: number): Promise<void> {
	return new Promise<void>((resolve) => {
		if (process.platform === 'win32') {
			const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], {
				stdio: 'ignore',
				windowsHide: true,
			});
			killer.once('exit', () => resolve());
			killer.once('error', () => resolve());
			return;
		}

		try {
			process.kill(-pid, 'SIGTERM');
		} catch {
			// process already gone
		}

		const timer = setTimeout(() => {
			try {
				process.kill(-pid, 'SIGKILL');
			} catch {
				// process already gone
			}
			resolve();
		}, SIGKILL_GRACE_MS);
		timer.unref();
	});
}

function tailText(text: string, maxLines: number, maxBytes: number): { text: string; cut: boolean } {
	const lines = text.split('\n');
	if (lines.length <= maxLines && Buffer.byteLength(text, 'utf-8') <= maxBytes) {
		return { text, cut: false };
	}

	const out: string[] = [];
	let bytes = 0;
	for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
		const size = Buffer.byteLength(lines[i], 'utf-8') + (out.length > 0 ? 1 : 0);
		if (bytes + size > maxBytes) {
			if (out.length === 0) {
				const buf = Buffer.from(lines[i], 'utf-8');
				let start = Math.max(0, buf.length - maxBytes);
				while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
				out.unshift(buf.subarray(start).toString('utf-8'));
			}
			break;
		}
		out.unshift(lines[i]);
		bytes += size;
	}
	return { text: out.join('\n'), cut: true };
}

function previewText(text: string): string {
	if (text.length <= PREVIEW_BYTES) return text;
	return '...\n\n' + text.slice(-PREVIEW_BYTES);
}

function truncationDir(): string {
	const dir = join(tmpdir(), 'spectra-truncation');
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export const shellTool: SpectraTool = {
	name: 'bash',
	capabilities: { reads: true, writes: true },
	description: `Execute shell commands on the user's system.
Supports any command available in the system shell.
Output streams in realtime while the command runs.
Returns stdout, stderr, exit code. Long output is truncated with the full content saved to a temp file.
Be careful with destructive commands — seek permission for rm -rf, sudo, etc.`,
	displayName: (args: { command: string }) => args.command.split('\n')[0].slice(0, 60),
	parameters: z.object({
		command: z.string().describe('The shell command to execute'),
		description: z.string().optional().describe('Brief description of what this command does'),
		timeout: z.number().optional().describe('Timeout in milliseconds (default: 2 min, max: 10 min)'),
		workdir: z.string().optional().describe('Working directory for the command'),
	}),
	execute: async ({ command, description, timeout, workdir }, ctx: ToolContext) => {
		return new Promise<ToolResult<ShellDetails>>((resolve) => {
			const info = getPlatformInfo();
			const isWindows = info.os === 'windows';
			const shell = info.shell;
			const isPwsh = /^pwsh(\.exe)?$/i.test(shell) || /^powershell(\.exe)?$/i.test(shell);
			const effectiveTimeout = Math.min(timeout ?? DEFAULT_TIMEOUT, 10 * 60 * 1000);
			const onUpdate = ctx.onUpdate;

			let proc: ChildProcess;
			if (isPwsh) {
				proc = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
					cwd: workdir || process.cwd(),
					env: process.env as Record<string, string>,
					stdio: ['ignore', 'pipe', 'pipe'],
					windowsHide: true,
					detached: false,
				});
			} else {
				proc = spawn(command, [], {
					cwd: workdir || process.cwd(),
					env: process.env as Record<string, string>,
					stdio: ['ignore', 'pipe', 'pipe'],
					windowsHide: true,
					shell: isWindows ? shell : true,
					detached: !isWindows,
				});
			}

			let stdout = '';
			let stderr = '';
			let killed = false;
			let resolved = false;
			let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
			let lastUpdate = 0;

			const finalize = (result: ToolResult<ShellDetails>) => {
				if (resolved) return;
				resolved = true;
				if (forceKillTimer) clearTimeout(forceKillTimer);
				resolve(result);
			};

			const kill = () => {
				if (killed) return;
				killed = true;
				if (!proc.pid) return;
				killProcess(proc.pid);

				forceKillTimer = setTimeout(() => {
					// If the process still hasn't exited after grace, force-resolve
					if (!resolved && proc.exitCode === null && proc.signalCode === null) {
						try {
							proc.kill('SIGKILL');
						} catch {
							/* ignore */
						}
					}
					// Give a bit more time for the exit event to fire
					setTimeout(() => {
						if (!resolved) {
							const combined = `${stdout}${stderr ? '\n' + stderr : ''}`;
							const truncated = tailText(combined, MAX_OUTPUT_LINES, MAX_OUTPUT_BYTES);
							finalize({
								content: [
									{
										type: 'text',
										text:
											truncated.text +
											'\n\n<shell_metadata>\nshell tool terminated command after exceeding timeout ' +
											effectiveTimeout +
											' ms. If this command is expected to take longer, retry with a larger timeout value.\n</shell_metadata>',
									},
								],
								details: { exitCode: -1, command, truncated: truncated.cut },
								isError: true,
							});
						}
					}, 500);
				}, 3100);
			};

			// Timeout
			const timeoutId = setTimeout(() => kill(), effectiveTimeout);

			// Abort signal
			if (ctx.signal) {
				if (ctx.signal.aborted) {
					kill();
				} else {
					ctx.signal.addEventListener('abort', kill, { once: true });
				}
			}

			// Streams may not exist for some shell configurations
			if (proc.stdout) {
				proc.stdout.on('data', (chunk: Buffer) => {
					stdout += chunk.toString('utf-8');
					if (onUpdate) {
						const now = Date.now();
						if (now - lastUpdate >= UPDATE_MIN_INTERVAL_MS) {
							lastUpdate = now;
							onUpdate({
								content: [{ type: 'text', text: previewText(stdout + (stderr ? '\n' + stderr : '')) }],
								details: { exitCode: 0, command },
							});
						}
					}
				});
			}
			if (proc.stderr) {
				proc.stderr.on('data', (chunk: Buffer) => {
					stderr += chunk.toString('utf-8');
					if (onUpdate) {
						const now = Date.now();
						if (now - lastUpdate >= UPDATE_MIN_INTERVAL_MS) {
							lastUpdate = now;
							onUpdate({
								content: [{ type: 'text', text: previewText(stdout + (stderr ? '\n' + stderr : '')) }],
								details: { exitCode: 0, command },
							});
						}
					}
				});
			}

			proc.once('exit', (code, signal) => {
				clearTimeout(timeoutId);
				if (ctx.signal) {
					ctx.signal.removeEventListener('abort', kill);
				}

				if (onUpdate) {
					const combined = stdout + (stderr ? '\n' + stderr : '');
					onUpdate({
						content: [{ type: 'text', text: previewText(combined) }],
						details: { exitCode: code ?? (signal ? 1 : 0), command },
					});
				}

				const exitCode = code ?? (signal ? 1 : 0);
				let output = stdout;
				if (stderr) output = output ? `${output}\n${stderr}` : stderr;

				const truncated = tailText(output, MAX_OUTPUT_LINES, MAX_OUTPUT_BYTES);
				let finalText = truncated.text || '(no output)';

				if (truncated.cut) {
					const dir = truncationDir();
					const outputPath = join(dir, `shell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);
					writeFileSync(outputPath, output, 'utf-8');
					finalText = `...output truncated...\n\nFull output saved to: ${outputPath}\n\n` + finalText;
					finalize({
						content: [{ type: 'text', text: finalText }],
						details: { exitCode, command, truncated: true, outputPath },
						isError: exitCode !== 0,
					});
				} else {
					finalize({
						content: [{ type: 'text', text: finalText }],
						details: { exitCode, command, truncated: false },
						isError: exitCode !== 0,
					});
				}
			});

			proc.once('error', (err) => {
				clearTimeout(timeoutId);
				if (ctx.signal) {
					ctx.signal.removeEventListener('abort', kill);
				}

				const msg = err.message || '';
				const prefix = `Command failed: ${command}\n`;
				const prefixCr = `Command failed: ${command}\r\n`;
				let clean = msg.startsWith(prefix)
					? msg.slice(prefix.length)
					: msg.startsWith(prefixCr)
						? msg.slice(prefixCr.length)
						: msg;

				finalize({
					content: [{ type: 'text', text: clean }],
					details: { exitCode: 1, command },
					isError: true,
				});
			});
		});
	},
};
