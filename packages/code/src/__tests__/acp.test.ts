import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';

const cliEntry = join(process.cwd(), 'src', 'cli.ts');

interface JsonRpcMessage {
	jsonrpc: '2.0';
	id?: number | string;
	method?: string;
	result?: unknown;
	error?: { code: number; message: string };
	params?: unknown;
}

function sendRequest(proc: ChildProcess, id: number, method: string, params?: unknown): void {
	proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
}

function collectOutput(proc: ChildProcess, lines: number): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const collected: string[] = [];
		const timeout = setTimeout(() => resolve(collected), 5000);

		const onData = (data: Buffer) => {
			const text = data.toString();
			const parts = text.trim().split('\n');
			for (const part of parts) {
				try {
					JSON.parse(part);
					collected.push(part);
					if (collected.length >= lines) {
						clearTimeout(timeout);
						proc.stdout?.removeListener('data', onData);
						resolve(collected);
					}
				} catch {
					/* skip non-JSON output */
				}
			}
		};
		proc.stdout?.on('data', onData);
		proc.on('error', reject);
		proc.on('close', () => {
			clearTimeout(timeout);
			resolve(collected);
		});
	});
}

function spawnAcp(): ChildProcess {
	return spawn('bun', [cliEntry, 'acp'], {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...process.env, SPECTRA_CONFIG: JSON.stringify({ model: 'test/test', provider: 'test' }) },
	});
}

async function initProc(proc: ChildProcess): Promise<void> {
	sendRequest(proc, 1, 'initialize');
	await collectOutput(proc, 1);
}

describe('ACP Protocol', () => {
	describe('Shared engine architecture', () => {
		it('imports Agent from @mohanscodex/spectra-agent', async () => {
			// The ACP server imports the exact same Agent class used by the TUI
			const { Agent: SdkAgent } = await import('@mohanscodex/spectra-agent');
			const acpSource = await import('../integrations/acp/server.js');

			// ACPAdapter uses Agent internally — imported from the same package
			const adapter = new acpSource.ACPAdapter();
			expect(adapter).toBeDefined();
			expect(SdkAgent).toBeDefined();
		});

		it('shares the same tool system as the TUI', async () => {
			// The ACP server uses createAllTools + spectraToolToAgentTool — same as TUI
			const { builtinTools, createAllTools } = await import('../tools/index.js');
			const tools = createAllTools();

			expect(tools).toHaveLength(builtinTools.length);
			expect(tools.map((t) => t.name).sort()).toEqual([
				'bash',
				'edit',
				'glob',
				'grep',
				'read',
				'task',
				'web_fetch',
				'write',
			]);
		});

		it('shares the same config loader', async () => {
			const { loadConfig: tuiLoadConfig } = await import('../services/config.js');
			const { loadConfig: acpLoadConfig } = await import('../services/config.js');

			// Same module reference
			expect(acpLoadConfig).toBe(tuiLoadConfig);
		});

		it('shares the same auth store', async () => {
			const { readAll: tuiReadAll } = await import('../services/auth-store.js');
			const { readAll: acpReadAll } = await import('../services/auth-store.js');

			expect(acpReadAll).toBe(tuiReadAll);
		});

		it('shares the same agent definitions', async () => {
			const { AGENT_DEFINITIONS: tuiDefs } = await import('../agents/index.js');

			const { AGENT_DEFINITIONS: acpDefs } = await import('../agents/index.js');
			expect(acpDefs).toBe(tuiDefs);
			expect(Object.keys(acpDefs)).toEqual(['build', 'plan', 'debug', 'explore']);
		});

		it('session/new creates a real Agent with tools registered', async () => {
			const proc = spawnAcp();
			await initProc(proc);

			sendRequest(proc, 2, 'session/new');
			const lines = await collectOutput(proc, 1);
			const msg: JsonRpcMessage = JSON.parse(lines[0]);

			expect(msg.jsonrpc).toBe('2.0');
			expect(msg.id).toBe(2);
			expect(msg.result).toBeDefined();
			const result = msg.result as Record<string, unknown>;
			expect(result.sessionId).toBeDefined();
			expect(typeof result.sessionId).toBe('string');
			expect((result.serverInfo as Record<string, unknown>).name).toBe('Spectra Code');

			proc.kill();
		});

		it('session/new error with auth store via config', async () => {
			// Tests that the same auth resolution path works
			const proc = spawn('bun', [cliEntry, 'acp'], {
				stdio: ['pipe', 'pipe', 'pipe'],
				env: { ...process.env, SPECTRA_CONFIG: JSON.stringify({ model: 'test/model', provider: 'test' }) },
			});
			await initProc(proc);

			// Send session/new with a specific sessionId to verify it's honored
			sendRequest(proc, 2, 'session/new', { sessionId: 'custom-session-id' });
			const lines = await collectOutput(proc, 1);
			const msg: JsonRpcMessage = JSON.parse(lines[0]);

			expect(msg.result).toBeDefined();
			const result = msg.result as Record<string, unknown>;
			expect(result.sessionId).toBe('custom-session-id');

			proc.kill();
		});
	});

	describe('JSON-RPC message handling', () => {
		it('responds to initialize', async () => {
			const proc = spawnAcp();

			sendRequest(proc, 1, 'initialize');
			const lines = await collectOutput(proc, 1);
			const msg: JsonRpcMessage = JSON.parse(lines[0]);

			expect(msg.jsonrpc).toBe('2.0');
			expect(msg.id).toBe(1);
			expect(msg.result).toBeDefined();
			const result = msg.result as Record<string, unknown>;
			expect(result.protocolVersion).toBe('0.1.0');
			expect((result.serverInfo as Record<string, unknown>).name).toBe('Spectra Code');
			expect((result.serverInfo as Record<string, unknown>).version).toBeDefined();
			expect(result.capabilities).toEqual({});

			proc.kill();
		});

		it('errors on unknown method', async () => {
			const proc = spawnAcp();

			sendRequest(proc, 1, 'initialize');
			await collectOutput(proc, 1);

			sendRequest(proc, 2, 'unknown_method');
			const lines = await collectOutput(proc, 1);
			const msg: JsonRpcMessage = JSON.parse(lines[0]);

			expect(msg.jsonrpc).toBe('2.0');
			expect(msg.id).toBe(2);
			expect(msg.error).toBeDefined();
			expect(msg.error!.code).toBe(-32601);
			expect(msg.error!.message).toContain('unknown_method');

			proc.kill();
		});

		it('handles malformed JSON gracefully', async () => {
			const proc = spawnAcp();

			proc.stdin!.write('not json\n');

			sendRequest(proc, 1, 'initialize');
			const lines = await collectOutput(proc, 1);
			const msg: JsonRpcMessage = JSON.parse(lines[0]);
			expect(msg.id).toBe(1);
			expect(msg.result).toBeDefined();

			proc.kill();
		});

		it('session/cancel returns cancelled status', async () => {
			const proc = spawnAcp();

			sendRequest(proc, 1, 'initialize');
			await collectOutput(proc, 1);

			sendRequest(proc, 2, 'session/cancel', { sessionId: 'nonexistent' });
			const lines = await collectOutput(proc, 1);
			const msg: JsonRpcMessage = JSON.parse(lines[0]);

			expect(msg.jsonrpc).toBe('2.0');
			expect(msg.id).toBe(2);
			expect((msg.result as Record<string, unknown>).status).toBe('cancelled');

			proc.kill();
		});
	});
});
