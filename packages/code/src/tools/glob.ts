import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, spawnRg, textResult } from './utils.js';
import { resolve } from 'path';

export const globTool: SpectraTool = {
	name: 'glob',
	capabilities: { reads: true, writes: false },
	description: `Find files matching a glob pattern.
Uses ripgrep (rg) for fast file listing.
Supports common glob patterns like **/*.ts, src/**/*.css, etc.
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
			const args = [
				'--no-config',
				'--files',
				'--hidden',
				'--glob=!.git/*',
				`--glob=${pattern}`,
				searchDir,
			];

			const result = await spawnRg(args);

			if (result.code > 1) {
				return errorResult(`ripgrep error: ${result.stderr || 'unknown error'}`);
			}

			if (!result.stdout) return textResult('No files matched the pattern.');

			const lines = result.stdout.split('\n');
			const truncated = lines.length > limit;
			return textResult(
				lines.slice(0, limit).join('\n') + (truncated ? `\n... (${lines.length} results, truncated at ${limit})` : ''),
			);
		} catch (err: unknown) {
			const error = err as { message?: string };
			if (error.message === 'RIPGREP_NOT_FOUND') {
				return errorResult('ripgrep (rg) not found. Install it: https://github.com/BurntSushi/ripgrep#installation');
			}
			return errorResult(`Glob search failed: ${error.message || 'unknown error'}`);
		}
	},
};
