import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { readFileSync, statSync, readdirSync, existsSync } from 'fs';
import { resolve, relative } from 'path';

export const readTool: SpectraTool = {
	name: 'read',
	capabilities: { reads: true, writes: false },
	description: `Read the contents of a file or directory.
Supports reading files with optional line ranges.
When reading a directory, lists entries with types.
For large files, use the offset and limit parameters to read specific sections.`,
	displayName: (args: { path: string }) => relative(process.cwd(), resolve(args.path)),
	parameters: z.object({
		path: z.string().describe('Absolute or relative path to the file or directory'),
		offset: z.number().optional().describe('Starting line number (1-indexed)'),
		limit: z.number().optional().describe('Maximum number of lines to read'),
	}),
	execute: async ({ path, offset, limit }) => {
		const resolved = resolve(process.cwd(), path);
		if (!existsSync(resolved)) {
			return errorResult(`File not found: ${resolved}`);
		}

		const stat = statSync(resolved);
		if (stat.isDirectory()) {
			const entries = readdirSync(resolved, { withFileTypes: true });
			const listing = entries.map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
			return textResult(`Directory: ${resolved}\n${listing}`);
		}

		if (stat.size > 1024 * 1024) {
			return errorResult(
				`File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Use offset/limit or grep instead.`,
			);
		}

		const content = readFileSync(resolved, 'utf-8');
		const lines = content.split('\n');
		const start = offset ? Math.max(0, offset - 1) : 0;
		const end = limit ? Math.min(lines.length, start + limit) : lines.length;
		const slice = lines.slice(start, end);

		const result = slice
			.map((line, i) => {
				const lineNum = start + i + 1;
				return `${String(lineNum).padStart(4)} │ ${line}`;
			})
			.join('\n');

		const header = `${resolved} (${lines.length} lines)`;
		if (start > 0 || end < lines.length) {
			return textResult(`${header} [lines ${start + 1}-${end}]\n${result}`);
		}
		return textResult(`${header}\n${result}`);
	},
};
