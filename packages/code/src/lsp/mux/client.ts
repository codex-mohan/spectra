import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { connect, type Socket } from 'net';
import { fileURLToPath } from 'url';
import { StreamJsonRpcConnection, type ConnectionHandlers } from '../connection.js';
import {
	MUX_CONNECT_METHOD,
	MUX_PING_METHOD,
	MUX_PING_RESULT,
	MUX_ROOT_ENV,
	MUX_SOCKET_ENV,
	muxSocketPath,
	muxKey,
	type MuxConnectParams,
} from './protocol.js';

function sleep(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function ping(socketPath: string): Promise<boolean> {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const socket = connect(socketPath);
	let settled = false;
	const finish = (ok: boolean) => {
		if (settled) return;
		settled = true;
		socket.destroy();
		resolve(ok);
	};
	socket.setTimeout(400, () => finish(false));
	socket.on('error', () => finish(false));
	socket.on('connect', () => {
		const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: MUX_PING_METHOD }), 'utf8');
		socket.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
	});
	socket.on('data', (chunk) => {
		const text = chunk.toString('utf8');
		if (text.includes(MUX_PING_RESULT)) finish(true);
	});
	await promise;
	return promise;
}

function daemonEntry(): string | null {
	const candidates = ['daemon.js', 'daemon.ts'].map((name) => fileURLToPath(new URL(name, import.meta.url)));
	const existing = candidates.find((file) => existsSync(file));
	if (!existing) return null;
	if (!process.versions.bun && existing.endsWith('.ts')) return null;
	return existing;
}

/** Return a live mux socket for this project, starting the daemon when needed. */
export async function ensureMuxDaemon(root: string): Promise<string | null> {
	if (process.env.SPECTRA_LSP_MUX_DISABLE === '1') return null;
	const socketPath = process.env[MUX_SOCKET_ENV] ?? muxSocketPath(root);
	if (await ping(socketPath)) return socketPath;

	const entry = daemonEntry();
	if (!entry) return null;

	const child = spawn(process.execPath, [entry], {
		env: { ...process.env, [MUX_SOCKET_ENV]: socketPath, [MUX_ROOT_ENV]: root },
		detached: true,
		stdio: 'ignore',
		windowsHide: true,
	});
	child.unref();

	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		if (await ping(socketPath)) return socketPath;
		await sleep(100);
	}
	return null;
}

function connectSocket(socketPath: string): Promise<Socket> {
	const { promise, resolve, reject } = Promise.withResolvers<Socket>();
	const socket = connect(socketPath);
	socket.once('connect', () => resolve(socket));
	socket.once('error', (error) => reject(error));
	return promise;
}

/** Connect to the daemon and bind the link to one server key. */
export async function connectMux(
	socketPath: string,
	server: { command: string; args: string[]; cwd: string; env?: Record<string, string> },
	handlers: ConnectionHandlers,
	timeoutMs: number,
): Promise<StreamJsonRpcConnection> {
	const socket = await connectSocket(socketPath);
	const connection = new StreamJsonRpcConnection(socket, handlers);
	const params: MuxConnectParams = {
		key: muxKey(server),
		command: server.command,
		args: server.args,
		cwd: server.cwd,
		...(server.env ? { env: server.env } : {}),
	};
	await connection.request(MUX_CONNECT_METHOD, params, { timeoutMs });
	return connection;
}
