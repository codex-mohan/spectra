import { readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { z } from 'zod';
import { defineTool } from '@mohanscodex/spectra-agent';
import type { AgentTool, ToolResult } from '@mohanscodex/spectra-agent';
import { getGlobalConfigDir, discoverConfigDirs } from '../../utils/paths.js';

export interface CustomToolModule {
	description: string;
	args?: Record<string, z.ZodType>;
	execute: (args: Record<string, unknown>, context: CustomToolContext) => Promise<string | ToolResult>;
}

export interface CustomToolContext {
	directory: string;
	worktree: string;
	signal?: AbortSignal;
}

function findToolDirs(startDir: string): string[] {
	const dirs: string[] = [];

	const configDirs = discoverConfigDirs(startDir);
	for (const d of configDirs) {
		const toolsDir = join(d.path, 'tools');
		if (existsSync(toolsDir) && statSync(toolsDir).isDirectory()) {
			dirs.push(toolsDir);
		}
	}

	const globalDir = getGlobalConfigDir();
	const globalTools = join(globalDir, 'tools');
	if (existsSync(globalTools) && statSync(globalTools).isDirectory()) {
		if (!dirs.includes(globalTools)) {
			dirs.push(globalTools);
		}
	}

	return dirs;
}

export function discoverCustomToolFiles(startDir: string): string[] {
	const files: string[] = [];
	const seen = new Set<string>();

	for (const toolsDir of findToolDirs(startDir)) {
		for (const entry of readdirSync(toolsDir)) {
			if (!entry.endsWith('.ts') && !entry.endsWith('.js')) continue;
			const fullPath = join(toolsDir, entry);
			if (seen.has(fullPath)) continue;
			seen.add(fullPath);
			files.push(fullPath);
		}
	}

	return files;
}

export async function loadCustomTool(filePath: string): Promise<AgentTool[]> {
	const mod = await import(resolve(filePath));
	const tools: AgentTool[] = [];

	const baseName = filePath
		.split(/[\\/]/)
		.pop()!
		.replace(/\.(ts|js)$/, '');

	if (mod.default && typeof mod.default.execute === 'function') {
		tools.push(buildTool(baseName, mod.default));
	}

	for (const [key, value] of Object.entries(mod)) {
		if (key === 'default') continue;
		const exp = value as Partial<CustomToolModule>;
		if (exp && typeof exp.execute === 'function' && typeof exp.description === 'string') {
			tools.push(buildTool(`${baseName}_${key}`, exp as CustomToolModule));
		}
	}

	return tools;
}

function buildTool(name: string, def: CustomToolModule): AgentTool {
	const parameters = def.args && Object.keys(def.args).length > 0 ? z.object(def.args) : z.object({});

	return defineTool({
		name,
		description: def.description,
		parameters,
		execute: async (args, ctx) => {
			const result = await def.execute(args, {
				directory: process.cwd(),
				worktree: process.cwd(),
				signal: ctx.signal,
			});

			if (typeof result === 'string') {
				return { content: [{ type: 'text', text: result }] } as ToolResult;
			}
			if (result && Array.isArray(result.content)) {
				return result as ToolResult;
			}
			return { content: [{ type: 'text', text: JSON.stringify(result) }] } as ToolResult;
		},
	});
}

export async function loadCustomTools(startDir: string): Promise<AgentTool[]> {
	const files = discoverCustomToolFiles(startDir);
	const all: AgentTool[] = [];

	for (const file of files) {
		try {
			const tools = await loadCustomTool(file);
			all.push(...tools);
		} catch (err) {
			console.error(`Failed to load custom tool "${file}":`, err instanceof Error ? err.message : String(err));
		}
	}

	return all;
}
