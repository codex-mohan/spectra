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

	test('rejects unsupported metadata', () => {
		const parsed = parseFrontmatter('---\ndescription: Review\nmodel: unsafe\n---\nBody', 'review.md');

		expect(parsed.frontmatter).toBeNull();
		expect(parsed.diagnostics[0]?.message).toContain('Unsupported frontmatter field');
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

	test('rejects shell interpolation syntax', () => {
		const rendered = renderTemplate('Inspect !`git status`', 'unsafe.md', {
			args: '',
			contextValues: new Map(),
			declaredProviders: [],
		});
		expect(rendered.diagnostics[0]?.message).toContain('forbidden');
	});
});

describe('template discovery and registration', () => {
	test('loads nested native templates and gives them collision priority', async () => {
		const root = await makeTempDir();
		const commandsDir = join(root, '.spectra', 'commands', 'git');
		await mkdir(commandsDir, { recursive: true });
		await writeFile(join(commandsDir, 'review.md'), '---\ndescription: Project review\n---\nReview $ARGUMENTS');
		await writeFile(join(commandsDir, 'unsafe.md'), '---\ndescription: Unsafe\n---\n!`git status`');

		const loaded = await loadTemplateDefinitions(root);
		const projectTemplate = loaded.templates.find((template) => template.name === 'git/review');
		expect(projectTemplate).toBeDefined();
		expect(loaded.templates.some((template) => template.name === 'git/unsafe')).toBe(false);
		expect(loaded.diagnostics.some((diagnostic) => diagnostic.message.includes('forbidden'))).toBe(true);

		const builtin: CommandDefinition = {
			id: 'builtin:git/review',
			name: 'git/review',
			aliases: [],
			title: 'Builtin review',
			description: 'Builtin review',
			source: 'builtin',
			execute: () => undefined,
		};
		const definitions = templatesToCommands([projectTemplate!], root);
		const registry = createRegistry([...definitions, builtin]);
		expect(registry.resolve('git/review')?.definition.source).toBe('template');
		expect(registry.resolve('git/review:2')?.definition.source).toBe('builtin');
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
