import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { execSync } from 'child_process';
import { resolve } from 'path';

export const grepTool: SpectraTool = {
	name: 'grep',
	capabilities: { reads: true, writes: false },
	description: `Search file contents using regular expressions.
Uses ripgrep (rg) if available, otherwise falls back to grep.
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
			let cmd: string;
			const useRipgrep =
				execSync('which rg 2>/dev/null || where rg 2>nul', { encoding: 'utf-8', timeout: 1000 }).trim().length > 0;
			if (useRipgrep) {
				const includeFlag = include ? `-g "${include}"` : '';
				cmd = `rg -n --no-heading "${pattern}" "${searchDir}" ${includeFlag} | head -${limit}`;
			} else {
				const includeFlag = include ? `--include="${include}"` : '';
				cmd = `grep -rn "${pattern}" "${searchDir}" ${includeFlag} 2>/dev/null | head -${limit}`;
			}

			const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 15000, maxBuffer: 1024 * 1024 });
			const results = stdout.trim();
			if (!results) return textResult('No matches found.');

			const lineCount = results.split('\n').length;
			const truncated = lineCount >= limit;
			return textResult(results + (truncated ? `\n... (truncated at ${limit} results)` : ''));
		} catch (err: unknown) {
			const error = err as { message?: string; stderr?: string };
			if (error.message?.includes('command failed') || error.stderr) {
				return errorResult('No ripgrep or grep found on system, or search failed. Try using glob instead.');
			}
			return errorResult(`Search failed: ${error.message || 'unknown error'}`);
		}
	},
};
