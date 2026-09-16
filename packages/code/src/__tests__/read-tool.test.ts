import type { ToolResult } from '@mohanscodex/spectra-agent';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createReadTool } from '../tools/read.js';
import { spectraToolToAgentTool } from '../tools/index.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(process.cwd(), '.spectra-read-test-'));
	temporaryDirectories.push(directory);
	return directory;
}

function resultText(result: ToolResult): string {
	const block = result.content[0];
	return block && block.type === 'text' ? block.text : '';
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('unified read tool', () => {
	it('serializes positive line bounds without OpenAPI boolean exclusivity', () => {
		const tool = createReadTool();
		const schema = spectraToolToAgentTool(tool).parameters;
		expect(schema).toMatchObject({
			properties: {
				offset: { type: 'integer', minimum: 1 },
				limit: { type: 'integer', minimum: 1 },
			},
		});
		expect(JSON.stringify(schema)).not.toContain('exclusiveMinimum');
		for (const field of ['offset', 'limit']) {
			for (const value of [0, -1, 1.5, true]) {
				expect(tool.parameters.safeParse({ path: 'sample.txt', [field]: value }).success).toBe(false);
			}
			expect(tool.parameters.safeParse({ path: 'sample.txt', [field]: 1 }).success).toBe(true);
		}
		expect(tool.parameters.safeParse({ path: 'sample.txt' }).success).toBe(true);
	});

	it('applies the same line selector to files and protocol resources', async () => {
		const cwd = await temporaryDirectory();
		await fs.writeFile(path.join(cwd, 'sample.txt'), 'one\ntwo\nthree\nfour');
		const tool = createReadTool({
			cwd,
			rules: new Map([['sample', { name: 'sample', content: 'one\ntwo\nthree\nfour' }]]),
		});

		const fileResult = await tool.execute({ path: 'sample.txt:2-3' }, { toolCallId: 'file' });
		const ruleResult = await tool.execute({ path: 'rule://sample:2-3' }, { toolCallId: 'rule' });

		expect(resultText(fileResult)).toContain('2:two\n3:three');
		expect(resultText(ruleResult)).toContain('2:two\n3:three');
	});

	it('extracts only unresolved merge conflict blocks', async () => {
		const cwd = await temporaryDirectory();
		await fs.writeFile(path.join(cwd, 'conflict.txt'), 'before\n<<<<<<< ours\na\n=======\nb\n>>>>>>> theirs\nafter');
		const result = await createReadTool({ cwd }).execute({ path: 'conflict.txt:conflicts' }, { toolCallId: 'conflicts' });
		const text = resultText(result);
		expect(text).toContain('<<<<<<< ours');
		expect(text).toContain('>>>>>>> theirs');
		expect(text).not.toContain('   1 | before');
		expect(text).not.toContain('   7 | after');
	});

	it('spills large results to a recoverable artifact URI', async () => {
		const cwd = await temporaryDirectory();
		const content = Array.from({ length: 30_000 }, (_, index) => `line-${index}`).join('\n');
		await fs.writeFile(path.join(cwd, 'large.txt'), content);
		const tool = createReadTool({ cwd });
		const largeResult = await tool.execute({ path: 'large.txt' }, { toolCallId: 'large' });
		const largeText = resultText(largeResult);
		const artifactUri = /artifact:\/\/\d+/.exec(largeText)?.[0];
		expect(artifactUri).toBeDefined();

		const recovered = await tool.execute({ path: `${artifactUri}:29999-30000` }, { toolCallId: 'artifact' });
		expect(resultText(recovered)).toContain('29999:line-29998');
		expect(resultText(recovered)).toContain('30000:line-29999');
	});

	it('reads raw resource content without line prefixes', async () => {
		const cwd = await temporaryDirectory();
		const result = await createReadTool({
			cwd,
			rules: new Map([['raw', { name: 'raw', content: 'alpha\nbeta' }]]),
		}).execute({ path: 'rule://raw:raw' }, { toolCallId: 'raw' });
		const text = resultText(result);
		expect(text).toContain('alpha\nbeta');
		expect(text).not.toContain('   1 | alpha');
	});

	it('returns image content alongside the text note', async () => {
		const cwd = await temporaryDirectory();
		const png = Buffer.from('89504e470d0a1a0a', 'hex');
		await fs.writeFile(path.join(cwd, 'shot.png'), png);

		const result = await createReadTool({ cwd }).execute({ path: 'shot.png' }, { toolCallId: 'image' });

		expect(result.isError).toBeFalsy();
		expect(resultText(result)).toBe('Read image file [image/png] (8 bytes)');
		expect(result.content[1]).toEqual({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
	});

	it('reports a missing image as a file-not-found error', async () => {
		const cwd = await temporaryDirectory();
		const result = await createReadTool({ cwd }).execute({ path: 'missing.png' }, { toolCallId: 'missing' });

		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain('File not found');
	});

	it('rejects a directory whose name looks like an image', async () => {
		const cwd = await temporaryDirectory();
		await fs.mkdir(path.join(cwd, 'assets.png'));

		const result = await createReadTool({ cwd }).execute({ path: 'assets.png' }, { toolCallId: 'directory' });

		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain('Not a regular file');
	});
});
