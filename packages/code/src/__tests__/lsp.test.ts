import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LspManager } from '../lsp/manager.js';
import { runNavigationAction, runSymbolsAction } from '../lsp/actions/navigation.js';
import { runDiagnosticsAction } from '../lsp/actions/diagnostics.js';
import { runCodeActionsAction, runFormatAction, runRenameAction } from '../lsp/actions/refactor.js';
import { runReloadAction, runStatusAction } from '../lsp/actions/admin.js';
import type { ActionContext, LspArgs } from '../lsp/actions/types.js';
import { runLspWritethrough } from '../lsp/writethrough.js';
import { resetDiagnosticsLedger } from '../lsp/diagnostics-ledger.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-lsp.mjs', import.meta.url));

let manager: LspManager;
let dir: string;
let file: string;

function context(args: LspArgs): ActionContext {
	return { manager, args, cwd: dir };
}

beforeEach(async () => {
	resetDiagnosticsLedger();
	dir = mkdtempSync(join(tmpdir(), 'spectra-lsp-'));
	mkdirSync(join(dir, 'src'));
	writeFileSync(join(dir, 'package.json'), '{}');
	file = join(dir, 'src', 'file.ts');
	writeFileSync(file, 'foo bar\nBAD line\nother foo\n');
	manager = new LspManager({
		enabled: true,
		requestTimeout: 5000,
		diagnostics: { waitMs: 500, pull: true, workspaceConcurrency: 2 },
		servers: {
			typescript: {
				command: process.execPath,
				args: [fixture],
				filetypes: ['.ts'],
				rootMarkers: ['package.json'],
				languageId: 'typescript',
			},
		},
	}, dir);
});

afterEach(async () => {
	await manager.shutdownAll();
	rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('lsp navigation', () => {
	it('resolves a definition at a symbol', async () => {
		const result = await runNavigationAction(context({ action: 'definition', file, line: 1, symbol: 'foo' }));
		expect(result.text).toContain('src/file.ts:2:3');
		expect(result.details.count).toBe(1);
	});

	it('lists references', async () => {
		const result = await runNavigationAction(context({ action: 'references', file, line: 1, symbol: 'foo' }));
		expect(result.text.split('\n')).toHaveLength(2);
	});

	it('renders hover contents', async () => {
		const result = await runNavigationAction(context({ action: 'hover', file, line: 1, symbol: 'foo' }));
		expect(result.text).toBe('hover text');
	});

	it('lists document and workspace symbols', async () => {
		const documentSymbols = await runSymbolsAction(context({ action: 'symbols', file }));
		expect(documentSymbols.text).toContain('foo (function)');
		const workspaceSymbols = await runSymbolsAction(context({ action: 'symbols', file, query: 'bar' }));
		expect(workspaceSymbols.text).toContain('bar');
	});
});

describe('lsp diagnostics', () => {
	it('prefers pull diagnostics', async () => {
		const result = await runDiagnosticsAction(context({ action: 'diagnostics', file }));
		expect(result.text).toContain('Pulled error');
		expect(result.details.source).toBe('pull');
	});
});

describe('lsp refactors', () => {
	it('previews rename without writing', async () => {
		const result = await runRenameAction(context({ action: 'rename', file, line: 1, symbol: 'foo', new_name: 'renamed' }));
		expect(result.text).toContain('renamed');
		expect(readFileSync(file, 'utf8').startsWith('foo')).toBe(true);
	});

	it('applies rename edits', async () => {
		await runRenameAction(context({ action: 'rename', file, line: 1, symbol: 'foo', new_name: 'renamed', apply: true }));
		expect(readFileSync(file, 'utf8').startsWith('renamed')).toBe(true);
	});

	it('lists and applies code actions', async () => {
		const listed = await runCodeActionsAction(context({ action: 'code_actions', file, line: 1 }));
		expect(listed.text).toContain('Fix it');
		await runCodeActionsAction(context({ action: 'code_actions', file, line: 1, apply: true, query: '1' }));
		expect(readFileSync(file, 'utf8').startsWith('fixed')).toBe(true);
	});

	it('formats the document', async () => {
		writeFileSync(file, 'foo bar');
		const result = await runFormatAction(context({ action: 'format', file }));
		expect(result.text).toContain('Formatted');
		expect(readFileSync(file, 'utf8')).toBe('foo bar\n');
	});
});

describe('lsp admin', () => {
	it('reports status and stops servers', async () => {
		await runNavigationAction(context({ action: 'definition', file, line: 1, symbol: 'foo' }));
		const status = await runStatusAction(context({ action: 'status' }));
		expect(status.text).toContain('typescript');
		const reload = await runReloadAction(context({ action: 'reload' }));
		expect(reload.details.stopped).toBe(1);
	});

	it('rejects unsupported file types', async () => {
		const unknown = join(dir, 'a.xyz');
		writeFileSync(unknown, 'x');
		await expect(runNavigationAction(context({ action: 'definition', file: unknown, line: 1 }))).rejects.toThrow('No LSP server configured');
	});
});

describe('lsp writethrough', () => {
	function pushManager(extra: Record<string, unknown> = {}) {
		return new LspManager({
			enabled: true,
			requestTimeout: 5000,
			diagnostics: { waitMs: 1500, pull: false, workspaceConcurrency: 2 },
			servers: {
				typescript: {
					command: process.execPath,
					args: [fixture],
					filetypes: ['.ts'],
					rootMarkers: ['package.json'],
					languageId: 'typescript',
				},
			},
			...extra,
		}, dir);
	}

	it('returns fresh diagnostics inline', async () => {
		const local = pushManager();
		try {
			writeFileSync(file, 'plain text\n');
			const outcome = await runLspWritethrough(file, undefined, { manager: local, inlineWaitMs: 1000 });
			expect(outcome.text).toContain('Pushed warning');
		} finally {
			await local.shutdownAll();
		}
	});

	it('defers diagnostics when the server misses the inline budget', async () => {
		const local = pushManager();
		try {
			writeFileSync(file, 'SLOW content\n');
			const deferred = Promise.withResolvers<{ path: string; messages: string[] }>();
			const outcome = await runLspWritethrough(file, undefined, {
				manager: local,
				inlineWaitMs: 30,
				onDeferred: (batch) => deferred.resolve(batch),
			});
			expect(outcome.text).toBe('');
			const batch = await deferred.promise;
			expect(batch.path).toBe(file);
			expect(batch.messages.join('\n')).toContain('Pushed warning');
		} finally {
			await local.shutdownAll();
		}
	});

	it('suppresses diagnostics identical to the previous batch', async () => {
		const local = pushManager();
		try {
			writeFileSync(file, 'same text\n');
			const first = await runLspWritethrough(file, undefined, { manager: local, inlineWaitMs: 1000 });
			const second = await runLspWritethrough(file, undefined, { manager: local, inlineWaitMs: 1000 });
			expect(first.text).toContain('Pushed warning');
			expect(second.text).toBe('');
		} finally {
			await local.shutdownAll();
		}
	});

	it('formats on write when enabled', async () => {
		const local = pushManager({ formatOnWrite: true, diagnosticsOnWrite: false });
		try {
			writeFileSync(file, 'foo bar');
			const outcome = await runLspWritethrough(file, undefined, { manager: local, inlineWaitMs: 1000 });
			expect(outcome.formatted).toBe(true);
			expect(readFileSync(file, 'utf8')).toBe('foo bar\n');
		} finally {
			await local.shutdownAll();
		}
	});
});

describe('lsp mux', () => {
	it('shares one server between manager instances', async () => {
		const { startMuxServer, muxServerCount, shutdownMuxServers } = await import('../lsp/mux/broker.js');
		const { muxSocketPath, MUX_SOCKET_ENV } = await import('../lsp/mux/protocol.js');
		const socketPath = muxSocketPath(join(dir, 'mux'));
		const server = startMuxServer(socketPath);
		await new Promise<void>((resolvePromise) => server.once('listening', () => resolvePromise()));
		vi.stubEnv(MUX_SOCKET_ENV, socketPath);

		const makeManager = () => new LspManager({
			enabled: true,
			shared: true,
			requestTimeout: 5000,
			servers: {
				typescript: {
					command: process.execPath,
					args: [fixture],
					filetypes: ['.ts'],
					rootMarkers: ['package.json'],
					languageId: 'typescript',
				},
			},
		}, dir);

		const first = makeManager();
		const second = makeManager();
		try {
			const a = await runNavigationAction({ manager: first, args: { action: 'definition', file, line: 1, symbol: 'foo' }, cwd: dir });
			const b = await runNavigationAction({ manager: second, args: { action: 'definition', file, line: 1, symbol: 'foo' }, cwd: dir });
			expect(a.text).toContain('src/file.ts');
			expect(b.text).toContain('src/file.ts');
			expect(muxServerCount()).toBe(1);
		} finally {
			await first.shutdownAll();
			await second.shutdownAll();
			await shutdownMuxServers();
			await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
			vi.unstubAllEnvs();
		}
	});
});

describe('biome integration', () => {
	it('merges biome diagnostics into writethrough output', async () => {
		const biome = fileURLToPath(new URL('./fixtures/fake-biome.mjs', import.meta.url));
		const local = new LspManager({
			enabled: true,
			requestTimeout: 5000,
			diagnostics: { waitMs: 1000, pull: false, workspaceConcurrency: 1 },
			linters: { biome: { command: process.execPath, args: [biome] } },
			servers: {
				typescript: {
					command: process.execPath,
					args: [fixture],
					filetypes: ['.ts'],
					rootMarkers: ['package.json'],
					languageId: 'typescript',
				},
			},
		}, dir);
		try {
			writeFileSync(file, 'plain text\n');
			const outcome = await runLspWritethrough(file, undefined, { manager: local, inlineWaitMs: 1000 });
			expect(outcome.text).toContain('Pushed warning');
			expect(outcome.text).toContain('Biome error');
		} finally {
			await local.shutdownAll();
		}
	});
});
