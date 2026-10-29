import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const documents = new Map();

function send(message) {
	const body = Buffer.from(JSON.stringify(message), 'utf8');
	process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
}

function location(uri, line = 0, character = 0) {
	return { uri, range: { start: { line, character }, end: { line, character: character + 3 } } };
}

function publish(uri, version, text) {
	const diagnostics = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 2, message: 'Pushed warning', source: 'fake' }];
	const sendIt = () => send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, version, diagnostics } });
	if (String(text).includes('SLOW')) setTimeout(sendIt, 300);
	else sendIt();
}

function handle(message) {
	if (message.id !== undefined && message.method) {
		switch (message.method) {
			case 'initialize':
				return send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {
					textDocumentSync: 1,
					diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: true },
					definitionProvider: true,
					referencesProvider: true,
					hoverProvider: true,
					renameProvider: true,
					codeActionProvider: true,
					documentSymbolProvider: true,
					workspaceSymbolProvider: true,
					documentFormattingProvider: true,
				} } });
			case 'textDocument/definition':
				return send({ jsonrpc: '2.0', id: message.id, result: location(message.params.textDocument.uri, 1, 2) });
			case 'textDocument/references':
				return send({ jsonrpc: '2.0', id: message.id, result: [location(message.params.textDocument.uri, 0, 0), location(message.params.textDocument.uri, 2, 0)] });
			case 'textDocument/hover':
				return send({ jsonrpc: '2.0', id: message.id, result: { contents: { kind: 'markdown', value: 'hover text' } } });
			case 'textDocument/documentSymbol':
				return send({ jsonrpc: '2.0', id: message.id, result: [{ name: 'foo', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }] });
			case 'workspace/symbol':
				return send({ jsonrpc: '2.0', id: message.id, result: [{ name: 'bar', kind: 5, location: location(message.params.query.startsWith('bar') ? 'file:///tmp/bar.ts' : 'file:///tmp/foo.ts') }] });
			case 'textDocument/prepareRename':
				return send({ jsonrpc: '2.0', id: message.id, result: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, placeholder: 'foo' } });
			case 'textDocument/rename':
				return send({ jsonrpc: '2.0', id: message.id, result: { changes: { [message.params.textDocument.uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: message.params.newName }] } } });
			case 'workspace/willRenameFiles':
				return send({ jsonrpc: '2.0', id: message.id, result: {} });
			case 'textDocument/codeAction':
				return send({ jsonrpc: '2.0', id: message.id, result: [
					{ title: 'Fix it', kind: 'quickfix', edit: { changes: { [message.params.textDocument.uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'fixed' }] } } },
					{ title: 'Run command', command: { title: 'Run', command: 'fake.command' } },
				] });
			case 'textDocument/formatting': {
				const document = documents.get(message.params.textDocument.uri) ?? { text: '' };
				return send({ jsonrpc: '2.0', id: message.id, result: [{ range: { start: { line: 0, character: 0 }, end: { line: 999, character: 0 } }, newText: `${document.text.trimEnd()}\n` }] });
			}
			case 'workspace/diagnostic':
				return send({ jsonrpc: '2.0', id: message.id, result: { items: [] } });
			case 'textDocument/diagnostic':
				return send({ jsonrpc: '2.0', id: message.id, result: { items: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: 'Pulled error', source: 'fake' }] } });
			case 'workspace/executeCommand':
				return send({ jsonrpc: '2.0', id: message.id, result: null });
			case 'shutdown':
				return send({ jsonrpc: '2.0', id: message.id, result: null });
			default:
				return send({ jsonrpc: '2.0', id: message.id, result: null });
		}
	}

	if (message.method === 'textDocument/didOpen') {
		documents.set(message.params.textDocument.uri, { text: message.params.textDocument.text });
		publish(message.params.textDocument.uri, message.params.textDocument.version ?? 1, message.params.textDocument.text);
	}
	if (message.method === 'textDocument/didChange') {
		const text = message.params.contentChanges?.[0]?.text ?? '';
		documents.set(message.params.textDocument.uri, { text });
		publish(message.params.textDocument.uri, message.params.textDocument.version ?? 1, text);
	}
	if (message.method === 'exit') process.exit(0);
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
	buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
	for (;;) {
		const headerEnd = buffer.indexOf('\r\n\r\n');
		if (headerEnd < 0) return;
		const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString('ascii'));
		if (!match) { buffer = buffer.subarray(headerEnd + 4); continue; }
		const length = Number(match[1]);
		const start = headerEnd + 4;
		if (buffer.length < start + length) return;
		const body = buffer.subarray(start, start + length).toString('utf8');
		buffer = buffer.subarray(start + length);
		try { handle(JSON.parse(body)); } catch {}
	}
});
