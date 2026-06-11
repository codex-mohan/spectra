import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, basename } from 'path';

export const editTool: SpectraTool = {
	name: 'edit',
	capabilities: { reads: false, writes: true },
	description: `Edit a file by finding and replacing text.
The tool finds the exact old string in the file and replaces it with the new string.
For best results:
- Include enough surrounding context in the old string for a unique match
- Use exact text including whitespace
- If the old string appears multiple times, include more context to disambiguate
Prefer the write tool for large or new files.`,
	displayName: (args: { path: string }) => relative(process.cwd(), resolve(args.path)),
	parameters: z.object({
		path: z.string().describe('Absolute or relative path to the file to edit'),
		oldString: z.string().describe('The exact text to find and replace'),
		newString: z.string().describe('The replacement text'),
	}),
	execute: async ({ path, oldString, newString }) => {
		const resolved = resolve(process.cwd(), path);
		if (!existsSync(resolved)) {
			return errorResult(`File not found: ${resolved}`);
		}

		const content = readFileSync(resolved, 'utf-8');
		if (!content.includes(oldString)) {
			return errorResult(`Could not find the specified text in ${relative(process.cwd(), resolved)}.
The text may have different whitespace or formatting. Try reading the file first.`);
		}

		const newContent = content.replace(oldString, newString);
		if (newContent === content) {
			return errorResult("No changes made - the replacement didn't modify the file.");
		}

		writeFileSync(resolved, newContent, 'utf-8');

		const fileName = basename(resolved);
		const patch = createTwoFilesPatch(
			`a/${fileName}`,
			`b/${fileName}`,
			content,
			newContent,
			undefined,
			undefined,
			{ context: 3 }
		);

		return textResult(patch);
	},
};
