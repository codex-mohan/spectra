import { existsSync } from 'fs';
import { relative, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { isInsideWorkingDir } from '../security/wildcard.js';
import { PathSafety } from '../security/path-safety.js';
import type { LspConfig } from '../services/config.js';
import { LspClient } from './client.js';
import { ensureMuxDaemon } from './mux/client.js';
import { findServerForFile, findWorkspaceRoot, resolveLspSettings, type ResolvedLspSettings } from './servers.js';
import type { Diagnostic } from './protocol.js';

const MAX_CLIENTS = 4;
const pathSafety = new PathSafety();

interface ManagedClient {
	key: string;
	client: LspClient;
	serverId: string;
	root: string;
	languageId: string;
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

	constructor(config?: LspConfig, workspaceRoot = process.cwd()) {
		this.settings = resolveLspSettings(config);
		this.workspaceRoot = resolve(workspaceRoot);
	}

	get resolved(): ResolvedLspSettings {
		return this.settings;
	}

	async ensureClient(file: string): Promise<ManagedClient> {
		const resolvedFile = resolve(file);
		const match = findServerForFile(resolvedFile, this.settings.servers);
		if (!match) throw new Error(`No LSP server configured for ${resolvedFile.split('.').pop() ?? 'this file type'}`);

		const root = findWorkspaceRoot(resolvedFile, match.server.rootMarkers ?? []);
		const key = `${match.id}:${root}`;
		const existing = this.clients.get(key);
		if (existing?.client.isRunning) {
			this.lastUsed.set(key, Date.now());
			existing.client.openDocument(resolvedFile, existing.languageId);
			return existing;
		}
		if (existing) {
			this.clients.delete(key);
			await existing.client.dispose().catch(() => {});
		}

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
			requestTimeout: this.settings.requestTimeout,
			workspaceSettings: this.settings.settings,
			...(muxSocket ? { socketPath: muxSocket } : {}),
		});

		let client = buildClient(socketPath ?? undefined);
		try {
			await client.start();
		} catch (error) {
			if (socketPath) {
				// Daemon link failed; fall back to a private server.
				client = buildClient();
				try {
					await client.start();
				} catch (fallbackError) {
					const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
					throw new Error(
						`${match.id} is not available (${message}). Install "${match.server.command}" or configure tools.lsp.servers.`,
					);
				}
			} else {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(
					`${match.id} is not available (${message}). Install "${match.server.command}" or configure tools.lsp.servers.`,
				);
			}
		}
		client.openDocument(resolvedFile, languageId);
		const managed: ManagedClient = { key, client, serverId: match.id, root, languageId };
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
			timeoutMs: this.settings.diagnostics.waitMs,
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
		// Prefer the protocol's workspace pull when the servers support it.
		const managedClients = new Map<string, ManagedClient>();
		for (const file of files) {
			try {
				const managed = await this.ensureClient(file);
				managedClients.set(managed.key, managed);
			} catch {
				// Files without a server fall through to the sweep/filter.
			}
		}
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

		const results: Array<{ file: string; diagnostics: Diagnostic[]; server: string }> = [];
		const queue = [...files];
		const concurrency = this.settings.diagnostics.workspaceConcurrency;

		const worker = async () => {
			for (;;) {
				const file = queue.shift();
				if (!file) return;
				if (signal?.aborted) return;
				try {
					const result = await this.diagnostics(file, signal);
					if (result.diagnostics.length > 0) {
						results.push({ file, diagnostics: result.diagnostics, server: result.server });
					}
				} catch {
					// A single file failure must not abort the sweep.
				}
			}
		};

		await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, worker));
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

	async shutdownAll(): Promise<void> {
		const clients = [...this.clients.values()];
		this.clients.clear();
		this.lastUsed.clear();
		await Promise.all(clients.map((managed) => managed.client.dispose().catch(() => {})));
	}
}

let shared: LspManager | null = null;

export function getLspManager(config?: LspConfig): LspManager {
	if (!shared) shared = new LspManager(config);
	return shared;
}

export function resetLspManager(): void {
	shared = null;
}
