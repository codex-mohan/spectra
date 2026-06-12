import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { execSync } from 'child_process';
import { resolve } from 'path';

export const globTool: SpectraTool = {
	name: 'glob',
	capabilities: { reads: true, writes: false },
	description: `Find files matching a glob pattern.
Supports common glob patterns like **/*.ts, src/**/*.css, etc.
Searches from the specified directory or current working directory.
Results are limited to prevent overwhelming output.`,
	displayName: (args: { pattern: string }) => args.pattern,
	parameters: z.object({
		pattern: z.string().describe("Glob pattern to match files (e.g. '**/*.ts', 'src/**/*.css')"),
		path: z.string().optional().describe('Directory to search in (defaults to cwd)'),
		maxResults: z.number().optional().describe('Maximum number of results to return'),
	}),
	execute: async ({ pattern, path, maxResults }) => {
		const searchDir = path ? resolve(process.cwd(), path) : process.cwd();
		const limit = maxResults || 100;

		try {
			const hasFd =
				execSync('which fdfind 2>/dev/null || which fd 2>/dev/null || where fd 2>nul', {
					encoding: 'utf-8',
					timeout: 1000,
					stdio: 'pipe',
				}).trim().length > 0;

			let cmd: string;
			if (hasFd) {
				cmd = `fd "${pattern}" "${searchDir}" --no-ignore -H 2>/dev/null | head -${limit}`;
			} else {
				cmd =
					process.platform === 'win32'
						? `powershell -Command "Get-ChildItem -Path '${searchDir}' -Recurse -Filter '${pattern}' -ErrorAction SilentlyContinue | Select-Object -First ${limit} | %% { $_.FullName }"`
						: `find "${searchDir}" -name "${pattern}" 2>/dev/null | head -${limit}`;
			}

			const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: 'pipe' });
			const results = stdout.trim();
			if (!results) return textResult('No files matched the pattern.');

			const lines = results.split('\n');
			const truncated = lines.length >= limit;
			return textResult(
				lines.join('\n') + (truncated ? `\n... (${lines.length} results, truncated at ${limit})` : ''),
			);
		} catch (err: unknown) {
			const error = err as { message?: string };
			return errorResult(`Glob search failed: ${error.message || 'unknown error'}`);
		}
	},
};
