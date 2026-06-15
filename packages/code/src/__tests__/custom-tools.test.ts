import { describe, it, expect } from 'vitest';
import { discoverCustomToolFiles, loadCustomTool } from '../integrations/custom-tools/loader.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Custom Tools', () => {
	it('discovers tool files from project directories', () => {
		const files = discoverCustomToolFiles(process.cwd());
		expect(Array.isArray(files)).toBe(true);
	});

	it('loads a tool module with default export', async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), 'spectra-tools-'));
		const toolFile = join(tmpDir, 'greet.ts');

		writeFileSync(
			toolFile,
			`
      import { z } from "zod";
      export default {
        description: "Greet someone",
        args: { name: z.string().describe("Name to greet") },
        async execute(args: { name: string }) {
          return "Hello, " + args.name + "!";
        }
      };
    `,
		);

		try {
			const tools = await loadCustomTool(toolFile);
			expect(tools).toHaveLength(1);
			expect(tools[0].name).toBe('greet');
			expect(tools[0].description).toBe('Greet someone');
			expect(tools[0].parameters).toBeDefined();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('loads named exports as separate tools', async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), 'spectra-tools-'));
		const toolFile = join(tmpDir, 'math.ts');

		writeFileSync(
			toolFile,
			`
      import { z } from "zod";
      export const add = {
        description: "Add two numbers",
        args: { a: z.number(), b: z.number() },
        async execute(args: { a: number; b: number }) { return String(args.a + args.b); }
      };
      export const multiply = {
        description: "Multiply two numbers",
        args: { a: z.number(), b: z.number() },
        async execute(args: { a: number; b: number }) { return String(args.a * args.b); }
      };
    `,
		);

		try {
			const tools = await loadCustomTool(toolFile);
			expect(tools).toHaveLength(2);
			expect(tools[0].name).toBe('math_add');
			expect(tools[1].name).toBe('math_multiply');
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('merges into createAllToolsWithExtensions', async () => {
		const { createAllToolsWithExtensions } = await import('../tools/index.js');
		const result = await createAllToolsWithExtensions();
		expect(result.builtin).toHaveLength(7);
		expect(Array.isArray(result.custom)).toBe(true);
		expect(result.all.length).toBeGreaterThanOrEqual(7);
	});
});
