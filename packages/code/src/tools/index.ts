import type { SpectraTool } from './types.js';
import { shellTool } from './shell.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { webFetchTool } from './web-fetch.js';
import { memoryTool } from './memory.js';
import { createTaskTool } from './task.js';
import { createTodoTool } from './todo.js';
import type { AgentTool, ToolResult } from '@mohanscodex/spectra-agent';
import { defineTool, createSkillTool, createFindSkillsTool } from '@mohanscodex/spectra-agent';
import type { Skill } from '@mohanscodex/spectra-agent';
import { textResult } from './utils.js';
import { listConnectedServers } from '../integrations/mcp/index.js';
import { createMcpAgentTools } from './mcp-tool.js';
import { loadCustomTools } from '../integrations/custom-tools/index.js';
import type { SecurityManager } from '../security/index.js';
import { PermissionDeniedError } from '../security/index.js';
import type { AgentRegistryConfig } from '../agents/registry.js';
import { incrementUseCount, getEvolvingSkillId } from '../services/skill-store.js';
import { loadAllSkills } from '../services/skill-catalog.js';
import type { SessionStore } from '../services/session-store.js';
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
	memoryTool,
];

const FILE_TOOL_NAMES = new Set(['read', 'write', 'edit', 'grep', 'glob', 'bash', 'shell']);
const SKIP_PERMISSION_CHECK = new Set(['todo', 'memory', 'task', 'web_fetch', 'webfetch']);

function wrapExecute(tool: SpectraTool, security: SecurityManager): SpectraTool['execute'] {
	const tracker = security.getReadTracker();
	const doomLoop = security.getDoomLoop();

	return async (args, ctx) => {
		const loopResult = doomLoop.recordToolCall(tool.name, args);
		if (!loopResult.ok) {
			return { content: [{ type: 'text', text: loopResult.message }], isError: true };
		}

		const patterns = security.extractToolPatterns(tool.name, args);

		if (SKIP_PERMISSION_CHECK.has(tool.name)) {
			// Session-local state tools do not touch the filesystem, shell, network, or external resources.
		} else if (FILE_TOOL_NAMES.has(tool.name)) {
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
		if (!loopCheck.ok && loopCheck.action === 'warn') {
			security.warn(loopCheck.message);
		}
		if (!loopCheck.ok && loopCheck.action === 'stop') {
			return { content: [{ type: 'text', text: loopCheck.message }], isError: true };
		}

		if (tool.name === 'edit' || tool.name === 'patch') {
			if (toolOk) {
				for (const pathPattern of patterns.pathPatterns) {
					doomLoop.recordPatchSuccess(pathPattern);
				}
			} else {
				for (const pathPattern of patterns.pathPatterns) {
					const spiralResult = doomLoop.recordPatchFailure(pathPattern);
					if (!spiralResult.ok && spiralResult.action === 'warn') {
						security.warn(spiralResult.message);
					}
					if (!spiralResult.ok && spiralResult.action === 'stop') {
						return { content: [{ type: 'text', text: spiralResult.message }], isError: true };
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

export function createAllToolsWithSecurity(
	security: SecurityManager,
	config?: AgentRegistryConfig,
	sessionStore?: SessionStore,
	parentSessionId?: string,
): AgentTool[] {
	const tools = [...builtinTools, createTodoTool(sessionStore, parentSessionId)].map((t) => spectraToolToAgentTool(t, security));
	if (config) {
		tools.push(spectraToolToAgentTool(createTaskTool(config, security, sessionStore, parentSessionId), security));
	}
	return tools;
}

export async function discoverAndCreateSkillTools(): Promise<{
	skills: Map<string, Skill>;
	tools: AgentTool[];
}> {
	const skills = await loadAllSkills();

	const tools: AgentTool[] = [];
	if (skills.size > 0) {
		const skillTool = createSkillTool(skills);
		const executeSkill = skillTool.execute;
		skillTool.execute = async (toolCallId, args) => {
			const result = await executeSkill(toolCallId, args);
			if (!result.isError && typeof args.name === 'string') {
				const usedSkill = skills.get(args.name);
				if (usedSkill) {
					const evolvingSkillId = getEvolvingSkillId(usedSkill);
					if (evolvingSkillId) incrementUseCount(evolvingSkillId).catch(() => {});
				}
			}
			return result;
		};
		tools.push(createFindSkillsTool(skills), skillTool);
	}
	return { skills, tools };
}

export function getToolDisplayName(tool: SpectraTool, args: unknown, result?: ToolResult): string {
	if (!tool.displayName) return tool.name;
	if (typeof tool.displayName === 'string') return tool.displayName;
	return tool.displayName(args, result as ToolResult);
}
