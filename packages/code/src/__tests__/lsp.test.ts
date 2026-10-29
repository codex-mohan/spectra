import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LspManager } from '../lsp/manager.js';
import { runNavigationAction, runSymbolsAction } from '../lsp/actions/navigation.js';
import { runDiagnosticsAction } from '../lsp/actions/diagnostics.js';
import { runCodeActionsAction, runFormatAction, runRenameAction } from '../lsp/actions/refactor.js';
import { runReloadAction, runStatusAction } from '../lsp/actions/admin.js';
import type { ActionContext, LspArgs } from '../lsp/actions/types.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-lsp.mjs', import.meta.url));

let manager: LspManager;
let dir: string;
let file: string;

function context(args: LspArgs): ActionContext {
	return { manager, args, cwd: dir };
}

beforeEach(async () => {
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
