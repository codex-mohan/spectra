import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, copyFileSync, openSync, closeSync } from 'fs';
import { join } from 'path';
import { getGlobalDataDir } from '../utils/paths.js';

const DELIMITER = '§';

export type MemoryTarget = 'memory' | 'user' | 'project';

interface MemoryFileSpec {
	path: string;
	charLimit: number;
	label: string;
}

function getMemoryDir(): string {
	return join(getGlobalDataDir(), 'memory');
}

function getProjectMemoryDir(cwd?: string): string {
	const dir = cwd || process.cwd();
	return join(dir, '.spectra', 'memory');
}

export function getMemoryFileSpec(target: MemoryTarget, cwd?: string): MemoryFileSpec {
	switch (target) {
		case 'memory':
			return { path: join(getMemoryDir(), 'MEMORY.md'), charLimit: 2200, label: 'Memory' };
		case 'user':
			return { path: join(getMemoryDir(), 'USER.md'), charLimit: 1375, label: 'User Profile' };
		case 'project':
			return { path: join(getProjectMemoryDir(cwd), 'PROJECT.md'), charLimit: 2200, label: 'Project Memory' };
	}
}

export function readEntries(target: MemoryTarget, cwd?: string): string[] {
	const spec = getMemoryFileSpec(target, cwd);
	if (!existsSync(spec.path)) return [];
	const content = readFileSync(spec.path, 'utf-8').trim();
	if (!content) return [];
	return content.split(`\n${DELIMITER}\n`).map((e) => e.trim()).filter(Boolean);
}

export function charUsage(target: MemoryTarget, cwd?: number): number {
	const spec = getMemoryFileSpec(target, cwd as unknown as string);
	if (!existsSync(spec.path)) return 0;
	return readFileSync(spec.path, 'utf-8').length;
}

function acquireLock(lockPath: string): void {
	const maxRetries = 10;
	const delayMs = 50;
	for (let i = 0; i < maxRetries; i++) {
		try {
			const fd = openSync(lockPath, 'wx');
			closeSync(fd);
			return;
		} catch {
			if (i === maxRetries - 1) throw new Error(`Could not acquire lock: ${lockPath}`);
			const start = Date.now();
			while (Date.now() - start < delayMs) { /* spin */ }
		}
	}
}

function releaseLock(lockPath: string): void {
	try { unlinkSync(lockPath); } catch { /* ignore */ }
}

function atomicWrite(filePath: string, content: string): void {
	const dir = filePath.substring(0, filePath.lastIndexOf('/')) || filePath.substring(0, filePath.lastIndexOf('\\'));
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const tmpPath = `${filePath}.tmp`;
	writeFileSync(tmpPath, content, 'utf-8');
	renameSync(tmpPath, filePath);
}

function driftCheck(filePath: string, expectedSnapshot: string | null): void {
	if (!existsSync(filePath)) return;
	const current = readFileSync(filePath, 'utf-8');
	if (expectedSnapshot !== null && current !== expectedSnapshot) {
		const bakPath = `${filePath}.bak.${Date.now()}`;
		copyFileSync(filePath, bakPath);
		throw new Error(`External modification detected on ${filePath}. Backup saved to ${bakPath}. Refusing to overwrite.`);
	}
}

export function writeEntries(target: MemoryTarget, entries: string[], cwd?: string): void {
	const spec = getMemoryFileSpec(target, cwd);
	const content = entries.join(`\n${DELIMITER}\n`);
	if (content.length > spec.charLimit) {
		throw new Error(`${spec.label} would exceed char limit (${content.length}/${spec.charLimit}). Remove or shorten existing entries first.`);
	}
	const lockPath = `${spec.path}.lock`;
	acquireLock(lockPath);
	try {
		const expectedSnapshot = existsSync(spec.path) ? readFileSync(spec.path, 'utf-8') : null;
		driftCheck(spec.path, expectedSnapshot);
		atomicWrite(spec.path, content);
	} finally {
		releaseLock(lockPath);
	}
}

export function addEntry(target: MemoryTarget, entry: string, cwd?: string): { success: boolean; message: string } {
	const spec = getMemoryFileSpec(target, cwd);
	const entries = readEntries(target, cwd);
	const trimmed = entry.trim();
	if (entries.some((e) => e === trimmed)) {
		return { success: false, message: `Entry already exists in ${spec.label}.` };
	}
	const newEntries = [...entries, trimmed];
	const newContent = newEntries.join(`\n${DELIMITER}\n`);
	if (newContent.length > spec.charLimit) {
		const currentSize = readFileSync(spec.path, 'utf-8').length;
		return { success: false, message: `${spec.label} would exceed char limit (${newContent.length}/${spec.charLimit}, currently ${currentSize}). Remove or shorten existing entries first.` };
	}
	writeEntries(target, newEntries, cwd);
	return { success: true, message: `Added to ${spec.label} (${newContent.length}/${spec.charLimit} chars).` };
}

export function replaceEntry(target: MemoryTarget, oldEntry: string, newEntry: string, cwd?: string): { success: boolean; message: string } {
	const spec = getMemoryFileSpec(target, cwd);
	const entries = readEntries(target, cwd);
	const idx = entries.findIndex((e) => e === oldEntry.trim());
	if (idx === -1) {
		return { success: false, message: `Entry not found in ${spec.label}.` };
	}
	const updated = [...entries];
	updated[idx] = newEntry.trim();
	const newContent = updated.join(`\n${DELIMITER}\n`);
	if (newContent.length > spec.charLimit) {
		return { success: false, message: `Replacement would exceed char limit (${newContent.length}/${spec.charLimit}).` };
	}
	writeEntries(target, updated, cwd);
	return { success: true, message: `Replaced entry in ${spec.label} (${newContent.length}/${spec.charLimit} chars).` };
}

export function removeEntry(target: MemoryTarget, entry: string, cwd?: string): { success: boolean; message: string } {
	const spec = getMemoryFileSpec(target, cwd);
	const entries = readEntries(target, cwd);
	const idx = entries.findIndex((e) => e === entry.trim());
	if (idx === -1) {
		return { success: false, message: `Entry not found in ${spec.label}.` };
	}
	entries.splice(idx, 1);
	writeEntries(target, entries, cwd);
	const newContent = entries.join(`\n${DELIMITER}\n`);
	return { success: true, message: `Removed from ${spec.label} (${newContent.length}/${spec.charLimit} chars).` };
}

export function loadMemorySnapshot(cwd?: string): string | null {
	const memory = readEntries('memory', cwd);
	const user = readEntries('user', cwd);
	const project = readEntries('project', cwd);

	const sections: string[] = [];
	if (user.length > 0) {
		sections.push(`## User Profile\n${user.join('\n')}`);
	}
	if (memory.length > 0) {
		sections.push(`## Memory\n${memory.join('\n')}`);
	}
	if (project.length > 0) {
		sections.push(`## Project Context\n${project.join('\n')}`);
	}
	if (sections.length === 0) return null;
	return `<memory>\n${sections.join('\n\n')}\n</memory>`;
}

export function getMemoryUsage(target: MemoryTarget, cwd?: string): { used: number; limit: number; entries: number } {
	const spec = getMemoryFileSpec(target, cwd);
	const entries = readEntries(target, cwd);
	const content = entries.join(`\n${DELIMITER}\n`);
	return { used: content.length, limit: spec.charLimit, entries: entries.length };
}
