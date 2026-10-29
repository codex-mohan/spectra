import { readFileSync, writeFileSync } from 'fs';
import { relative } from 'path';
import { createTwoFilesPatch } from 'diff';
import { fileURLToPath } from 'url';
import type { Range } from './protocol.js';
import { offsetAt } from './positions.js';

export interface WorkspaceTextEdit {
	path: string;
	range: Range;
	newText: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTextEdit(value: unknown): value is { range: Range; newText: string } {
	return isRecord(value) && isRecord(value.range) && typeof value.newText === 'string';
}

/** Extract edits from either `changes` or `documentChanges`. */
export function extractWorkspaceEdits(edit: unknown): WorkspaceTextEdit[] {
	if (!isRecord(edit)) return [];
	const edits: WorkspaceTextEdit[] = [];

	if (isRecord(edit.changes)) {
		for (const [uri, value] of Object.entries(edit.changes)) {
			if (!Array.isArray(value)) continue;
			const path = fileURLToPath(uri);
			for (const item of value) {
				if (isTextEdit(item)) edits.push({ path, range: item.range, newText: item.newText });
			}
		}
	}

	if (Array.isArray(edit.documentChanges)) {
		for (const change of edit.documentChanges) {
			if (!isRecord(change) || !isRecord(change.textDocument) || !Array.isArray(change.edits)) continue;
			const uri = change.textDocument.uri;
			if (typeof uri !== 'string') continue;
			const path = fileURLToPath(uri);
			for (const item of change.edits) {
				if (isTextEdit(item)) edits.push({ path, range: item.range, newText: item.newText });
			}
		}
	}

	return edits;
}

export interface ApplyResult {
	files: string[];
	preview: string;
}

export function applyWorkspaceEdits(
	edits: WorkspaceTextEdit[],
	validatePath: (path: string) => string | null,
): ApplyResult {
	const byFile = new Map<string, WorkspaceTextEdit[]>();
	for (const edit of edits) {
		const problem = validatePath(edit.path);
		if (problem) throw new Error(problem);
		const list = byFile.get(edit.path) ?? [];
		list.push(edit);
		byFile.set(edit.path, list);
	}

	const previews: string[] = [];
	for (const [path, list] of byFile) {
		const before = readFileSync(path, 'utf8');
		const sorted = [...list].sort((a, b) => {
			const aStart = offsetAt(before, a.range.start.line, a.range.start.character);
			const bStart = offsetAt(before, b.range.start.line, b.range.start.character);
			return bStart - aStart;
		});
		let after = before;
		for (const edit of sorted) {
			const start = offsetAt(after, edit.range.start.line, edit.range.start.character);
			const end = offsetAt(after, edit.range.end.line, edit.range.end.character);
			after = `${after.slice(0, start)}${edit.newText}${after.slice(end)}`;
		}
		writeFileSync(path, after, 'utf8');
		previews.push(createTwoFilesPatch(path, path, before, after, undefined, undefined, { context: 2 }));
	}

	return {
		files: [...byFile.keys()].map((path) => relative(process.cwd(), path) || path),
		preview: previews.join('\n'),
	};
}

/** Render edits without writing, for `apply: false`. */
export function previewWorkspaceEdits(edits: WorkspaceTextEdit[]): string {
	const byFile = new Map<string, WorkspaceTextEdit[]>();
	for (const edit of edits) {
		const list = byFile.get(edit.path) ?? [];
		list.push(edit);
		byFile.set(edit.path, list);
	}

	const previews: string[] = [];
	for (const [path, list] of byFile) {
		const before = readFileSync(path, 'utf8');
		const sorted = [...list].sort((a, b) => {
			const aStart = offsetAt(before, a.range.start.line, a.range.start.character);
			const bStart = offsetAt(before, b.range.start.line, b.range.start.character);
			return bStart - aStart;
		});
		let after = before;
		for (const edit of sorted) {
			const start = offsetAt(after, edit.range.start.line, edit.range.start.character);
			const end = offsetAt(after, edit.range.end.line, edit.range.end.character);
			after = `${after.slice(0, start)}${edit.newText}${after.slice(end)}`;
		}
		previews.push(createTwoFilesPatch(path, path, before, after, undefined, undefined, { context: 2 }));
	}

	return previews.join('\n');
}
