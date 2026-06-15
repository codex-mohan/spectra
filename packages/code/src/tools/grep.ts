import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, spawnRg, textResult } from './utils.js';
import { resolve } from 'path';

export const grepTool: SpectraTool = {
	name: 'grep',
	capabilities: { reads: true, writes: false },
	description: `Search file contents using regular expressions.
Uses ripgrep (rg) for fast searching.
Returns matching file paths, line numbers, and the matched lines.
Results are truncated to prevent large outputs.`,
	displayName: (args: { pattern: string }) => `"${args.pattern}"`,
	parameters: z.object({
		pattern: z.string().describe('The regex pattern to search for'),
		include: z.string().optional().describe("File pattern to include (e.g. '*.ts', '*.{ts,js}')"),
		path: z.string().optional().describe('Directory to search in (defaults to cwd)'),
		maxResults: z.number().optional().describe('Maximum number of results to return'),
	}),
	execute: async ({ pattern, include, path, maxResults }) => {
		const searchDir = path ? resolve(process.cwd(), path) : process.cwd();
		const limit = maxResults || 50;

		try {
			const args = [
				'-n',
				'--no-heading',
				'--hidden',
				'--no-config',
				'--glob=!.git/*',
				`--max-count=${limit}`,
			];

			if (include) {
				args.push(`--glob=${include}`);
			}

			args.push('--', pattern, searchDir);

			const result = await spawnRg(args);

			if (result.code > 1) {
				return errorResult(`ripgrep error: ${result.stderr || 'unknown error'}`);
			}

			if (!result.stdout) return textResult('No matches found.');

			const lines = result.stdout.split('\n');
			const truncated = lines.length >= limit;
			return textResult(
				lines.join('\n') + (truncated ? `\n... (truncated at ${limit} results)` : ''),
			);
		} catch (err: unknown) {
			const error = err as { message?: string };
			if (error.message === 'RIPGREP_NOT_FOUND') {
				return errorResult('ripgrep (rg) not found. Install it: https://github.com/BurntSushi/ripgrep#installation');
			}
			return errorResult(`Search failed: ${error.message || 'unknown error'}`);
		}
	},
};
