import * as fs from 'node:fs';
import * as path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createTwoFilesPatch } from 'diff';
import { NodeFilesystem, Patch, Patcher, type BlockResolver } from './hashline/index.js';
import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { applyEdit } from './edit-match.js';
import { ReadSnapshotStore } from './read-snapshots.js';
import { errorResult, textResult } from './utils.js';

export interface EditToolOptions {
	cwd?: string;
	snapshots?: ReadSnapshotStore;
}

const editParameters = z.object({
	path: z.string().optional().describe('Absolute or relative path to the file to edit'),
	oldString: z.string().optional().describe('The exact text to find and replace'),
	newString: z.string().optional().describe('The replacement text'),
	patch: z.string().optional().describe('Native hashline patch with [path#TAG] sections produced by read'),
}).superRefine((value, context) => {
	if (value.patch) {
		if (value.path || value.oldString || value.newString) context.addIssue({ code: z.ZodIssueCode.custom, message: 'patch cannot be combined with path, oldString, or newString' });
		return;
	}
	if (!value.path || value.oldString === undefined || value.newString === undefined) {
		context.addIssue({ code: z.ZodIssueCode.custom, message: 'provide patch or path, oldString, and newString' });
	}
});
const blockResolver: BlockResolver = ({ text, line }) => {
	const lines = text.split('\n');
	const start = line - 1;
	if (start < 0 || start >= lines.length || lines[start].trim().length === 0) return null;
	const indentation = lines[start].match(/^\s*/)?.[0].length ?? 0;
	let depth = 0;
	for (let index = start; index < lines.length; index++) {
		const source = lines[index].replace(/(["'`])(?:\\.|(?!\1)[^\\])*?\1/g, '');
		depth += (source.match(/[({[]/g) ?? []).length - (source.match(/[)}\]]/g) ?? []).length;
		if (index > start && depth <= 0 && (indentation === 0 || (lines[index].match(/^\s*/)?.[0].length ?? 0) <= indentation)) {
			return { start: line, end: index + 1 };
		}
	}
	for (let index = start + 1; index < lines.length; index++) {
		const currentIndentation = lines[index].match(/^\s*/)?.[0].length ?? 0;
		if (lines[index].trim().length > 0 && currentIndentation <= indentation) return { start: line, end: index };
	}
	return null;
};


class WorkspaceFilesystem extends NodeFilesystem {
	constructor(private readonly cwd: string) {
		super();
	}

	override canonicalPath(filePath: string): string {
		try {
			return fs.realpathSync.native(filePath);
		} catch {
			return path.resolve(filePath);
		}
	}

	override allowTagPathRecovery(_authoredPath: string, resolvedPath: string): boolean {
		const relative = path.relative(this.cwd, resolvedPath);
		return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
	}
}

export function createEditTool(options: EditToolOptions = {}): SpectraTool<typeof editParameters> {
	const cwd = path.resolve(options.cwd ?? process.cwd());
	const snapshots = options.snapshots ?? new ReadSnapshotStore();
	return {
		name: 'edit',
		capabilities: { reads: false, writes: true },
		streaming: { arguments: true },
		description: `Edit an existing file with an exact replacement, or apply a complete native hashline patch returned by read.
Exact replacement: provide path, oldString, and newString. Matching is whitespace-tolerant.
Hashline: provide patch only. Every edited section must use the current [path#TAG] header emitted by read. The patcher supports validated multi-section edits, create/delete/move operations, stale-version recovery, and seen-line enforcement. Patch paths and recovered destinations are restricted to the working directory.
Always read before modifying code.`,
		displayName: (args) => args.patch ? 'Apply hashline patch' : path.relative(cwd, path.resolve(cwd, args.path ?? '')),
		parameters: editParameters,
		execute: async ({ path: filePath, oldString, newString, patch }) => {
			try {
				if (patch) {
					const result = await new Patcher({ fs: new WorkspaceFilesystem(cwd), snapshots: snapshots.store, blockResolver }).apply(Patch.parse(patch, { cwd }));
					return textResult(result.sections.map((section) => `${section.header}\n${section.op}${section.firstChangedLine ? ` at line ${section.firstChangedLine}` : ''}`).join('\n'));
				}
				const resolved = path.resolve(cwd, filePath!);
				if (!existsSync(resolved)) return errorResult(`File not found: ${resolved}`);
				const content = readFileSync(resolved, 'utf8');
				const result = applyEdit(content, oldString!, newString!);
				if (result.error) return errorResult(`${result.error} [${path.relative(cwd, resolved)}]`);
				const newContent = result.content!;
				writeFileSync(resolved, newContent, 'utf8');
				await snapshots.record(resolved, newContent, newContent.split(/\r?\n/).map((_, index) => index + 1));
				const fileName = path.basename(resolved);
				return textResult(createTwoFilesPatch(`a/${fileName}`, `b/${fileName}`, content, newContent, undefined, undefined, { context: 3 }));
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export const editTool = createEditTool();
