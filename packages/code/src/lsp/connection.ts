import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { Duplex } from 'stream';
import { createFrameReader, writeMessage, type JsonRpcMessage } from './framing.js';

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export interface ConnectionHandlers {
	onNotification: (method: string, params: unknown) => void;
	onRequest: (method: string, params: unknown) => Promise<unknown> | unknown;
}

export interface RpcConnection {
	request(method: string, params: unknown, options: RequestOptions): Promise<unknown>;
	notify(method: string, params: unknown): void;
	dispose(error?: Error): void;
}

export interface RequestOptions {
	timeoutMs: number;
	signal?: AbortSignal;
}

/** Shared JSON-RPC state for child-stdio and socket transports. */
abstract class BaseConnection implements RpcConnection {
	private pending = new Map<number, Pending>();
	protected nextId = 1;
	protected disposed = false;

	constructor(protected readonly handlers: ConnectionHandlers) {}

	protected abstract write(message: JsonRpcMessage): void;
	protected abstract disposeTransport(): void;

	request(method: string, params: unknown, options: RequestOptions): Promise<unknown> {
		if (this.disposed) return Promise.reject(new Error('Connection closed'));
		const id = this.nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const timer = setTimeout(() => {
			this.pending.delete(id);
			reject(new Error(`${method} timed out after ${Math.round(options.timeoutMs / 1000)}s`));
		}, options.timeoutMs);
		this.pending.set(id, { resolve, reject, timer });

		const onAbort = () => {
			this.notify('$/cancelRequest', { id });
			this.settle(id, new Error(`${method} aborted`));
		};
		options.signal?.addEventListener('abort', onAbort, { once: true });
		try {
			this.write({ jsonrpc: '2.0', id, method, params });
		} catch (error) {
			this.settle(id, error instanceof Error ? error : new Error(String(error)));
		}
		return promise.finally(() => options.signal?.removeEventListener('abort', onAbort));
	}

	notify(method: string, params: unknown): void {
		if (this.disposed) return;
		this.write({ jsonrpc: '2.0', method, params });
	}

	dispose(error = new Error('Connection closed')): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const id of [...this.pending.keys()]) this.settle(id, error);
		this.disposeTransport();
	}

	protected feed(message: JsonRpcMessage): void {
		if (message.id !== undefined && message.method === undefined) {
			if (message.error) this.settle(Number(message.id), new Error(message.error.message));
			else this.settle(Number(message.id), undefined, message.result);
			return;
		}

		if (message.method && message.id !== undefined) {
			void Promise.resolve(this.handlers.onRequest(message.method, message.params))
				.then((result) => {
					if (!this.disposed) this.write({ jsonrpc: '2.0', id: message.id!, result });
				})
				.catch((error: unknown) => {
					if (!this.disposed) {
						this.write({
							jsonrpc: '2.0',
							id: message.id!,
							error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
						});
					}
				});
			return;
		}

		if (message.method) this.handlers.onNotification(message.method, message.params);
	}

	private settle(id: number, error?: Error, value?: unknown): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(id);
		if (error) pending.reject(error);
		else pending.resolve(value);
	}
}

/** JSON-RPC over a child process's stdio. */
export class JsonRpcConnection extends BaseConnection {
	constructor(
		private readonly child: ChildProcessWithoutNullStreams,
		handlers: ConnectionHandlers,
	) {
		super(handlers);
		child.stdout.on('data', createFrameReader((message) => this.feed(message)));
	}

	protected write(message: JsonRpcMessage): void {
		writeMessage(this.child.stdin, message);
	}

	protected disposeTransport(): void {
		// The child is owned by the caller.
	}
}

/** JSON-RPC over a duplex stream such as a mux socket. */
export class StreamJsonRpcConnection extends BaseConnection {
	constructor(
		private readonly stream: Duplex,
		handlers: ConnectionHandlers,
	) {
		super(handlers);
		stream.on('data', createFrameReader((message) => this.feed(message)));
	}

	protected write(message: JsonRpcMessage): void {
		writeMessage(this.stream, message);
	}

	protected disposeTransport(): void {
		this.stream.end();
	}
}
