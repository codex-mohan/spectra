import { join } from 'path';
import { mkdirSync } from 'fs';
import { getGlobalDataDir } from '../utils/paths.js';
import type { JobRecord, JobState } from './job-registry.js';

interface SqliteDatabase {
	exec(sql: string): void;
	prepare(sql: string): {
		run(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
	};
	close(): void;
}

function openDatabase(path: string): SqliteDatabase {
	try {
		const { Database } = require('bun:sqlite') as { Database: new (path: string) => SqliteDatabase };
		return new Database(path);
	} catch {
		const Database = require('better-sqlite3') as { new (path: string): SqliteDatabase };
		return new Database(path);
	}
}

export class JobStore {
	private db: SqliteDatabase;

	constructor(path = join(getGlobalDataDir(), 'jobs.db')) {
		mkdirSync(getGlobalDataDir(), { recursive: true });
		this.db = openDatabase(path);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS jobs (
				id TEXT PRIMARY KEY,
				parent_session_id TEXT NOT NULL,
				child_session_id TEXT,
				agent TEXT NOT NULL,
				description TEXT NOT NULL,
				prompt TEXT NOT NULL,
				state TEXT NOT NULL,
				pause_requested INTEGER NOT NULL DEFAULT 0,
				generation INTEGER NOT NULL DEFAULT 0,
				queued_at INTEGER NOT NULL,
				started_at INTEGER,
				finished_at INTEGER,
				settled_at INTEGER,
				delivered_at INTEGER,
				consumed_at INTEGER,
				result TEXT,
				error TEXT,
				retry_attempts INTEGER NOT NULL DEFAULT 0,
				last_checkpoint_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS jobs_parent ON jobs(parent_session_id, state);
		`);
	}

	load(): JobRecord[] {
		const rows = this.db.prepare('SELECT * FROM jobs').all() as Array<Record<string, unknown>>;
		return rows.map((row) => ({
			id: String(row.id),
			parentSessionId: String(row.parent_session_id),
			childSessionId: row.child_session_id ? String(row.child_session_id) : undefined,
			agent: String(row.agent),
			description: String(row.description),
			prompt: String(row.prompt),
			state: row.state as JobState,
			pauseRequested: Number(row.pause_requested) === 1,
			generation: Number(row.generation),
			queuedAt: Number(row.queued_at),
			startedAt: row.started_at === null ? undefined : Number(row.started_at),
			finishedAt: row.finished_at === null ? undefined : Number(row.finished_at),
			settledAt: row.settled_at === null ? undefined : Number(row.settled_at),
			deliveredAt: row.delivered_at === null ? undefined : Number(row.delivered_at),
			consumedAt: row.consumed_at === null ? undefined : Number(row.consumed_at),
			result: row.result === null ? undefined : String(row.result),
			error: row.error === null ? undefined : String(row.error),
			retryAttempts: Number(row.retry_attempts),
			lastCheckpointAt: row.last_checkpoint_at === null ? undefined : Number(row.last_checkpoint_at),
		}));
	}

	save(job: JobRecord): void {
		this.db.prepare(`
			INSERT INTO jobs (
				id, parent_session_id, child_session_id, agent, description, prompt, state,
				pause_requested, generation, queued_at, started_at, finished_at, settled_at,
				delivered_at, consumed_at, result, error, retry_attempts, last_checkpoint_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				child_session_id=excluded.child_session_id,
				state=excluded.state,
				pause_requested=excluded.pause_requested,
				generation=excluded.generation,
				started_at=excluded.started_at,
				finished_at=excluded.finished_at,
				settled_at=excluded.settled_at,
				delivered_at=excluded.delivered_at,
				consumed_at=excluded.consumed_at,
				result=excluded.result,
				error=excluded.error,
				retry_attempts=excluded.retry_attempts,
				last_checkpoint_at=excluded.last_checkpoint_at
		`).run(
			job.id, job.parentSessionId, job.childSessionId ?? null, job.agent, job.description, job.prompt,
			job.state, job.pauseRequested ? 1 : 0, job.generation, job.queuedAt,
			job.startedAt ?? null, job.finishedAt ?? null, job.settledAt ?? null,
			job.deliveredAt ?? null, job.consumedAt ?? null, job.result ?? null, job.error ?? null,
			job.retryAttempts, job.lastCheckpointAt ?? null,
		);
	}

	close(): void {
		this.db.close();
	}
}
