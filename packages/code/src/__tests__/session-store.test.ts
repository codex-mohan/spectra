import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '../services/session-store.js';

describe('Session Store (SQLite)', () => {
	let tmpDir: string;
	let store: SessionStore;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-test-'));
		store = new SessionStore(tmpDir);
	});

	afterEach(() => {
		store.close();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('creates and retrieves a session', () => {
		const session = store.create({ title: 'Test Session', model: 'claude-sonnet-4-20250514', provider: 'anthropic' });
		expect(session.id).toBeDefined();
		expect(session.title).toBe('Test Session');

		const loaded = store.get(session.id);
		expect(loaded).not.toBeNull();
		expect(loaded!.title).toBe('Test Session');
		expect(loaded!.messages).toHaveLength(0);
	});

	it('adds messages to a session', () => {
		const session = store.create({ title: 'Msg Test' });
		store.addMessage(session.id, { role: 'user', content: 'Hello', timestamp: Date.now() } as any);
		store.addMessage(session.id, { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }], timestamp: Date.now() } as any);

		const loaded = store.get(session.id);
		expect(loaded!.messages).toHaveLength(2);
		expect(loaded!.messages[0].role).toBe('user');
		expect(loaded!.messages[1].role).toBe('assistant');
	});

	it('lists sessions sorted by updated time', () => {
		const s1 = store.create({ title: 'First' });
		const s2 = store.create({ title: 'Second' });
		// Force s2 to have a later timestamp
		const loaded = store.get(s2.id)!;
		loaded.updated = Date.now() + 1000;
		store.save(loaded);

		const list = store.list();
		expect(list.length).toBeGreaterThanOrEqual(2);
		expect(list[0].id).toBe(s2.id);
	});

	it('deletes a session', () => {
		const session = store.create({ title: 'To Delete' });
		expect(store.get(session.id)).not.toBeNull();

		store.delete(session.id);
		expect(store.get(session.id)).toBeNull();
	});

	it('renames a session', () => {
		const session = store.create({ title: 'Old Name' });
		store.rename(session.id, 'New Name');
		expect(store.get(session.id)!.title).toBe('New Name');
	});

	it('forks a session with messages', () => {
		const session = store.create({ title: 'Original' });
		store.addMessage(session.id, { role: 'user', content: 'Hello', timestamp: Date.now() } as any);

		const forked = store.fork(session.id);
		expect(forked).not.toBeNull();
		expect(forked!.id).not.toBe(session.id);
		expect(forked!.title).toContain('fork');
		expect(forked!.messages).toHaveLength(1);
	});

	it('creates child sessions', () => {
		const parent = store.create({ title: 'Parent' });
		const child = store.createChild(parent.id, { title: 'Child' });

		expect(child.parentId).toBe(parent.id);

		const children = store.getChildren(parent.id);
		expect(children).toHaveLength(1);
		expect(children[0].id).toBe(child.id);
	});

	it('sets and clears revert state', () => {
		const session = store.create({ title: 'Revert Test' });
		store.addMessage(session.id, { role: 'user', content: 'msg1', timestamp: Date.now() } as any);

		store.setRevert(session.id, 0);
		expect(store.get(session.id)!.revert!.messageIndex).toBe(0);

		store.clearRevert(session.id);
		expect(store.get(session.id)!.revert).toBeUndefined();
	});

	it('adds and retrieves checkpoints', () => {
		const session = store.create({ title: 'Checkpoint Test' });
		store.addCheckpoint(session.id, 0, 'Before edit', 'cp-1');

		const cp = store.getCheckpoint(session.id, 'cp-1');
		expect(cp).toBeDefined();
		expect(cp!.label).toBe('Before edit');
		expect(cp!.turnIndex).toBe(0);

		const all = store.getCheckpoints(session.id);
		expect(all).toHaveLength(1);
	});

	it('auto-titles from first user message', () => {
		const session = store.create({});
		expect(session.title).toBe('New Session');

		store.addMessage(session.id, { role: 'user', content: 'What is the meaning of life?', timestamp: Date.now() } as any);
		const loaded = store.get(session.id);
		expect(loaded!.title).toBe('What is the meaning of life?');
	});

	it('filters sessions by directory', () => {
		store.create({ title: 'Dir A', directory: '/a' });
		store.create({ title: 'Dir B', directory: '/b' });

		const dirA = store.list('/a');
		expect(dirA).toHaveLength(1);
		expect(dirA[0].directory).toBe('/a');
	});
});
