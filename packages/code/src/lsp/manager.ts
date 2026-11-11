import { existsSync } from 'fs';
import { relative, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { isInsideWorkingDir } from '../security/wildcard.js';
import { PathSafety } from '../security/path-safety.js';
import type { LspConfig } from '../services/config.js';
import { LspClient } from './client.js';
import { hasRootMarker, resolveExecutable } from './executable.js';
import { ensureMuxDaemon, shutdownSharedServers } from './mux/client.js';
import { findServersForFile, findWorkspaceRoot, resolveLspSettings, workspaceRootMatches, type ResolvedLspSettings } from './servers.js';
import type { Diagnostic } from './protocol.js';

const MAX_CLIENTS = 4;
/** First request after a server spawn can wait through project indexing. */
const COLD_START_WAIT_MS = 10_000;
/** Deterministic init failures are cached so every tool call does not retry a broken server. */
const INIT_FAILURE_BACKOFF_MS = 3 * 60_000;
const pathSafety = new PathSafety();

interface ManagedClient {
	key: string;
	client: LspClient;
	serverId: string;
	root: string;
	languageId: string;
	/** True only for the call that spawned this client. */
	coldStart?: boolean;
}

export interface LspServerStatus {
	server: string;
	root: string;
	running: boolean;
	configured: boolean;
	error?: string;
}

export interface DiagnosticsResult {
	diagnostics: Diagnostic[];
	server: string;
	source: 'pull' | 'push' | 'none';
}

export class LspManager {
	private settings: ResolvedLspSettings;
	private workspaceRoot: string;
	private clients = new Map<string, ManagedClient>();
	private lastUsed = new Map<string, number>();
	private initFailures = new Map<string, { at: number; message: string }>();

	constructor(config?: LspConfig, workspaceRoot = process.cwd()) {
		this.settings = resolveLspSettings(config);
		this.workspaceRoot = resolve(workspaceRoot);
	}

	get resolved(): ResolvedLspSettings {
		return this.settings;
	}

	/** Re-resolve settings after a config edit; running clients keep their current config until reload. */
	updateSettings(config?: LspConfig): void {
		this.settings = resolveLspSettings(config);
	}

	async ensureClient(file: string): Promise<ManagedClient> {
		const resolvedFile = resolve(file);
		const matches = findServersForFile(resolvedFile, this.settings.servers);
		if (matches.length === 0) {
			throw new Error(`No LSP server configured for ${resolvedFile.split('.').pop() ?? 'this file type'}`);
		}

		// A file can match several servers (pyright/basedpyright/ty, tsserver/deno).
		// Prefer one whose root markers actually apply, then one whose binary is
		// installed, so a missing primary does not mask an available alternative.
		const candidates = matches.map((match) => {
			const markers = match.server.rootMarkers ?? [];
			const root = findWorkspaceRoot(resolvedFile, markers);
			return {
				match,
				root,
				key: `${match.id}:${root}`,
				matched: workspaceRootMatches(resolvedFile, markers),
				commandPath: resolveExecutable(match.server.command, root),
			};
		});

		// Reuse a live client before considering binary availability.
		for (const candidate of candidates) {
			const existing = this.clients.get(candidate.key);
			if (existing?.client.isRunning) {
				this.lastUsed.set(candidate.key, Date.now());
				existing.client.openDocument(resolvedFile, existing.languageId);
				return { ...existing, coldStart: false };
			}
		}

		const candidate = candidates.find((entry) => entry.matched && entry.commandPath)
			?? candidates.find((entry) => entry.commandPath);
		if (!candidate) {
			const tried = candidates.map((entry) => `"${entry.match.server.command}"`).join(', ');
			throw new Error(
				`No available LSP server for ${resolvedFile.split('.').pop() ?? 'this file type'}: ${tried} not found in project bins or on PATH. Install one or configure tools.lsp.servers.`,
			);
		}
		const { match, root, key, commandPath } = candidate;

		const existing = this.clients.get(key);
		if (existing) {
			this.clients.delete(key);
			await existing.client.dispose().catch(() => {});
		}
		const recentFailure = this.initFailures.get(key);
		if (recentFailure && Date.now() - recentFailure.at < INIT_FAILURE_BACKOFF_MS) {
			throw new Error(`${match.id} failed to initialize recently (${recentFailure.message}). Run lsp reload to retry.`);
		}
		if (recentFailure) this.initFailures.delete(key);

		if (this.clients.size >= MAX_CLIENTS) {
			const oldest = [...this.lastUsed.entries()].sort((a, b) => a[1] - b[1])[0];
			if (oldest) {
				const victim = this.clients.get(oldest[0]);
				this.clients.delete(oldest[0]);
				this.lastUsed.delete(oldest[0]);
				await victim?.client.dispose().catch(() => {});
			}
		}

		const languageId = match.server.languageId ?? 'plaintext';
		const socketPath = this.settings.shared ? await ensureMuxDaemon(root) : null;
		const buildClient = (muxSocket?: string) => new LspClient({
			id: key,
			name: match.id,
			root,
			server: match.server,
			commandPath: commandPath ?? undefined,
			requestTimeout: this.settings.requestTimeout,
			workspaceSettings: this.settings.settings,
			...(muxSocket ? { socketPath: muxSocket } : {}),
		});

		const failStart = (error: unknown): never => {
			const message = error instanceof Error ? error.message : String(error);
			const stderr = client.lastStderr.trim();
			const detail = stderr && !message.includes(stderr) ? `${message}: ${stderr}` : message;
			// rustup installs a proxy even when the component is missing; the proxy
			// exits with "Unknown binary 'rust-analyzer'". Name the fix explicitly.
			const rustupHint = /rust-analyzer/i.test(match.server.command) && /unknown binary|rustup/i.test(stderr)
				? ' Run "rustup component add rust-analyzer".'
				: '';
			this.initFailures.set(key, { at: Date.now(), message: detail });
			throw new Error(
				`${match.id} is not available (${detail}). Install "${match.server.command}" or configure tools.lsp.servers.${rustupHint}`,
			);
		};

		let client = buildClient(socketPath ?? undefined);
		try {
			await client.start();
		} catch (error) {
			if (socketPath) {
				// Daemon link failed; fall back to a private server.
				await client.dispose().catch(() => {});
				client = buildClient();
				try {
					await client.start();
				} catch (fallbackError) {
					failStart(fallbackError);
				}
			} else {
				failStart(error);
			}
		}
		this.initFailures.delete(key);
		client.openDocument(resolvedFile, languageId);
		const managed: ManagedClient = { key, client, serverId: match.id, root, languageId, coldStart: true };
		this.clients.set(key, managed);
		this.lastUsed.set(key, Date.now());
		return managed;
	}

	async request(file: string, method: string, params: unknown, signal?: AbortSignal): Promise<{ result: unknown; managed: ManagedClient }> {
		const managed = await this.ensureClient(file);
		const result = await managed.client.request(method, params, signal);
		return { result, managed };
	}

	async diagnostics(file: string, signal?: AbortSignal, afterVersion?: number): Promise<DiagnosticsResult> {
		const resolved = resolve(file);
		const managed = await this.ensureClient(resolved);

		if (this.settings.diagnostics.pull) {
			try {
				const pulled = await managed.client.pullDiagnostics(resolved, signal);
				if (pulled) {
					return { diagnostics: pulled, server: managed.serverId, source: 'pull' };
				}
			} catch {
				// Fall back to pushed diagnostics.
			}
		}

		const diagnostics = await managed.client.waitForDiagnostics(resolved, {
			afterVersion,
			timeoutMs: Math.max(this.settings.diagnostics.waitMs, managed.coldStart ? COLD_START_WAIT_MS : 0),
			signal,
		});
		return { diagnostics, server: managed.serverId, source: diagnostics.length > 0 ? 'push' : 'none' };
	}

	documentVersion(file: string): number | undefined {
		const resolved = resolve(file);
		for (const managed of this.clients.values()) {
			const version = managed.client.documentVersion(resolved);
			if (version !== undefined) return version;
		}
		return undefined;
	}

	async workspaceDiagnostics(files: string[], signal?: AbortSignal): Promise<Array<{ file: string; diagnostics: Diagnostic[]; server: string }>> {
		// Ensure one client per file up front. This also records which files
		// started a cold server, so the pushed sweep below can reuse the same
		// clients instead of re-ensuring them (which would lose the cold flag).
		const managedClients = new Map<string, ManagedClient>();
		const opened: Array<{ file: string; managed: ManagedClient }> = [];
		let coldStart = false;
		for (const file of files) {
			if (signal?.aborted) break;
			try {
				const managed = await this.ensureClient(file);
				managedClients.set(managed.key, managed);
				opened.push({ file, managed });
				coldStart = coldStart || managed.coldStart === true;
			} catch {
				// Files without a server fall through to the sweep/filter.
			}
		}

		// Prefer the protocol's workspace pull when the servers support it.
		const protocolResults: Array<{ file: string; diagnostics: Diagnostic[]; server: string }> = [];
		let usedProtocol = false;
		for (const managed of managedClients.values()) {
			try {
				const pulled = await managed.client.pullWorkspaceDiagnostics(signal);
				if (pulled === null) continue;
				usedProtocol = true;
				for (const item of pulled) {
					if (item.diagnostics.length === 0) continue;
					protocolResults.push({ file: fileURLToPath(item.uri), diagnostics: item.diagnostics, server: managed.serverId });
				}
			} catch {
				// Fall back to the per-file sweep.
			}
		}
		if (usedProtocol) return protocolResults.sort((a, b) => a.file.localeCompare(b.file));

		// Pushed-diagnostics sweep: every file is already open; wait for a single
		// settle window. Waiting `waitMs` per file serialized the sweep and made
		// workspace diagnostics exceed the caller's deadline on real projects.
		const settleMs = coldStart ? COLD_START_WAIT_MS : this.settings.diagnostics.waitMs;
		const deadline = Date.now() + settleMs;
		while (!signal?.aborted && Date.now() < deadline) {
			const waiting = opened.some((entry) => !entry.managed.client.hasDiagnosticsEntry(entry.file));
			if (!waiting) break;
			await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 40));
		}

		const results: Array<{ file: string; diagnostics: Diagnostic[]; server: string }> = [];
		for (const entry of opened) {
			const diagnostics = entry.managed.client.getDiagnostics(entry.file);
			if (diagnostics.length > 0) {
				results.push({ file: entry.file, diagnostics, server: entry.managed.serverId });
			}
		}
		return results.sort((a, b) => a.file.localeCompare(b.file));
	}

	async format(file: string, options: { tabSize?: number; insertSpaces?: boolean; range?: { startLine: number; endLine: number } }, signal?: AbortSignal): Promise<{ result: unknown; managed: ManagedClient }> {
		const managed = await this.ensureClient(file);
		const uri = pathToFileURL(resolve(file)).toString();
		const params = options.range
			? {
				textDocument: { uri },
				range: {
					start: { line: options.range.startLine - 1, character: 0 },
					end: { line: options.range.endLine, character: 0 },
				},
				options: { tabSize: options.tabSize ?? 2, insertSpaces: options.insertSpaces ?? true },
			}
			: {
				textDocument: { uri },
				options: { tabSize: options.tabSize ?? 2, insertSpaces: options.insertSpaces ?? true },
			};
		const method = options.range ? 'textDocument/rangeFormatting' : 'textDocument/formatting';
		const result = await managed.client.request(method, params, signal);
		return { result, managed };
	}

	refreshDocument(file: string): void {
		const resolved = resolve(file);
		for (const managed of this.clients.values()) managed.client.changeDocument(resolved);
	}

	saveDocument(file: string): void {
		const resolved = resolve(file);
		for (const managed of this.clients.values()) managed.client.saveDocument(resolved);
	}

	notifyWatchedFile(file: string, type: 1 | 2 | 3): void {
		const resolved = resolve(file);
		for (const managed of this.clients.values()) managed.client.notifyWatchedFile(resolved, type);
	}

	peekDiagnostics(file: string): Diagnostic[] {
		const resolved = resolve(file);
		for (const managed of this.clients.values()) {
			const diagnostics = managed.client.getDiagnostics(resolved);
			if (diagnostics.length > 0) return diagnostics;
		}
		return [];
	}

	validatePath(path: string): string | null {
		const safe = pathSafety.check(path);
		if (!safe.ok) return safe.reason;
		if (!isInsideWorkingDir(path, this.workspaceRoot) && existsSync(path)) {
			return `Refusing to edit outside the workspace: ${path}`;
		}
		return null;
	}

	describe(): Array<{ server: string; root: string; running: boolean }> {
		return [...this.clients.values()].map((managed) => ({
			server: managed.serverId,
			root: relative(this.workspaceRoot, managed.root) || managed.root,
			running: managed.client.isRunning,
		}));
	}

	/**
	 * Configured servers (root marker present and executable resolvable) plus
	 * live clients, so status distinguishes "not started" from "not installed".
	 */
	status(): LspServerStatus[] {
		const statuses: LspServerStatus[] = [];
		const liveServers = new Set<string>();
		for (const managed of this.clients.values()) {
			liveServers.add(managed.serverId);
			const failure = this.initFailures.get(managed.key);
			statuses.push({
				server: managed.serverId,
				root: managed.root,
				running: managed.client.isRunning,
				configured: true,
				...(failure ? { error: failure.message } : {}),
			});
		}
		for (const [id, server] of Object.entries(this.settings.servers)) {
			if (liveServers.has(id)) continue;
			if (!hasRootMarker(this.workspaceRoot, server.rootMarkers ?? [])) continue;
			if (!resolveExecutable(server.command, this.workspaceRoot)) continue;
			const failure = this.initFailures.get(`${id}:${this.workspaceRoot}`);
			statuses.push({
				server: id,
				root: this.workspaceRoot,
				running: false,
				configured: true,
				...(failure ? { error: failure.message } : {}),
			});
		}
		return statuses.sort((a, b) => a.server.localeCompare(b.server) || a.root.localeCompare(b.root));
	}

	async shutdownAll(): Promise<void> {
		const clients = [...this.clients.values()];
		this.clients.clear();
		this.lastUsed.clear();
		this.initFailures.clear();
		const sharedRoots = new Set(clients.filter((managed) => managed.client.usesMux).map((managed) => managed.root));
		await Promise.all(clients.map((managed) => managed.client.dispose().catch(() => {})));
		// Reload/exit must stop the servers this project's daemon owns; otherwise
		// they linger for the five-minute reuse window with no manager tracking them.
		await Promise.all([...sharedRoots].map((root) => shutdownSharedServers(root).catch(() => 0)));
	}
}

let shared: LspManager | null = null;

export function getLspManager(config?: LspConfig): LspManager {
	if (!shared) shared = new LspManager(config);
	else shared.updateSettings(config);
	return shared;
}

export function resetLspManager(): void {
	shared = null;
}


/** Running servers without constructing a manager. */
export function peekLspStatus(): Array<{ server: string; root: string; running: boolean }> {
	return shared?.describe() ?? [];
}
