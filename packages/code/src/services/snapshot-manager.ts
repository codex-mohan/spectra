import { execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';
import { createHash } from 'crypto';
import { getGlobalDataDir } from '../utils/paths.js';

const GIT_TIMEOUT = 30_000;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB — skip untracked files larger than this

export interface Patch {
	hash: string;
	files: string[];
}

export interface RevertResult {
	restored: number;
	deleted: number;
	errors: Array<{ path: string; error: string }>;
}

interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

function runGit(args: string[], opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }): Promise<GitResult> {
	return new Promise((resolve) => {
		const env = { ...process.env, ...opts?.env };
		const child = execFile('git', args, {
			cwd: opts?.cwd,
			env,
			timeout: GIT_TIMEOUT,
			maxBuffer: 50 * 1024 * 1024,
			encoding: 'utf-8',
		});
		if (opts?.stdin) {
			child.stdin?.write(opts.stdin);
			child.stdin?.end();
		}
		child.on('close', (code) => {
			// execFile callback gives (error, stdout, stderr)
			// But we handle via 'exit' event below
		});
		child.on('error', (err) => {
			resolve({ code: 1, stdout: '', stderr: err.message });
		});
		// Use the promise-based approach via stdio
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
		child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
		child.on('exit', (exitCode) => {
			resolve({ code: exitCode ?? 1, stdout, stderr });
		});
	});
}

export class SnapshotManager {
	private workdir: string;
	private gitdir: string;
	private lockPath: string;
	private initialized = false;

	constructor(options?: { workdir?: string }) {
		this.workdir = options?.workdir || process.cwd();
		const worktreeHash = createHash('sha256').update(this.workdir).digest('hex').slice(0, 12);
		this.gitdir = join(getGlobalDataDir(), 'snapshots', worktreeHash);
		this.lockPath = join(getGlobalDataDir(), 'snapshots', `${worktreeHash}.lock`);
	}

	// ─── Git helpers ──────────────────────────────────────────────────

	private gitArgs(cmd: string[]): string[] {
		return ['--git-dir', this.gitdir, '--work-tree', this.workdir, ...cmd];
	}

	private async git(cmd: string[], opts?: { cwd?: string; env?: Record<string, string>; stdin?: string }): Promise<GitResult> {
		return runGit(cmd, opts);
	}

	// ─── File-based locking ───────────────────────────────────────────

	private acquireLock(): void {
		const dir = dirname(this.lockPath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const start = Date.now();
		while (true) {
			try {
				const fd = require('fs').openSync(this.lockPath, 'wx');
				require('fs').closeSync(fd);
				return;
			} catch (err: any) {
				if (err.code !== 'EEXIST') throw err;
				// Stale lock detection (> 60s)
				try {
					const stat = require('fs').statSync(this.lockPath);
					if (Date.now() - stat.mtimeMs > 60_000) {
						unlinkSync(this.lockPath);
						continue;
					}
				} catch {}
				if (Date.now() - start > 10_000) {
					throw new Error('Could not acquire snapshot lock after 10s');
				}
				// Busy-wait 50ms
				const end = Date.now() + 50;
				while (Date.now() < end) { /* spin */ }
			}
		}
	}

	private releaseLock(): void {
		try { unlinkSync(this.lockPath); } catch {}
	}

	private async withLock<T>(fn: () => Promise<T>): Promise<T> {
		this.acquireLock();
		try {
			return await fn();
		} finally {
			this.releaseLock();
		}
	}

	// ─── Init ─────────────────────────────────────────────────────────

	async init(): Promise<void> {
		if (this.initialized) return;

		// Check git is available
		try {
			await runGit(['--version']);
		} catch {
			throw new Error('git is required for file snapshots but was not found on PATH');
		}

		if (!existsSync(this.gitdir)) {
			await this.withLock(async () => {
				if (existsSync(this.gitdir)) return;
				mkdirSync(this.gitdir, { recursive: true });
				await this.git(['init'], {
					env: { GIT_DIR: this.gitdir, GIT_WORK_TREE: this.workdir },
				});
				await this.git(['--git-dir', this.gitdir, 'config', 'core.autocrlf', 'false']);
				await this.git(['--git-dir', this.gitdir, 'config', 'core.longpaths', 'true']);
				await this.git(['--git-dir', this.gitdir, 'config', 'core.symlinks', 'true']);
				await this.git(['--git-dir', this.gitdir, 'config', 'core.fsmonitor', 'false']);
			});
		}

		this.initialized = true;
	}

	// ─── Core operations ─────────────────────────────────────────────

	/** Capture current file state → tree hash. */
	async track(): Promise<string> {
		await this.init();
		return this.withLock(async () => {
			await this.add();
			const result = await this.git(this.gitArgs(['write-tree']));
			if (result.code !== 0) {
				throw new Error(`git write-tree failed: ${result.stderr}`);
			}
			return result.stdout.trim();
		});
	}

	/** List files changed since a tree hash. */
	async patch(hash: string): Promise<Patch> {
		await this.init();
		return this.withLock(async () => {
			await this.add();
			const result = await this.git([
				'-c', 'core.longpaths=true',
				'-c', 'core.quotepath=false',
				...this.gitArgs(['diff', '--cached', '--no-ext-diff', '--name-only', hash, '--', '.']),
			]);
			if (result.code !== 0) {
				return { hash, files: [] };
			}
			const files = result.stdout.trim().split('\n').filter(Boolean)
				.map((f) => resolve(this.workdir, f));
			const ignored = await this.ignore(files);
			return {
				hash,
				files: files.filter((f) => !ignored.has(f)),
			};
		});
	}

	/** Restore entire working tree to a tree hash. */
	async restore(hash: string): Promise<void> {
		await this.init();
		return this.withLock(async () => {
			const readTree = await this.git(this.gitArgs(['read-tree', hash]));
			if (readTree.code !== 0) {
				throw new Error(`git read-tree failed for ${hash}: ${readTree.stderr}`);
			}
			const checkout = await this.git(this.gitArgs(['checkout-index', '-a', '-f']));
			if (checkout.code !== 0) {
				throw new Error(`git checkout-index failed: ${checkout.stderr}`);
			}
		});
	}

	/** Revert specific files to their pre-edit state from patches. */
	async revert(patches: Patch[]): Promise<RevertResult> {
		await this.init();
		return this.withLock(async () => {
			const restored: string[] = [];
			const deleted: string[] = [];
			const errors: Array<{ path: string; error: string }> = [];

			// Deduplicate: earliest patch per file wins
			const fileMap = new Map<string, string>();
			for (const p of patches) {
				for (const file of p.files) {
					if (!fileMap.has(file)) {
						fileMap.set(file, p.hash);
					}
				}
			}

			for (const [file, hash] of fileMap) {
				const rel = relative(this.workdir, file).replaceAll('\\', '/');
				// Check if file exists in the snapshot tree
				const lsTree = await this.git(this.gitArgs(['ls-tree', hash, '--', rel]));
				if (lsTree.code === 0 && lsTree.stdout.trim()) {
					// File exists in snapshot → restore it
					const checkout = await this.git(this.gitArgs(['checkout', hash, '--', file]));
					if (checkout.code === 0) {
						restored.push(file);
					} else {
						errors.push({ path: file, error: checkout.stderr });
					}
				} else {
					// File did not exist in snapshot → delete it
					try {
						if (existsSync(file)) {
							unlinkSync(file);
							deleted.push(file);
						}
					} catch (err: any) {
						errors.push({ path: file, error: err.message });
					}
				}
			}

			return { restored: restored.length, deleted: deleted.length, errors };
		});
	}

	/** Full unified diff against a tree hash. */
	async diff(hash: string): Promise<string> {
		await this.init();
		return this.withLock(async () => {
			await this.add();
			const result = await this.git([
				'-c', 'core.longpaths=true',
				'-c', 'core.quotepath=false',
				...this.gitArgs(['diff', '--cached', '--no-ext-diff', hash, '--', '.']),
			]);
			return result.stdout.trim();
		});
	}

	/** Prune old snapshot objects. */
	async gc(): Promise<void> {
		await this.init();
		await this.git(this.gitArgs(['gc', '--prune=7.days']));
	}

	// ─── Internal ─────────────────────────────────────────────────────

	/** Stage all changed/untracked files into the snapshot index. */
	private async add(): Promise<void> {
		await this.sync();

		const quote = ['-c', 'core.longpaths=true', '-c', 'core.quotepath=false', '-c', 'core.symlinks=true'];

		// Find modified tracked files
		const diff = await this.git([...quote, ...this.gitArgs(['diff-files', '--name-only', '-z', '--', '.'])]);
		// Find untracked files
		const other = await this.git([...quote, ...this.gitArgs(['ls-files', '--others', '--exclude-standard', '-z', '--', '.'])]);

		if (diff.code !== 0 || other.code !== 0) return;

		const tracked = diff.stdout.split('\0').filter(Boolean);
		const untracked = other.stdout.split('\0').filter(Boolean);
		const all = [...new Set([...tracked, ...untracked])];
		if (!all.length) return;

		const ignored = await this.ignore(all);

		// Remove newly-ignored files from snapshot index
		if (ignored.size > 0) {
			const ignoredFiles = [...ignored];
			if (ignoredFiles.length) {
				await this.git(this.gitArgs(['rm', '--cached', '-f', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul']), {
					stdin: ignoredFiles.join('\0') + '\0',
				});
			}
		}

		const allow = all.filter((f) => !ignored.has(resolve(this.workdir, f)));
		if (!allow.length) return;

		// Filter out large untracked files
		const large = new Set<string>();
		for (const f of allow) {
			if (!tracked.includes(f)) {
				try {
					const stat = require('fs').statSync(resolve(this.workdir, f));
					if (stat.size > MAX_FILE_SIZE) large.add(f);
				} catch {}
			}
		}

		const toStage = allow.filter((f) => !large.has(f));
		if (!toStage.length) return;

		await this.git(this.gitArgs(['add', '--all', '--sparse', '--pathspec-from-file=-', '--pathspec-file-nul']), {
			stdin: toStage.join('\0') + '\0',
		});
	}

	/** Sync workspace .gitignore to snapshot's info/exclude. */
	private async sync(): Promise<void> {
		const excludes = await this.git(['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], {
			cwd: this.workdir,
		});
		const userExclude = excludes.code === 0 ? excludes.stdout.trim() : null;
		const target = join(this.gitdir, 'info', 'exclude');

		let content = '';
		if (userExclude && existsSync(userExclude)) {
			try {
				content = readFileSync(userExclude, 'utf-8').trimEnd();
			} catch {}
		}

		const dir = dirname(target);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(target, content ? content + '\n' : '', 'utf-8');
	}

	/** Check which files are gitignored (using user's .gitignore). */
	private async ignore(files: string[]): Promise<Set<string>> {
		if (!files.length) return new Set();
		const gitDir = join(this.workdir, '.git');
		if (!existsSync(gitDir)) return new Set();

		const result = await this.git([
			'-c', 'core.longpaths=true',
			'-c', 'core.quotepath=false',
			'-c', 'core.symlinks=true',
			'--git-dir', gitDir,
			'--work-tree', this.workdir,
			'check-ignore', '--no-index', '--stdin', '-z',
		], {
			cwd: this.workdir,
			stdin: files.join('\0') + '\0',
		});

		if (result.code !== 0 && result.code !== 1) return new Set();
		return new Set(result.stdout.split('\0').filter(Boolean).map((f) => resolve(this.workdir, f)));
	}
}
