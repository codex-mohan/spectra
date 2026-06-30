import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getGlobalDataDir } from '../utils/paths.js';
import type { Message } from '@mohanscodex/spectra-ai';

type SqliteDatabase = {
	exec(sql: string): void;
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
		run(...params: unknown[]): { changes: number };
	};
	transaction<T extends (...args: any[]) => any>(fn: T): T;
	close(): void;
};

function openDatabase(path: string): SqliteDatabase {
	try {
		// bun runtime
		const { Database } = require('bun:sqlite') as { Database: new (path: string) => SqliteDatabase };
		return new Database(path);
	} catch {
		// node runtime (vitest)
		const Database = require('better-sqlite3') as { new (path: string): SqliteDatabase };
		return new Database(path);
	}
}

export interface SessionInfo {
	id: string;
	title: string;
	agent: string;
	model: string;
	provider: string;
	thinkingEffort?: string;
	created: number;
	updated: number;
	messageCount: number;
	directory: string;
	parentId?: string | null;
}

export interface SessionCheckpoint {
	id: string;
	turnIndex: number;
	timestamp: number;
	label: string;
}

export interface SessionRevert {
	messageIndex: number;
	checkpointId?: string;
}

export interface SessionData {
	id: string;
	title: string;
	agent: string;
	model: string;
	provider: string;
	thinkingEffort?: string;
	created: number;
	updated: number;
	directory: string;
	parentId?: string | null;
	messages: Message[];
	revert?: SessionRevert;
	checkpoints?: SessionCheckpoint[];
}

export class SessionStore {
	private db: SqliteDatabase;

	constructor(dataDir?: string) {
		const dir = dataDir || join(getGlobalDataDir(), 'sessions');
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const dbPath = join(dir, 'sessions.db');
		this.db = openDatabase(dbPath);
		this.db.exec('PRAGMA journal_mode = WAL');
		this.db.exec('PRAGMA foreign_keys = ON');
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				agent TEXT NOT NULL DEFAULT 'build',
				model TEXT NOT NULL DEFAULT '',
				provider TEXT NOT NULL DEFAULT '',
				thinking_effort TEXT,
				created INTEGER NOT NULL,
				updated INTEGER NOT NULL,
				directory TEXT NOT NULL,
				parent_id TEXT,
				revert_message_index INTEGER,
				revert_checkpoint_id TEXT,
				FOREIGN KEY (parent_id) REFERENCES sessions(id) ON DELETE SET NULL
			);

			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL,
				position INTEGER NOT NULL,
				data TEXT NOT NULL,
				FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS checkpoints (
				id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				turn_index INTEGER NOT NULL,
				timestamp INTEGER NOT NULL,
				label TEXT NOT NULL,
				PRIMARY KEY (id, session_id),
				FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, position);
			CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
			CREATE INDEX IF NOT EXISTS idx_sessions_directory ON sessions(directory);
			CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated DESC);
		`);
	}

	private generateId(): string {
		return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
	}

	list(dir?: string): SessionInfo[] {
		const query = dir
			? `SELECT * FROM sessions WHERE directory = ? ORDER BY updated DESC`
			: `SELECT * FROM sessions ORDER BY updated DESC`;
		const rows = dir ? this.db.prepare(query).all(dir) : this.db.prepare(query).all();

		return (rows as any[]).map((row) => {
			const countStmt = this.db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?');
			const { cnt } = countStmt.get(row.id) as { cnt: number };
			return {
				id: row.id,
				title: row.title,
				agent: row.agent,
				model: row.model,
				provider: row.provider,
				thinkingEffort: row.thinking_effort ?? undefined,
				created: row.created,
				updated: row.updated,
				messageCount: cnt,
				directory: row.directory,
				parentId: row.parent_id ?? null,
			};
		});
	}

	listTopLevel(dir?: string): SessionInfo[] {
		return this.list(dir).filter((session) => !session.parentId);
	}

	get(id: string): SessionData | null {
		const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
		if (!row) return null;

		const messages = this.db
			.prepare('SELECT data FROM messages WHERE session_id = ? ORDER BY position ASC')
			.all(id) as { data: string }[];

		const checkpoints = this.db
			.prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY turn_index ASC')
			.all(id) as any[];

		return {
			id: row.id,
			title: row.title,
			agent: row.agent,
			model: row.model,
			provider: row.provider,
			thinkingEffort: row.thinking_effort ?? undefined,
			created: row.created,
			updated: row.updated,
			directory: row.directory,
			parentId: row.parent_id ?? null,
			messages: messages.map((m) => JSON.parse(m.data)),
			revert: row.revert_message_index != null
				? { messageIndex: row.revert_message_index, checkpointId: row.revert_checkpoint_id ?? undefined }
				: undefined,
			checkpoints: checkpoints.length > 0
				? checkpoints.map((cp) => ({ id: cp.id, turnIndex: cp.turn_index, timestamp: cp.timestamp, label: cp.label }))
				: undefined,
		};
	}

	create(input: {
		title?: string;
		agent?: string;
		model?: string;
		provider?: string;
		thinkingEffort?: string;
		directory?: string;
	}): SessionData {
		const id = this.generateId();
		const now = Date.now();
		const session: SessionData = {
			id,
			title: input.title || 'New Session',
			agent: input.agent || 'build',
			model: input.model || '',
			provider: input.provider || input.model?.split('/')[0] || '',
			thinkingEffort: input.thinkingEffort,
			created: now,
			updated: now,
			directory: input.directory || process.cwd(),
			messages: [],
		};
		this.save(session);
		return session;
	}

	save(session: SessionData): void {
		const now = Date.now();
		session.updated = now;

		const saveAll = this.db.transaction(() => {
			const existing = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(session.id);
			if (existing) {
				this.db.prepare(
					`UPDATE sessions SET title = ?, agent = ?, model = ?, provider = ?, thinking_effort = ?, updated = ?, directory = ?, parent_id = ?,
					 revert_message_index = ?, revert_checkpoint_id = ? WHERE id = ?`
				).run(
					session.title, session.agent, session.model, session.provider, session.thinkingEffort ?? null,
					session.updated, session.directory, session.parentId ?? null,
					session.revert?.messageIndex ?? null, session.revert?.checkpointId ?? null,
					session.id
				);
			} else {
				this.db.prepare(
					`INSERT INTO sessions (id, title, agent, model, provider, thinking_effort, created, updated, directory, parent_id,
					 revert_message_index, revert_checkpoint_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				).run(
					session.id, session.title, session.agent, session.model, session.provider, session.thinkingEffort ?? null,
					session.created, session.updated, session.directory, session.parentId ?? null,
					session.revert?.messageIndex ?? null, session.revert?.checkpointId ?? null
				);
			}

			// Replace all messages atomically with session row
			this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(session.id);
			const insertMsg = this.db.prepare('INSERT INTO messages (session_id, position, data) VALUES (?, ?, ?)');
			for (let i = 0; i < session.messages.length; i++) {
				insertMsg.run(session.id, i, JSON.stringify(session.messages[i]));
			}

			// Replace checkpoints atomically
			this.db.prepare('DELETE FROM checkpoints WHERE session_id = ?').run(session.id);
			if (session.checkpoints?.length) {
				const insertCp = this.db.prepare('INSERT INTO checkpoints (id, session_id, turn_index, timestamp, label) VALUES (?, ?, ?, ?, ?)');
				for (const cp of session.checkpoints) {
					insertCp.run(cp.id, session.id, cp.turnIndex, cp.timestamp, cp.label);
				}
			}
		});

		saveAll();
	}

	delete(id: string): boolean {
		const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
		return result.changes > 0;
	}

	rename(id: string, title: string): boolean {
		const result = this.db.prepare('UPDATE sessions SET title = ?, updated = ? WHERE id = ?').run(title, Date.now(), id);
		return result.changes > 0;
	}

	fork(id: string): SessionData | null {
		const original = this.get(id);
		if (!original) return null;
		const forked: SessionData = {
			...original,
			id: this.generateId(),
			title: `${original.title} (fork)`,
			created: Date.now(),
			updated: Date.now(),
			messages: [...original.messages],
		};
		this.save(forked);
		return forked;
	}

	archive(id: string): boolean {
		const session = this.get(id);
		if (!session) return false;
		// Mark archived by moving to a special directory field (or just delete)
		// For simplicity, just delete — callers can export before archiving
		return this.delete(id);
	}

	addMessage(sessionId: string, message: Message): SessionData | null {
		const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
		if (!row) return null;

		const countResult = this.db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?').get(sessionId) as { cnt: number };
		const position = countResult.cnt;

		const now = Date.now();
		const updateTitle = position === 0 && message.role === 'user';
		const newTitle = updateTitle
			? (typeof message.content === 'string' ? message.content.slice(0, 60) : 'User message')
			: row.title;

		this.db.prepare('INSERT INTO messages (session_id, position, data) VALUES (?, ?, ?)').run(sessionId, position, JSON.stringify(message));

		if (updateTitle) {
			this.db.prepare('UPDATE sessions SET title = ?, updated = ? WHERE id = ?').run(newTitle, now, sessionId);
		} else {
			this.db.prepare('UPDATE sessions SET updated = ? WHERE id = ?').run(now, sessionId);
		}

		return this.get(sessionId);
	}

	// ─── Revert State ──────────────────────────────────────────────────────

	setRevert(sessionId: string, messageIndex: number, checkpointId?: string): SessionData | null {
		const session = this.get(sessionId);
		if (!session) return null;
		session.revert = { messageIndex, checkpointId };
		session.updated = Date.now();
		this.save(session);
		return session;
	}

	clearRevert(sessionId: string): SessionData | null {
		const session = this.get(sessionId);
		if (!session) return null;
		session.revert = undefined;
		session.updated = Date.now();
		this.save(session);
		return session;
	}

	// ─── Checkpoints ───────────────────────────────────────────────────────

	addCheckpoint(sessionId: string, turnIndex: number, label: string, checkpointId: string): SessionData | null {
		const session = this.get(sessionId);
		if (!session) return null;
		if (!session.checkpoints) session.checkpoints = [];
		session.checkpoints.push({ id: checkpointId, turnIndex, timestamp: Date.now(), label });
		session.updated = Date.now();
		this.save(session);
		return session;
	}

	getCheckpoint(sessionId: string, checkpointId: string): SessionCheckpoint | undefined {
		const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ? AND session_id = ?').get(checkpointId, sessionId) as any;
		if (!row) return undefined;
		return { id: row.id, turnIndex: row.turn_index, timestamp: row.timestamp, label: row.label };
	}

	getCheckpoints(sessionId: string): SessionCheckpoint[] {
		const rows = this.db.prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY turn_index ASC').all(sessionId) as any[];
		return rows.map((r) => ({ id: r.id, turnIndex: r.turn_index, timestamp: r.timestamp, label: r.label }));
	}

	// ─── Hierarchy ─────────────────────────────────────────────────────────

	getChildren(parentId: string): SessionInfo[] {
		return this.list().filter((s) => s.parentId === parentId);
	}

	getParent(childId: string): SessionData | null {
		const child = this.get(childId);
		if (!child?.parentId) return null;
		return this.get(child.parentId);
	}

	createChild(
		parentId: string,
		input: { title?: string; agent?: string; model?: string; provider?: string; thinkingEffort?: string },
	): SessionData {
		const id = this.generateId();
		const now = Date.now();
		const session: SessionData = {
			id,
			title: input.title || 'Subagent Session',
			agent: input.agent || 'build',
			model: input.model || '',
			provider: input.provider || input.model?.split('/')[0] || '',
			thinkingEffort: input.thinkingEffort,
			created: now,
			updated: now,
			directory: process.cwd(),
			parentId,
			messages: [],
		};
		this.save(session);
		return session;
	}

	close(): void {
		this.db.close();
	}
}
