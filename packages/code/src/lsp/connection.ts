import type { ChildProcessWithoutNullStreams } from 'child_process';
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

export interface RequestOptions {
	timeoutMs: number;
	signal?: AbortSignal;
}

/** Framed JSON-RPC connection over a child process's stdio. */
export class JsonRpcConnection {
	private pending = new Map<number, Pending>();
	private nextId = 1;
	private disposed = false;

	constructor(
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly handlers: ConnectionHandlers,
	) {
		const feed = createFrameReader((message) => this.dispatch(message));
		child.stdout.on('data', feed);
	}

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
			writeMessage(this.child.stdin, { jsonrpc: '2.0', id, method, params });
		} catch (error) {
			this.settle(id, error instanceof Error ? error : new Error(String(error)));
		}
		return promise.finally(() => options.signal?.removeEventListener('abort', onAbort));
	}

	notify(method: string, params: unknown): void {
		if (this.disposed) return;
		writeMessage(this.child.stdin, { jsonrpc: '2.0', method, params });
	}

	dispose(error = new Error('Connection closed')): void {
		this.disposed = true;
		for (const id of [...this.pending.keys()]) this.settle(id, error);
	}

	private settle(id: number, error?: Error, value?: unknown): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(id);
		if (error) pending.reject(error);
		else pending.resolve(value);
	}

	private dispatch(message: JsonRpcMessage): void {
		if (message.id !== undefined && message.method === undefined) {
			if (message.error) this.settle(Number(message.id), new Error(message.error.message));
			else this.settle(Number(message.id), undefined, message.result);
			return;
		}

		if (message.method && message.id !== undefined) {
			void Promise.resolve(this.handlers.onRequest(message.method, message.params))
				.then((result) => {
					if (!this.disposed) writeMessage(this.child.stdin, { jsonrpc: '2.0', id: message.id!, result });
				})
				.catch((error: unknown) => {
					if (!this.disposed) {
						writeMessage(this.child.stdin, {
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
}
