import { createHash } from 'crypto';
import { join } from 'path';

export const MUX_SOCKET_ENV = 'SPECTRA_LSP_MUX_SOCKET';
export const MUX_ROOT_ENV = 'SPECTRA_LSP_MUX_ROOT';
export const MUX_CONNECT_METHOD = 'spectra/muxConnect';
export const MUX_PING_METHOD = 'spectra/muxPing';
export const MUX_PING_RESULT = 'pong';
export const MUX_RESTART_METHOD = 'spectra/muxRestartServer';
export const MUX_READY_PATTERN = /spectra lsp mux listening on /;

export interface MuxConnectParams {
	key: string;
	command: string;
	args: string[];
	cwd: string;
	env?: Record<string, string>;
}

export function muxKey(params: Pick<MuxConnectParams, 'command' | 'args' | 'cwd'>): string {
	return JSON.stringify([params.command, params.args, params.cwd]);
}

export function muxSocketPath(root: string): string {
	const hash = createHash('sha256').update(root).digest('hex').slice(0, 16);
	if (process.platform === 'win32') return `\\\\.\\pipe\\spectra-lsp-${hash}`;
	return join(process.env.XDG_RUNTIME_DIR || '/tmp', `spectra-lsp-${hash}.sock`);
}
