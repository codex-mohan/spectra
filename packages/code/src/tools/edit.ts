import { z } from 'zod';
import { createTwoFilesPatch } from 'diff';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { applyEdit } from './edit-match.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, basename } from 'path';

export const editTool: SpectraTool = {
	name: 'edit',
	capabilities: { reads: false, writes: true },
	description: `Edit a file by finding and replacing text.
The tool finds oldString in the file and replaces it with newString.
Matching is whitespace-tolerant: tabs/spaces and \\r\\n/\\n differences are accepted.
For best results:
- Include enough surrounding context in the old string for a unique match
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

		// applyEdit runs a tolerant match pipeline (exact -> line-trimmed ->
		// whitespace-normalised -> indentation-flexible -> fuzzy anchors -> ...)
		// and splices the file's actual bytes, so tab/CRLF normalisation in the
		// oldString parameter no longer causes false "not found" failures. It
		// also normalises newString to the file's detected line ending.
		const result = applyEdit(content, oldString, newString);
		if (result.error) {
			return errorResult(`${result.error} [${relative(process.cwd(), resolved)}]`);
		}
		const newContent = result.content!;

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
