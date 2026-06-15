import type { ToolResult } from '@mohanscodex/spectra-agent';
import { spawn } from 'child_process';

export function textResult(text: string): ToolResult {
	return { content: [{ type: 'text', text } as { type: 'text'; text: string }] };
}

export function errorResult(message: string): ToolResult {
	return {
		content: [{ type: 'text', text: message } as { type: 'text'; text: string }],
		isError: true,
	};
}

export interface RgResult {
	stdout: string;
	stderr: string;
	code: number;
}

export function spawnRg(args: string[], cwd?: string): Promise<RgResult> {
	return new Promise((resolve, reject) => {
		const binary = process.platform === 'win32' ? 'rg.exe' : 'rg';

		const proc = spawn(binary, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});

		let stdout = '';
		let stderr = '';

		proc.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf-8');
		});
		proc.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf-8');
		});

		proc.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'ENOENT') {
				reject(new Error('RIPGREP_NOT_FOUND'));
			} else {
				reject(err);
			}
		});

		proc.on('exit', (code) => {
			resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 1 });
		});
	});
}
