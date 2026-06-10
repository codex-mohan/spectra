import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, relative } from 'path';

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
		const existed = existsSync(resolved);
		writeFileSync(resolved, content, 'utf-8');
		return textResult(`${existed ? 'Updated' : 'Created'} ${relative(process.cwd(), resolved)}`);
	},
};
