import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, relative, basename } from 'path';

export const writeTool: SpectraTool = {
	name: 'write',
	capabilities: { reads: false, writes: true },
	description: `Write content to a file, creating it if it doesn't exist.
If the file exists, it will be overwritten.
For small changes to existing files, prefer the edit tool.
Creates parent directories automatically if they don't exist.`,
	displayName: (args: { path: string }) => relative(process.cwd(), resolve(args.path)),
	parameters: z.object({
		path: z.string().describe('Absolute or relative path to the file to write'),
		content: z.string().describe('The full content to write to the file'),
	}),
	execute: async ({ path, content }) => {
		const resolved = resolve(process.cwd(), path);
		const parentDir = dirname(resolved);
		if (!existsSync(parentDir)) {
			mkdirSync(parentDir, { recursive: true });
		}
		const oldContent = existsSync(resolved) ? readFileSync(resolved, 'utf-8') : '';
		writeFileSync(resolved, content, 'utf-8');

		const fileName = basename(resolved);
		const patch = createTwoFilesPatch(
			oldContent ? `a/${fileName}` : '/dev/null',
			`b/${fileName}`,
			oldContent,
			content,
			undefined,
			undefined,
			{ context: 3 }
		);

		return textResult(patch);
	},
};
