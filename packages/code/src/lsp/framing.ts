import type { Readable, Writable } from 'stream';

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcMessage {
	jsonrpc: '2.0';
	id?: number | string;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: JsonRpcError;
}

export function encodeMessage(message: JsonRpcMessage): Uint8Array {
	const body = Buffer.from(JSON.stringify(message), 'utf8');
	return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/** Framed reader for `Content-Length` JSON-RPC. Returns a feed function. */
export function createFrameReader(onMessage: (message: JsonRpcMessage) => void): (chunk: Buffer) => void {
	let buffer: Buffer<ArrayBufferLike> = Buffer.concat([]);
	return (chunk: Buffer) => {
		buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
		for (;;) {
			const headerEnd = buffer.indexOf('\r\n\r\n');
			if (headerEnd < 0) return;
			const header = buffer.subarray(0, headerEnd).toString('ascii');
			const match = /Content-Length:\s*(\d+)/i.exec(header);
			if (!match) {
				buffer = buffer.subarray(headerEnd + 4);
				continue;
			}
			const length = Number(match[1]);
			const start = headerEnd + 4;
			if (buffer.length < start + length) return;
			const body = buffer.subarray(start, start + length).toString('utf8');
			buffer = buffer.subarray(start + length);
			try {
				onMessage(JSON.parse(body) as JsonRpcMessage);
			} catch {
				// A malformed frame must not desynchronize the reader.
			}
		}
	};
}

export function writeMessage(stream: Writable, message: JsonRpcMessage): void {
	stream.write(encodeMessage(message));
}

export type { Readable, Writable };
