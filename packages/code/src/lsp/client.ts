import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { readFileSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import type { LspServerConfig } from '../services/config.js';
import { JsonRpcConnection } from './connection.js';
import type { Diagnostic, ServerCapabilities } from './protocol.js';

export interface LspClientOptions {
	id: string;
	name: string;
	root: string;
	server: LspServerConfig;
	requestTimeout: number;
	workspaceSettings?: Record<string, unknown>;
}

export class LspClient {
	readonly id: string;
	readonly name: string;
	readonly root: string;
	private readonly server: LspServerConfig;
	private readonly requestTimeout: number;
	private readonly workspaceSettings: Record<string, unknown>;
	private child: ChildProcessWithoutNullStreams | null = null;
	private connection: JsonRpcConnection | null = null;
	private capabilities: ServerCapabilities = {};
	private documents = new Map<string, { languageId: string; version: number }>();
	private diagnostics = new Map<string, Diagnostic[]>();
	private stderr = '';
	private disposed = false;

	constructor(options: LspClientOptions) {
		this.id = options.id;
		this.name = options.name;
		this.root = options.root;
		this.server = options.server;
		this.requestTimeout = options.requestTimeout;
		this.workspaceSettings = options.workspaceSettings ?? {};
	}

	async start(): Promise<void> {
		const child = spawn(this.server.command, this.server.args ?? [], {
			cwd: this.root,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.child = child;
		child.stderr.on('data', (chunk: Buffer) => {
			this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-4000);
		});

		const connection = new JsonRpcConnection(child, {
			onNotification: (method, params) => this.onNotification(method, params),
			onRequest: (method, params) => this.onRequest(method, params),
		});
		this.connection = connection;

		const initialized = await connection.request('initialize', {
			processId: process.pid,
			rootUri: pathToFileURL(this.root).toString(),
			capabilities: {
				textDocument: {
					synchronization: { dynamicRegistration: false, didSave: true },
					publishDiagnostics: { relatedInformation: true, versionSupport: true },
					diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
					definition: { linkSupport: true },
					references: {},
					hover: { contentFormat: ['markdown', 'plaintext'] },
					rename: { prepareSupport: true },
					codeAction: { dataSupport: true, resolveSupport: { properties: ['edit'] } },
					documentSymbol: { hierarchicalDocumentSymbolSupport: true },
					formatting: {},
					rangeFormatting: {},
				},
				workspace: {
					workspaceFolders: true,
					workspaceEdit: { documentChanges: true },
					symbol: {},
					configuration: true,
					didChangeConfiguration: { dynamicRegistration: false },
				},
			},
			workspaceFolders: [{ uri: pathToFileURL(this.root).toString(), name: this.name }],
		}, { timeoutMs: this.requestTimeout });

		this.capabilities = isRecord(initialized) && isRecord(initialized.capabilities)
			? initialized.capabilities as ServerCapabilities
			: {};
		connection.notify('initialized', {});
		connection.notify('workspace/didChangeConfiguration', { settings: this.workspaceSettings });
	}

	get serverCapabilities(): ServerCapabilities {
		return this.capabilities;
	}

	get lastStderr(): string {
		return this.stderr;
	}

	get isRunning(): boolean {
		return this.child !== null && !this.disposed;
	}

	async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		if (!this.connection) throw new Error(`${this.name} is not running`);
		return this.connection.request(method, params, { timeoutMs: this.requestTimeout, signal });
	}

	notify(method: string, params: unknown): void {
		this.connection?.notify(method, params);
	}

	openDocument(path: string, languageId: string): void {
		const uri = pathToFileURL(path).toString();
		if (this.documents.has(uri)) return;
		this.documents.set(uri, { languageId, version: 1 });
		this.notify('textDocument/didOpen', {
			textDocument: { uri, languageId, version: 1, text: readFileSync(path, 'utf8') },
		});
	}

	changeDocument(path: string): void {
		const uri = pathToFileURL(path).toString();
		const document = this.documents.get(uri);
		if (!document) return;
		document.version++;
		this.notify('textDocument/didChange', {
			textDocument: { uri, version: document.version },
			contentChanges: [{ text: readFileSync(path, 'utf8') }],
		});
	}

	closeDocument(path: string): void {
		const uri = pathToFileURL(path).toString();
		if (!this.documents.delete(uri)) return;
		this.notify('textDocument/didClose', { textDocument: { uri } });
	}

	saveDocument(path: string): void {
		const uri = pathToFileURL(path).toString();
		if (!this.documents.has(uri)) return;
		this.notify('textDocument/didSave', { textDocument: { uri }, text: readFileSync(path, 'utf8') });
	}

	getDiagnostics(path: string): Diagnostic[] {
		return this.diagnostics.get(pathToFileURL(path).toString()) ?? [];
	}

	async pullDiagnostics(path: string, signal?: AbortSignal): Promise<Diagnostic[] | null> {
		if (!this.capabilities.diagnosticProvider) return null;
		const result = await this.request('textDocument/diagnostic', {
			textDocument: { uri: pathToFileURL(path).toString() },
		}, signal);
		if (!isRecord(result) || !Array.isArray(result.items)) return null;
		return result.items as Diagnostic[];
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		const child = this.child;
		const connection = this.connection;
		this.child = null;
		this.connection = null;
		if (!child) {
			connection?.dispose();
			return;
		}
		try {
			connection?.notify('shutdown', null);
			connection?.notify('exit', null);
		} catch {
			// Server already gone.
		}
		connection?.dispose();
		await new Promise<void>((resolvePromise) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolvePromise();
			};
			const timer = setTimeout(() => {
				child.kill();
				setTimeout(finish, 200);
			}, 500);
			child.once('exit', finish);
		});
	}

	private onNotification(method: string, params: unknown): void {
		if (method === 'textDocument/publishDiagnostics' && isRecord(params) && typeof params.uri === 'string') {
			this.diagnostics.set(params.uri, Array.isArray(params.diagnostics) ? params.diagnostics as Diagnostic[] : []);
		}
	}

	private onRequest(method: string, params: unknown): unknown {
		switch (method) {
			case 'workspace/configuration': {
				if (!isRecord(params) || !Array.isArray(params.items)) return [];
				return params.items.map((item) => {
					if (!isRecord(item) || typeof item.section !== 'string') return null;
					return this.workspaceSettings[item.section] ?? null;
				});
			}
			case 'client/registerCapability':
			case 'window/workDoneProgress/create':
			case 'workspace/workspaceFolders':
				return method === 'workspace/workspaceFolders'
					? [{ uri: pathToFileURL(this.root).toString(), name: this.name }]
					: null;
			case 'workspace/applyEdit':
				return { applied: false };
			default:
				return null;
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function uriToPath(uri: string): string {
	return fileURLToPath(uri);
}
