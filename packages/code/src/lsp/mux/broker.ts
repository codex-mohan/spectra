import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createServer, type Server as NetServer, type Socket } from 'net';
import { createFrameReader, writeMessage, type JsonRpcMessage } from '../framing.js';
import {
	MUX_CONNECT_METHOD,
	MUX_PING_METHOD,
	MUX_PING_RESULT,
	MUX_RESTART_METHOD,
	MUX_ROOT_ENV,
	MUX_SOCKET_ENV,
	muxKey,
	type MuxConnectParams,
} from './protocol.js';

const SERVER_LINGER_MS = 5 * 60_000;
const DAEMON_IDLE_MS = 15 * 60_000;

interface PendingForward {
	session: Session;
	clientId: number | string;
}

class ServerInstance {
	readonly sessions = new Set<Session>();
	readonly pending = new Map<number, PendingForward>();
	readonly serverRequestIds = new Set<number>();
	readonly proc: ChildProcessWithoutNullStreams;
	nextId = 1;
	initialized = false;
	initializeCached = false;
	initializeResult: unknown;
	lastUsed = Date.now();
	initializedSent = false;

	constructor(readonly key: string, params: MuxConnectParams) {
		this.proc = spawn(params.command, params.args, {
			cwd: params.cwd,
			env: { ...process.env, ...(params.env ?? {}) },
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.proc.stdout.on('data', createFrameReader((message) => this.onMessage(message)));
		this.proc.stderr.on('data', () => {});
		this.proc.on('exit', (code) => this.onExit(code));
	}

	get alive(): boolean {
		return this.proc.exitCode === null && !this.proc.killed;
	}

	forward(session: Session, message: JsonRpcMessage): void {
		const clientId = message.id;
		this.lastUsed = Date.now();
		if (clientId === undefined) {
			if (message.method === 'initialized') {
				if (this.initializedSent) return;
				this.initializedSent = true;
			}
			writeMessage(this.proc.stdin, message);
			return;
		}
		const id = this.nextId++;
		this.pending.set(id, { session, clientId });
		writeMessage(this.proc.stdin, { ...message, id });
	}

	private onMessage(message: JsonRpcMessage): void {
		this.lastUsed = Date.now();
		if (message.id !== undefined && message.method === undefined) {
			const pending = this.pending.get(Number(message.id));
			if (pending) {
				this.pending.delete(Number(message.id));
				pending.session.send({ ...message, id: pending.clientId });
				if (pending.session.awaitingInitialize) {
					this.initializeCached = true;
					this.initializeResult = message.result;
					this.initialized = true;
				}
				return;
			}
			if (typeof message.id === 'number' && this.serverRequestIds.delete(message.id)) {
				writeMessage(this.proc.stdin, message);
			}
			return;
		}

		if (message.method && message.id !== undefined) {
			this.serverRequestIds.add(Number(message.id));
			for (const session of this.sessions) {
				session.send(message);
				break;
			}
			return;
		}

		for (const session of this.sessions) session.send(message);
	}

	private onExit(code: number | null): void {
		for (const [, pending] of this.pending) {
			pending.session.send({
				jsonrpc: '2.0',
				id: pending.clientId,
				error: { code: -32000, message: `LSP server exited (${code ?? 'unknown'})` },
			});
		}
		this.pending.clear();
		for (const session of this.sessions) session.server = undefined;
	}

	kill(): void {
		if (!this.alive) return;
		try {
			this.proc.kill();
		} catch {
			// Already gone.
		}
	}
}

class Session {
	server?: ServerInstance;
	awaitingInitialize = false;
	private framer = createFrameReader((message) => this.onMessage(message));

	constructor(private readonly socket: Socket) {
		socket.on('data', this.framer);
		socket.on('close', () => this.close());
		socket.on('error', () => this.close());
	}

	send(message: JsonRpcMessage): void {
		if (this.socket.destroyed) return;
		writeMessage(this.socket, message);
	}

	close(): void {
		this.server?.sessions.delete(this);
		this.server = undefined;
	}

	private onMessage(message: JsonRpcMessage): void {
		if (message.id !== undefined && message.method === undefined) {
			if (this.server && typeof message.id === 'number' && this.server.serverRequestIds.has(message.id)) {
				this.server.serverRequestIds.delete(message.id);
				writeMessage(this.server.proc.stdin, message);
			}
			return;
		}
		if (!message.method) return;

		if (message.method === MUX_PING_METHOD) {
			if (message.id !== undefined) this.send({ jsonrpc: '2.0', id: message.id, result: MUX_PING_RESULT });
			return;
		}
		if (message.method === MUX_CONNECT_METHOD) {
			this.connect(message);
			return;
		}
		if (message.method === MUX_RESTART_METHOD) {
			this.server?.kill();
			this.server = undefined;
			if (message.id !== undefined) this.send({ jsonrpc: '2.0', id: message.id, result: { restarted: true } });
			return;
		}

		if (!this.server) {
			if (message.id !== undefined) {
				this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'Not connected to a server' } });
			}
			return;
		}

		if (message.method === 'initialize') {
			this.awaitingInitialize = true;
			if (this.server.initializeCached) {
				this.awaitingInitialize = false;
				if (message.id !== undefined) {
					this.send({ jsonrpc: '2.0', id: message.id, result: this.server.initializeResult });
				}
				return;
			}
		}
		this.server.forward(this, message);
	}

	private connect(message: JsonRpcMessage): void {
		const params = message.params as MuxConnectParams | undefined;
		const valid = params
			&& typeof params.command === 'string'
			&& typeof params.cwd === 'string'
			&& Array.isArray(params.args)
			&& params.args.every((arg) => typeof arg === 'string');
		if (!valid) {
			if (message.id !== undefined) {
				this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Invalid mux connect params' } });
			}
			return;
		}

		const key = params.key || muxKey(params);
		let server = servers.get(key);
		if (!server || !server.alive) {
			servers.delete(key);
			try {
				server = new ServerInstance(key, params);
			} catch (error) {
				this.send({
					jsonrpc: '2.0',
					id: message.id!,
					error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
				});
				return;
			}
			servers.set(key, server);
		}
		this.server = server;
		server.sessions.add(this);
		server.lastUsed = Date.now();
		if (message.id !== undefined) this.send({ jsonrpc: '2.0', id: message.id, result: { key } });
	}
}

const servers = new Map<string, ServerInstance>();
let lastActivity = Date.now();

/** Start the broker on `socketPath`. Returns the listening server. */
export function startMuxServer(socketPath: string): NetServer {
	const server = createServer((socket) => {
		lastActivity = Date.now();
		new Session(socket);
	});
	server.listen(socketPath);
	setInterval(() => {
		const now = Date.now();
		for (const [key, instance] of servers) {
			if (instance.sessions.size > 0) continue;
			if (now - instance.lastUsed < SERVER_LINGER_MS) continue;
			instance.kill();
			servers.delete(key);
		}
		if (servers.size === 0 && now - lastActivity > DAEMON_IDLE_MS) process.exit(0);
	}, 60_000).unref();
	return server;
}


export function muxServerCount(): number {
	return servers.size;
}

export async function shutdownMuxServers(): Promise<void> {
	for (const instance of servers.values()) instance.kill();
	servers.clear();
}
