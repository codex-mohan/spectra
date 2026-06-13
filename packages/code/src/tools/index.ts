import type { SpectraTool } from './types.js';
import { shellTool } from './shell.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { webFetchTool } from './web-fetch.js';
import { taskTool } from './task.js';
import type { AgentTool, ToolResult } from '@mohanscodex/spectra-agent';
import { defineTool, discoverSkills, createSkillTool, createFindSkillsTool, loadAllEvolvingSkills, incrementUseCount } from '@mohanscodex/spectra-agent';
import type { Skill } from '@mohanscodex/spectra-agent';
import { textResult } from './utils.js';
import { listConnectedServers } from '../integrations/mcp/index.js';
import { createMcpAgentTools } from './mcp-tool.js';
import { loadCustomTools } from '../integrations/custom-tools/index.js';
import type { SecurityManager } from '../security/index.js';
import { PermissionDeniedError } from '../security/index.js';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export { type SpectraTool } from './types.js';

export const builtinTools: SpectraTool[] = [
	shellTool,
	readTool,
	writeTool,
	editTool,
	grepTool,
	globTool,
	webFetchTool,
	taskTool,
];

const FILE_TOOL_NAMES = new Set(['read', 'write', 'edit', 'grep', 'glob', 'bash', 'shell']);

function wrapExecute(tool: SpectraTool, security: SecurityManager): SpectraTool['execute'] {
	const tracker = security.getReadTracker();
	const doomLoop = security.getDoomLoop();

	return async (args, ctx) => {
		const loopResult = doomLoop.recordToolCall(tool.name, args);
		if (!loopResult.ok) {
			return { content: [{ type: 'text', text: loopResult.message }], isError: true };
		}

		const patterns = security.extractToolPatterns(tool.name, args);

		if (FILE_TOOL_NAMES.has(tool.name)) {
			for (const extPath of patterns.externalPaths) {
				try {
					await security.checkPermission('external_directory', [extPath], tool.name, extPath);
				} catch (err) {
					if (err instanceof PermissionDeniedError) {
						return {
							content: [{ type: 'text', text: `External file access denied: ${err.message}` }],
							isError: true,
						};
					}
					throw err;
				}
			}
		} else {
			try {
				await security.checkPermission(tool.name, patterns.toolPatterns, tool.name, patterns.toolPatterns[0]);
			} catch (err) {
				if (err instanceof PermissionDeniedError) {
					return { content: [{ type: 'text', text: `Permission denied: ${err.message}` }], isError: true };
				}
				throw err;
			}
		}

		for (const pathPattern of patterns.pathPatterns) {
			try {
				security.checkPath(pathPattern);
			} catch (err) {
				if (err instanceof PermissionDeniedError) {
					return { content: [{ type: 'text', text: `Path safety blocked: ${pathPattern}` }], isError: true };
				}
				throw err;
			}
		}

		const caps = tool.capabilities ?? { reads: false, writes: false };
		for (const pathPattern of patterns.pathPatterns) {
			if (caps.writes) {
				const guard = tracker.checkWrite(pathPattern, process.cwd(), tool.name);
				if (!guard.ok) {
					return { content: [{ type: 'text', text: guard.reason }], isError: true };
				}
			}
		}

		if (tool.name === 'web_fetch' || tool.name === 'webfetch') {
			const url = (args as Record<string, unknown>).url as string | undefined;
			if (url) {
				const ssrfResult = security.getSsrfGuard().check(url);
				if (!ssrfResult.ok) {
					return { content: [{ type: 'text', text: `SSRF guard: ${ssrfResult.reason}` }], isError: true };
				}
			}
		}

		const result = await tool.execute(args, ctx);

		const toolOk = result.isError !== true;
		const loopCheck = doomLoop.recordToolResult(tool.name, toolOk);
		if (!loopCheck.ok) {
			const firstContent = result.content?.[0];
			const existingContent = firstContent?.type === 'text' ? firstContent.text : '';
			return {
				content: [
					{ type: 'text', text: `${existingContent}\n\n<system-reminder>${loopCheck.message}</system-reminder>` },
				],
				isError: result.isError,
				details: result.details,
			};
		}

		if (tool.name === 'edit' || tool.name === 'patch') {
			if (toolOk) {
				for (const pathPattern of patterns.pathPatterns) {
					doomLoop.recordPatchSuccess(pathPattern);
				}
			} else {
				for (const pathPattern of patterns.pathPatterns) {
					const spiralResult = doomLoop.recordPatchFailure(pathPattern);
					if (!spiralResult.ok) {
						const firstContent = result.content?.[0];
						const text = firstContent?.type === 'text' ? firstContent.text : '';
						if (text) {
							return {
								content: [
									{
										type: 'text',
										text: `${text}\n\n<system-reminder>${spiralResult.message}</system-reminder>`,
									},
								],
								isError: result.isError,
								details: result.details,
							};
						}
					}
				}
			}
		}

		for (const pathPattern of patterns.pathPatterns) {
			if (caps.reads) {
				tracker.recordRead(pathPattern, process.cwd());
			}
			if (caps.writes && toolOk) {
				tracker.recordWrite(pathPattern, process.cwd());
			}
		}

		return result;
	};
}

export function spectraToolToAgentTool(specTool: SpectraTool, security?: SecurityManager): AgentTool {
	const execute = security ? wrapExecute(specTool, security) : specTool.execute;

	return defineTool({
		name: specTool.name,
		label: typeof specTool.displayName === 'string' ? specTool.displayName : undefined,
		description: specTool.description,
		parameters: specTool.parameters,
		promptGuidelines: specTool.promptGuidelines,
		execute: async (args, ctx) => {
			return execute(args, ctx);
		},
	});
}

export function createAllTools(): SpectraTool[] {
	return [...builtinTools];
}

export async function createAllToolsWithMcp(): Promise<{
	builtin: AgentTool[];
	mcp: AgentTool[];
	all: AgentTool[];
}> {
	const builtin = builtinTools.map((t) => spectraToolToAgentTool(t));

	const connected = listConnectedServers();
	const mcp: AgentTool[] = [];
	for (const server of connected) {
		if (server.tools.length > 0) {
			mcp.push(...createMcpAgentTools(server.name, server.tools));
		}
	}

	return {
		builtin,
		mcp,
		all: [...builtin, ...mcp],
	};
}

export function getToolStats(): { builtin: number; mcp: number; total: number } {
	const connected = listConnectedServers();
	const mcpCount = connected.reduce((sum, s) => sum + s.tools.length, 0);
	return {
		builtin: builtinTools.length,
		mcp: mcpCount,
		total: builtinTools.length + mcpCount,
	};
}

export async function createAllToolsWithExtensions(): Promise<{
	builtin: AgentTool[];
	mcp: AgentTool[];
	custom: AgentTool[];
	all: AgentTool[];
}> {
	const builtin = builtinTools.map((t) => spectraToolToAgentTool(t));

	const connected = listConnectedServers();
	const mcp: AgentTool[] = [];
	for (const server of connected) {
		if (server.tools.length > 0) {
			mcp.push(...createMcpAgentTools(server.name, server.tools));
		}
	}

	const custom = await loadCustomTools(process.cwd());

	return {
		builtin,
		mcp,
		custom,
		all: [...builtin, ...mcp, ...custom],
	};
}

export function createAllToolsWithSecurity(security: SecurityManager): AgentTool[] {
	return builtinTools.map((t) => spectraToolToAgentTool(t, security));
}

export async function discoverAndCreateSkillTools(): Promise<{
	skills: Map<string, Skill>;
	tools: AgentTool[];
}> {
	// Resolve bundled skills directory relative to this package
	const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
	const bundledSkillsDir = resolve(packageRoot, 'skills');

	// 1. Load bundled skills (lowest precedence)
	const bundled = await discoverSkills({ customPaths: [bundledSkillsDir] });

	// 2. Load evolving/learned skills (middle precedence)
	const evolving = await loadAllEvolvingSkills();
	const evolvingMap = new Map<string, Skill>();
	for (const skill of evolving) evolvingMap.set(skill.name, skill);

	// 3. Load user/project skills (highest precedence)
	const user = await discoverSkills();

	// 4. Merge: bundled → evolving → user (user wins on collision)
	const skills = new Map<string, Skill>();
	for (const [name, skill] of bundled) skills.set(name, skill);
	for (const [name, skill] of evolvingMap) skills.set(name, skill);
	for (const [name, skill] of user) skills.set(name, skill);

	const tools: AgentTool[] = [];
	if (skills.size > 0) {
		tools.push(createFindSkillsTool(skills), createSkillTool(skills));
	}
	return { skills, tools };
}

export function getToolDisplayName(tool: SpectraTool, args: unknown, result?: ToolResult): string {
	if (!tool.displayName) return tool.name;
	if (typeof tool.displayName === 'string') return tool.displayName;
	return tool.displayName(args, result as ToolResult);
}
