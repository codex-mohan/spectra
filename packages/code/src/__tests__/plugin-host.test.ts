import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginHost } from '../plugins/host.js';
import { getAllSettings, setExternalSettings } from '../config/registry.js';

let home: string;
let cwd: string;
let previousHome: string | undefined;
let host: PluginHost;

function writePlugin(id: string, body: string): void {
	const dir = join(cwd, '.spectra', 'plugins', id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ id, entry: 'index.mjs', description: `Plugin ${id}` }));
	writeFileSync(join(dir, 'index.mjs'), body);
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), 'spectra-plugin-home-'));
	cwd = mkdtempSync(join(tmpdir(), 'spectra-plugin-project-'));
	mkdirSync(join(cwd, '.spectra'), { recursive: true });
	previousHome = process.env.SPECTRA_HOME;
	process.env.SPECTRA_HOME = home;
	host = new PluginHost();
});

afterEach(async () => {
	await host.shutdown();
	setExternalSettings([]);
	if (previousHome === undefined) delete process.env.SPECTRA_HOME;
	else process.env.SPECTRA_HOME = previousHome;
	rmSync(home, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

describe('PluginHost', () => {
	it('loads tools, commands, prompt sections, settings, and hooks', async () => {
		writePlugin('sample', `
			export default {
				setup(ctx) {
					ctx.tools.register({
						name: 'sample_echo',
						description: 'Echo from a plugin',
						parameters: ctx.zod.object({}),
						execute: async () => ({ content: [{ type: 'text', text: 'echo' }] }),
					});
					ctx.commands.register({
						id: 'sample:hello', name: 'hello', aliases: [], title: 'Hello',
						description: 'Plugin hello', source: 'plugin',
						execute: () => ({ type: 'show_toast', message: 'hi' }),
					});
					ctx.prompts.section({ id: 'sample', order: 120, text: 'Sample prompt section' });
					ctx.settings.register({ key: 'enabled', type: 'boolean', default: true, description: 'Sample setting' });
					ctx.hooks.on('tool.beforeExecute', (payload) => payload.toolName === 'blocked' ? { block: true, reason: 'blocked by sample' } : undefined);
				},
			};
		`);

		await host.initialize(cwd);
		const listed = host.list();
		expect(listed.find((plugin) => plugin.id === 'sample')?.state).toBe('active');
		expect(host.tools().map((tool) => tool.name)).toContain('sample_echo');
		expect(host.tools()[0]?.permission).toBe('plugin:sample');
		expect(host.commands().map((command) => command.name)).toEqual(['hello']);
		expect(host.commands()[0]?.source).toBe('plugin');
		expect(host.promptSections().map((section) => section.text)).toContain('Sample prompt section');
		expect(listed.find((plugin) => plugin.id === 'sample')?.contributions.hooks).toBe(1);
		expect(getAllSettings().some((setting) => setting.path === 'pluginSettings.sample.enabled')).toBe(true);
		await expect(host.runToolBefore({ toolName: 'blocked', args: {}, sessionId: 's' })).resolves.toMatchObject({ block: true, reason: 'blocked by sample' });
	});

	it('removes every contribution on disable and restores them on enable', async () => {
		writePlugin('sample', `
			export default {
				setup(ctx) {
					ctx.tools.register({ name: 'sample_tool', description: 'x', parameters: ctx.zod.object({}), execute: async () => ({ content: [] }) });
					ctx.commands.register({ id: 'sample:cmd', name: 'sample-cmd', aliases: [], title: 'Sample', description: 'x', source: 'plugin', execute: () => undefined });
					ctx.prompts.section({ id: 'sample', text: 'sample prompt' });
					ctx.settings.register({ key: 'value', type: 'string', description: 'sample' });
				},
			};
		`);
		await host.initialize(cwd);
		expect(host.tools()).toHaveLength(1);
		await host.setEnabled('sample', false);
		expect(host.tools()).toHaveLength(0);
		expect(host.commands()).toHaveLength(0);
		expect(host.promptSections()).toHaveLength(0);
		expect(getAllSettings().some((setting) => setting.path.startsWith('pluginSettings.sample.'))).toBe(false);
		await host.setEnabled('sample', true);
		expect(host.tools()).toHaveLength(1);
		expect(host.commands()).toHaveLength(1);
	});

	it('contains a throwing hook, reports it once, and disables the plugin', async () => {
		writePlugin('bad', `
			export default {
				setup(ctx) {
					ctx.hooks.on('tool.beforeExecute', () => { throw new Error('boom'); });
				},
			};
		`);
		await host.initialize(cwd);
		await host.runToolBefore({ toolName: 'any', args: {}, sessionId: 's' });
		const plugin = host.list().find((entry) => entry.id === 'bad');
		expect(plugin?.state).toBe('failed');
		expect(plugin?.error).toContain('boom');
		expect(plugin?.diagnostics.some((entry) => entry.message.includes('boom'))).toBe(true);
	});

	it('enforces the activation deadline on setup()', async () => {
		const fast = new PluginHost({ activationTimeoutMs: 50, hookTimeoutMs: 50 });
		writePlugin('slow', `
			export default {
				setup() {
					return new Promise(() => {});
				},
			};
		`);
		await fast.initialize(cwd);
		const plugin = fast.list().find((entry) => entry.id === 'slow');
		expect(plugin?.state).toBe('failed');
		expect(plugin?.error).toContain('timed out');
		await fast.shutdown();
	});

	it('disposes every contribution when a hook fails', async () => {
		writePlugin('bad', `
			export default {
				setup(ctx) {
					ctx.tools.register({ name: 'bad_tool', description: 'x', parameters: ctx.zod.object({}), execute: async () => ({ content: [] }) });
					ctx.settings.register({ key: 'value', type: 'string', description: 'bad setting' });
					ctx.hooks.on('tool.beforeExecute', () => { throw new Error('hook boom'); });
				},
			};
		`);
		await host.initialize(cwd);
		await host.runToolBefore({ toolName: 'any', args: {}, sessionId: 's' });
		const plugin = host.list().find((entry) => entry.id === 'bad');
		expect(plugin?.state).toBe('failed');
		expect(host.tools()).toHaveLength(0);
		expect(getAllSettings().some((setting) => setting.path.startsWith('pluginSettings.bad.'))).toBe(false);
	});

	it('times out a hung hook without blocking the caller', async () => {
		const fast = new PluginHost({ activationTimeoutMs: 200, hookTimeoutMs: 30 });
		writePlugin('hang', `
			export default {
				setup(ctx) {
					ctx.hooks.on('tool.beforeExecute', () => new Promise(() => {}));
				},
			};
		`);
		await fast.initialize(cwd);
		const started = Date.now();
		await expect(fast.runToolBefore({ toolName: 'any', args: {}, sessionId: 's' })).resolves.toEqual({});
		expect(Date.now() - started).toBeLessThan(1000);
		expect(fast.list().find((entry) => entry.id === 'hang')?.error).toContain('timed out');
		await fast.shutdown();
	});

	it('forbids plugins from replacing core services', async () => {
		writePlugin('shadow', `
			export default {
				setup(ctx) {
					ctx.provide({ id: 'spectra.tools' }, {});
				},
			};
		`);
		await host.initialize(cwd);
		const plugin = host.list().find((entry) => entry.id === 'shadow');
		expect(plugin?.state).toBe('failed');
		expect(plugin?.error).toContain('core service');
	});

	it('allows namespaced plugin services', async () => {
		writePlugin('svc', `
			export default {
				setup(ctx) {
					ctx.provide({ id: 'plugin:svc:weather' }, { temp: 20 });
					if (ctx.require({ id: 'plugin:svc:weather' }).temp !== 20) throw new Error('service missing');
				},
			};
		`);
		await host.initialize(cwd);
		expect(host.list().find((entry) => entry.id === 'svc')?.state).toBe('active');
	});

	it('rejects an entry path outside the plugin directory', async () => {
		const dir = join(cwd, '.spectra', 'plugins', 'escape');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ id: 'escape', entry: '../evil.mjs' }));
		writeFileSync(join(cwd, '.spectra', 'plugins', 'evil.mjs'), 'export default { setup() {} };');
		await host.initialize(cwd);
		const plugin = host.list().find((entry) => entry.id === 'escape');
		expect(plugin?.state).toBe('failed');
		expect(plugin?.error).toContain('escapes');
	});

	it('does not re-enable a disabled plugin on reload', async () => {
		writePlugin('sample', `
			export default {
				setup(ctx) {
					ctx.tools.register({ name: 'sample_tool', description: 'x', parameters: ctx.zod.object({}), execute: async () => ({ content: [] }) });
				},
			};
		`);
		await host.initialize(cwd);
		await host.setEnabled('sample', false);
		await host.reload('sample');
		const plugin = host.list().find((entry) => entry.id === 'sample');
		expect(plugin?.enabled).toBe(false);
		expect(plugin?.state).toBe('disabled');
		expect(host.tools()).toHaveLength(0);
	});

	it('rejects plain-object tool schemas and reserved names', async () => {
		writePlugin('plain', `
			export default {
				setup(ctx) {
					ctx.tools.register({ name: 'plain_tool', description: 'x', parameters: { type: 'object' }, execute: async () => ({ content: [] }) });
				},
			};
		`);
		await host.initialize(cwd);
		const plain = host.list().find((entry) => entry.id === 'plain');
		expect(plain?.state).toBe('failed');
		expect(plain?.error).toContain('must be a Zod schema');
	});

	it('rejects a tool name reserved by a built-in', async () => {
		host.setReservedToolNames(['shell']);
		writePlugin('reserved', `
			export default {
				setup(ctx) {
					ctx.tools.register({ name: 'shell', description: 'x', parameters: ctx.zod.object({}), execute: async () => ({ content: [] }) });
				},
			};
		`);
		await host.initialize(cwd);
		const reserved = host.list().find((entry) => entry.id === 'reserved');
		expect(reserved?.state).toBe('failed');
		expect(reserved?.error).toContain('built-in');
	});

	it('reloads a plugin without duplicating contributions', async () => {
		writePlugin('sample', `
			export default {
				setup(ctx) {
					ctx.tools.register({ name: 'sample_tool', description: 'x', parameters: ctx.zod.object({}), execute: async () => ({ content: [] }) });
				},
			};
		`);
		await host.initialize(cwd);
		await host.reload('sample');
		expect(host.tools().filter((tool) => tool.name === 'sample_tool')).toHaveLength(1);
	});
});
