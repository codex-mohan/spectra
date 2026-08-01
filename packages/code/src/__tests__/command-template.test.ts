import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';
import {
	gatherContext,
	loadTemplateDefinitions,
	parseFrontmatter,
	renderTemplate,
	templatesToCommands,
} from '../command/index.js';
import { createRegistry } from '../command/registry.js';
import type { CommandDefinition } from '../command/types.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'spectra-command-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('template frontmatter', () => {
	test('parses CRLF input without shifting the body', () => {
		const raw = '---\r\ndescription: Review changes\r\ncontext:\r\n  - git.diff\r\n---\r\nBody $ARGUMENTS';
		const parsed = parseFrontmatter(raw, 'review.md');

		expect(parsed.frontmatter).toEqual({ description: 'Review changes', contextProviders: ['git.diff'] });
		expect(raw.slice(parsed.bodyOffset)).toBe('Body $ARGUMENTS');
	});

	test('accepts Claude-compatible metadata', () => {
		const parsed = parseFrontmatter('---\ndescription: Review\nmodel: unsafe\nagent: audit\nsubtask: true\n---\nBody', 'review.md');

		expect(parsed.frontmatter).toEqual({
			description: 'Review', contextProviders: [], model: 'unsafe', agent: 'audit', subtask: true,
		});
	});
});

describe('template rendering', () => {
	test('renders raw, positional, and declared context placeholders', () => {
		const rendered = renderTemplate(
			'First=$1 Tenth=$10 All=$ARGUMENTS\n{{context.git.status}}',
			'review.md',
			{
				args: 'one two three four five six seven eight nine ten',
				contextValues: new Map([['git.status', 'M src/app.ts']]),
				declaredProviders: ['git.status'],
			},
		);

		expect(rendered.diagnostics).toEqual([]);
		expect(rendered.text).toContain('First=one Tenth=ten');
		expect(rendered.text).toContain('All=one two three four five six seven eight nine ten');
		expect(rendered.text).toContain('M src/app.ts');
	});

	test('leaves shell interpolation for execution', () => {
		const rendered = renderTemplate('Inspect !`git status`', 'unsafe.md', {
			args: '',
			contextValues: new Map(),
			declaredProviders: [],
		});
		expect(rendered.diagnostics).toEqual([]);
		expect(rendered.text).toContain('!`git status`');
	});
});

describe('template discovery and registration', () => {
	test('loads native and Claude-compatible templates with their source dialect', async () => {
		const root = await makeTempDir();
		const spectraCommands = join(root, '.spectra', 'commands', 'git');
		const claudeCommands = join(root, '.claude', 'commands');
		await mkdir(spectraCommands, { recursive: true });
		await mkdir(claudeCommands, { recursive: true });
		await writeFile(join(spectraCommands, 'review.md'), '---\ndescription: Project review\n---\nReview $ARGUMENTS');
		await writeFile(join(claudeCommands, 'inspect.md'), '---\nmodel: unsafe\n---\nInspect $0 and $1');

		const loaded = await loadTemplateDefinitions(root);
		const projectTemplate = loaded.templates.find((template) => template.name === 'git/review');
		const claudeTemplate = loaded.templates.find((template) => template.name === 'inspect');
		expect(projectTemplate?.dialect).toBe('spectra');
		expect(claudeTemplate?.dialect).toBe('claude');
		expect(claudeTemplate?.description).toBe('inspect');
		expect(loaded.diagnostics).toEqual([]);

		const definitions = templatesToCommands([claudeTemplate!], root);
		const action = await definitions[0]!.execute({ source: 'slash', args: 'one two', invocation: 'inspect' });
		expect(action).toEqual({ type: 'submit_prompt', text: 'Inspect one and two' });

		const builtin: CommandDefinition = {
			id: 'builtin:git/review', name: 'git/review', aliases: [], title: 'Builtin review',
			description: 'Builtin review', source: 'builtin', execute: () => undefined,
		};
		const registry = createRegistry([...templatesToCommands([projectTemplate!], root), builtin]);
		expect(registry.resolve('git/review')?.definition.source).toBe('template');
		expect(registry.resolve('git/review:2')?.definition.source).toBe('builtin');
	});

	test('executes declared shell interpolation when enabled', async () => {
		const root = await makeTempDir();
		const commandsDir = join(root, '.spectra', 'commands');
		await mkdir(commandsDir, { recursive: true });
		const command = process.platform === 'win32' ? 'Write-Output shell-ok' : 'printf shell-ok';
		await writeFile(join(commandsDir, 'shell.md'), `---\ndescription: Shell\n---\nResult: !\`${command}\``);

		const loaded = await loadTemplateDefinitions(root);
		const definition = templatesToCommands(loaded.templates, root)[0]!;
		await expect(definition.execute({ source: 'slash', args: '', invocation: 'shell' }))
			.resolves.toEqual({ type: 'submit_prompt', text: 'Result: shell-ok' });
	});

	test('rejects shell interpolation when disabled', async () => {
		const root = await makeTempDir();
		const commandsDir = join(root, '.spectra', 'commands');
		await mkdir(commandsDir, { recursive: true });
		await writeFile(join(commandsDir, 'shell.md'), '---\ndescription: Shell\n---\nResult: !`echo shell-ok`');

		const loaded = await loadTemplateDefinitions(root, { shellExecution: false });
		const definition = templatesToCommands(loaded.templates, root, { shellExecution: false })[0]!;
		const result = await definition.execute({ source: 'slash', args: '', invocation: 'shell' });
		expect(result).toMatchObject([{ type: 'show_toast', variant: 'error' }]);
	});
});

describe('template context providers', () => {
	test('collects bounded Git status and diff with fixed arguments', async () => {
		const root = await makeTempDir();
		await execFileAsync('git', ['init'], { cwd: root });
		await execFileAsync('git', ['config', 'user.email', 'spectra@example.test'], { cwd: root });
		await execFileAsync('git', ['config', 'user.name', 'Spectra Test'], { cwd: root });
		await writeFile(join(root, 'file.txt'), 'before\n');
		await execFileAsync('git', ['add', 'file.txt'], { cwd: root });
		await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
		await writeFile(join(root, 'file.txt'), 'after\n');

		const gathered = await gatherContext(['git.status', 'git.diff'], root, 'review.md');
		expect(gathered.diagnostics).toEqual([]);
		expect(gathered.values.get('git.status')).toContain('file.txt');
		expect(gathered.values.get('git.diff')).toContain('-before');
		expect(gathered.values.get('git.diff')).toContain('+after');
	});
});
