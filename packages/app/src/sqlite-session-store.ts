import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Session, SessionFilter, SessionStore } from './types.js';

export class SQLiteSessionStore implements SessionStore {
	private db: Database.Database;

	constructor(dbPath: string) {
		const dir = dirname(dbPath);
		if (dir && dir !== '.') {
			mkdirSync(dir, { recursive: true });
		}
		this.db = new Database(dbPath);
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        config TEXT NOT NULL,
        metadata TEXT NOT NULL,
        entries TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions((json_extract(metadata, '$.userId')));
      CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions((json_extract(metadata, '$.tenantId')));
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
    `);
	}

	async create(session: Session): Promise<Session> {
		const now = Date.now();
		const stmt = this.db.prepare(`
      INSERT INTO sessions (id, model, config, metadata, entries, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
		stmt.run(
			session.id,
			JSON.stringify(session.model),
			JSON.stringify(session.config),
			JSON.stringify(session.metadata),
			JSON.stringify(session.entries),
			now,
			now,
		);
		return session;
	}

	async load(id: string): Promise<Session | null> {
		const stmt = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`);
		const row = stmt.get(id) as
			| {
					id: string;
					model: string;
					config: string;
					metadata: string;
					entries: string;
					created_at: number;
					updated_at: number;
			  }
			| undefined;

		if (!row) return null;
		return this.hydrate(row);
	}

	async save(session: Session): Promise<void> {
		const stmt = this.db.prepare(`
      INSERT INTO sessions (id, model, config, metadata, entries, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        model = excluded.model,
        config = excluded.config,
        metadata = excluded.metadata,
        entries = excluded.entries,
        updated_at = excluded.updated_at
    `);
		stmt.run(
			session.id,
			JSON.stringify(session.model),
			JSON.stringify(session.config),
			JSON.stringify(session.metadata),
			JSON.stringify(session.entries),
			Date.now(),
			Date.now(),
		);
	}

	async delete(id: string): Promise<void> {
		const stmt = this.db.prepare(`DELETE FROM sessions WHERE id = ?`);
		stmt.run(id);
	}

	async list(filter?: SessionFilter): Promise<Session[]> {
		let sql = `SELECT * FROM sessions`;
		const conditions: string[] = [];

		if (filter?.userId) {
			conditions.push(`json_extract(metadata, '$.userId') = '${filter.userId}'`);
		}
		if (filter?.tenantId) {
			conditions.push(`json_extract(metadata, '$.tenantId') = '${filter.tenantId}'`);
		}

		if (conditions.length > 0) {
			sql += ` WHERE ${conditions.join(' AND ')}`;
		}

		sql += ` ORDER BY updated_at DESC`;

		if (filter?.limit) {
			sql += ` LIMIT ${filter.limit}`;
			if (filter?.offset) {
				sql += ` OFFSET ${filter.offset}`;
			}
		}

		const stmt = this.db.prepare(sql);
		const rows = stmt.all() as Array<{
			id: string;
			model: string;
			config: string;
			metadata: string;
			entries: string;
			created_at: number;
			updated_at: number;
		}>;

		let sessions = rows.map((r) => this.hydrate(r));

		if (filter?.status) {
			sessions = sessions.filter((s) => {
				if (filter.status === 'active') return s.metadata.isStreaming;
				if (filter.status === 'completed') return !s.metadata.isStreaming && !s.metadata.error;
				if (filter.status === 'error') return s.metadata.error;
				return true;
			});
		}

		return sessions;
	}

	close(): void {
		this.db.close();
	}

	private hydrate(row: {
		id: string;
		model: string;
		config: string;
		metadata: string;
		entries: string;
		created_at: number;
		updated_at: number;
	}): Session {
		const metadata = JSON.parse(row.metadata);
		// Restore Date objects
		if (metadata.createdAt) metadata.createdAt = new Date(metadata.createdAt);
		if (metadata.updatedAt) metadata.updatedAt = new Date(metadata.updatedAt);

		return {
			id: row.id,
			model: JSON.parse(row.model),
			entries: JSON.parse(row.entries),
			config: JSON.parse(row.config),
			metadata,
		};
	}
}
