import { startMuxServer } from './broker.js';
import { MUX_ROOT_ENV, MUX_SOCKET_ENV } from './protocol.js';

const socketPath = process.env[MUX_SOCKET_ENV];
if (!socketPath) {
	console.error('spectra lsp mux: missing socket path');
	process.exit(1);
}

const server = startMuxServer(socketPath);
server.on('listening', () => {
	console.log(`spectra lsp mux listening on ${socketPath} (${process.env[MUX_ROOT_ENV] ?? ''})`);
});
server.on('error', (error) => {
	console.error(`spectra lsp mux: ${error.message}`);
	process.exit(1);
});
