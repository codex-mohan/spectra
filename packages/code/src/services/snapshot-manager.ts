import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { getGlobalDataDir } from '../utils/paths.js';

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

interface FileSnapshot {
	before?: string | null;
	existed: boolean;
	tooLarge?: boolean;
	skipped?: boolean;
}

interface Checkpoint {
	id: string;
	label: string;
	startedAt: number;
	files: Map<string, FileSnapshot>;
}

interface RollbackResult {
	checkpointId: string;
	label: string;
	restored: number;
	deleted: number;
	errors: Array<{ path: string; error: string }>;
	skipped: Array<{ path: string; reason: string }>;
	reason: string;
}

export class SnapshotManager {
	private workdir: string;
	private snapshotDir: string;
	private disabled: boolean;
	private maxFileSize: number;
	private active: Checkpoint | null = null;

	constructor(options?: { workdir?: string; snapshotDir?: string; disabled?: boolean; maxFileSize?: number }) {
		this.workdir = options?.workdir || process.cwd();
		this.snapshotDir = options?.snapshotDir || join(getGlobalDataDir(), 'snapshots');
		this.disabled = options?.disabled || false;
		this.maxFileSize = options?.maxFileSize || 5 * 1024 * 1024; // 5MB
	}

	/** Open a new checkpoint. Returns checkpoint ID. */
	begin(label?: string): string | null {
		if (this.disabled) return null;
		if (this.active) this.commit(); // close prior
		const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
		this.active = {
			id,
			label: String(label || 'checkpoint').slice(0, 80),
			startedAt: Date.now(),
			files: new Map(),
		};
		return id;
	}

	/** Snapshot a file's pre-edit content. Idempotent — first snapshot wins. */
	note(filePath: string, before?: string): void {
		if (this.disabled || !this.active) return;
		const abs = resolve(this.workdir, filePath);
		// Containment — only snapshot files inside workspace root
		const rel = relative(this.workdir, abs);
		if (rel.startsWith('..') || rel.startsWith('.')) return;
		if (this.active.files.has(abs)) return; // first-snapshot-wins

		let content = before;
		let existed = false;
		if (content === undefined || content === null) {
			try {
				const stat = statSync(abs);
				if (stat.size > this.maxFileSize) {
					this.active.files.set(abs, { tooLarge: true, existed: true });
					return;
				}
				content = readFileSync(abs, 'utf-8');
				existed = true;
			} catch (e: any) {
				if (e.code === 'ENOENT') {
					this.active.files.set(abs, { before: null, existed: false });
					return;
				}
				this.active.files.set(abs, { skipped: true, existed: true });
				return;
			}
		} else {
			existed = true;
		}
		this.active.files.set(abs, { before: content, existed });
	}

	/**
	 * Roll back every file recorded since the last begin().
	 * Files snapshotted as nonexistent are deleted.
	 * Files with stored content are restored.
	 */
	rollback(reason = 'verification failed'): RollbackResult {
		if (this.disabled || !this.active) {
			return {
				checkpointId: '',
				label: '',
				restored: 0,
				deleted: 0,
				errors: [],
				skipped: [],
				reason,
			};
		}
		const cp = this.active;
		const restored: string[] = [];
		const deleted: string[] = [];
		const errors: Array<{ path: string; error: string }> = [];
		const skipped: Array<{ path: string; reason: string }> = [];

		for (const [abs, snap] of cp.files.entries()) {
			try {
				if (snap.tooLarge) {
					skipped.push({ path: abs, reason: 'file too large to snapshot' });
					continue;
				}
				if (snap.skipped) {
					skipped.push({ path: abs, reason: 'snapshot read failed' });
					continue;
				}
				if (!snap.existed) {
					// Was new — delete it
					if (existsSync(abs)) {
						unlinkSync(abs);
						deleted.push(abs);
					}
				} else if (snap.before !== undefined && snap.before !== null) {
					// Restore content
					const dir = dirname(abs);
					if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
					writeFileSync(abs, snap.before);
					restored.push(abs);
				}
			} catch (e: any) {
				errors.push({ path: abs, error: e.message || String(e) });
			}
		}

		this._persist(cp, { reason, restored, deleted, errors, skipped, rolledBack: true });
		this.active = null;
		return {
			checkpointId: cp.id,
			label: cp.label,
			restored: restored.length,
			deleted: deleted.length,
			errors,
			skipped,
			reason,
		};
	}

	/** Discard the active checkpoint without restoring anything. */
	commit(): string | null {
		if (this.disabled || !this.active) return null;
		const cp = this.active;
		this._persist(cp, { rolledBack: false, committed: true });
		this.active = null;
		return cp.id;
	}

	isActive(): boolean {
		return !!this.active;
	}

	size(): number {
		return this.active ? this.active.files.size : 0;
	}

	reset(): void {
		this.active = null;
	}

	// ─── Internal ──────────────────────────────────────────────────────────

	private _persist(cp: Checkpoint, outcome: Record<string, unknown>): void {
		if (this.disabled) return;
		try {
			if (!existsSync(this.snapshotDir)) {
				mkdirSync(this.snapshotDir, { recursive: true, mode: DIR_MODE });
			}
			const id = String(cp.id || '').replace(/[^A-Za-z0-9_-]/g, '');
			if (!id) return;
			const filePath = join(this.snapshotDir, `${id}.json`);

			const summary = {
				id: cp.id,
				label: cp.label,
				startedAt: new Date(cp.startedAt).toISOString(),
				endedAt: new Date().toISOString(),
				fileCount: cp.files.size,
				files: [...cp.files.keys()].slice(0, 50),
				outcome,
			};
			const tmp = filePath + `.tmp.${process.pid}`;
			writeFileSync(tmp, JSON.stringify(summary, null, 2), { mode: FILE_MODE });
			renameSync(tmp, filePath);
		} catch {
			// never fail the agent loop on persistence errors
		}
	}
}
