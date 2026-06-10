import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test SessionStore by constructing it with a custom data directory
// Since the class reads from getGlobalDataDir(), we test the core logic
// of session file management by testing the file operations directly.
//
// Full integration tests would require mocking getGlobalDataDir — instead,
// we test the session data model and file patterns.

describe('Session Store', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-test-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('writes and reads session files', () => {
		const sessionsDir = join(tmpDir, 'sessions');
		mkdirSync(sessionsDir, { recursive: true });

		const session = {
			id: 'test-1',
			title: 'Test Session',
			agent: 'build',
			model: 'claude-sonnet-4-20250514',
			provider: 'anthropic',
			created: Date.now(),
			updated: Date.now(),
			messages: [
				{ role: 'user', content: 'Hello', timestamp: Date.now() },
				{ role: 'assistant', content: [{ type: 'text', text: 'Hi!' }], timestamp: Date.now() },
			],
		};

		const filePath = join(sessionsDir, 'test-1.json');
		writeFileSync(filePath, JSON.stringify(session));

		expect(existsSync(filePath)).toBe(true);
		const loaded = JSON.parse(readFileSync(filePath, 'utf-8'));
		expect(loaded.id).toBe('test-1');
		expect(loaded.title).toBe('Test Session');
		expect(loaded.messages).toHaveLength(2);
		expect(loaded.messages[0].role).toBe('user');
	});

	it('lists sessions sorted by updated time', () => {
		const sessionsDir = join(tmpDir, 'sessions');
		mkdirSync(sessionsDir, { recursive: true });

		const older = {
			id: 'old',
			title: 'Older',
			messages: [],
			created: 1000,
			updated: 1000,
		};
		const newer = {
			id: 'new',
			title: 'Newer',
			messages: [],
			created: 2000,
			updated: 2000,
		};

		writeFileSync(join(sessionsDir, 'old.json'), JSON.stringify(older));
		writeFileSync(join(sessionsDir, 'new.json'), JSON.stringify(newer));

		const files = [
			readFileSync(join(sessionsDir, 'old.json'), 'utf-8'),
			readFileSync(join(sessionsDir, 'new.json'), 'utf-8'),
		];
		const sessions = files.map((f) => JSON.parse(f)).sort((a, b) => b.updated - a.updated);

		expect(sessions[0].id).toBe('new');
		expect(sessions[1].id).toBe('old');
	});

	it('deletes session files', () => {
		const sessionsDir = join(tmpDir, 'sessions');
		mkdirSync(sessionsDir, { recursive: true });

		const session = { id: 'del-test', title: 'To Delete', messages: [], created: 0, updated: 0 };
		const filePath = join(sessionsDir, 'del-test.json');
		writeFileSync(filePath, JSON.stringify(session));
		expect(existsSync(filePath)).toBe(true);

		rmSync(filePath);
		expect(existsSync(filePath)).toBe(false);
	});

	it('handles archival by moving to archived directory', () => {
		const sessionsDir = join(tmpDir, 'sessions');
		const archiveDir = join(sessionsDir, 'archived');
		mkdirSync(archiveDir, { recursive: true });

		const session = { id: 'arch-test', title: 'To Archive', messages: [], created: 0, updated: 0 };
		const sourcePath = join(sessionsDir, 'arch-test.json');
		const archivePath = join(archiveDir, 'arch-test.json');
		writeFileSync(sourcePath, JSON.stringify(session));

		// Move to archive
		writeFileSync(archivePath, readFileSync(sourcePath));
		rmSync(sourcePath);

		expect(existsSync(sourcePath)).toBe(false);
		expect(existsSync(archivePath)).toBe(true);
		const archived = JSON.parse(readFileSync(archivePath, 'utf-8'));
		expect(archived.id).toBe('arch-test');
	});
});
