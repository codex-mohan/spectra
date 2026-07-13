import { readdir, readFile, stat } from 'fs/promises';
import { join, normalize, relative, resolve } from 'path';
import { homedir } from 'os';
import { getGlobalConfigDir } from '../utils/paths.js';
import { parseAgentFrontmatter, parseModelRef } from './frontmatter.js';
import type { AgentDefinition, AgentDiagnostic } from './types.js';

export interface LoadedAgentFile {
	definition: AgentDefinition;
	sourcePath: string;
}

export interface LoadAgentsFromDirsResult {
	agents: LoadedAgentFile[];
	diagnostics: AgentDiagnostic[];
}

function pathKey(value: string): string {
	const key = normalize(value);
	return process.platform === 'win32' ? key.toLowerCase() : key;
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			const nested = await collectMarkdownFiles(full);
			out.push(...nested);
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
			out.push(full);
		}
	}
	return out;
}

function ancestorBases(startDir: string): string[] {
	const dirs: string[] = [];
	const home = resolve(homedir());
	let current = resolve(startDir);
	while (true) {
		dirs.push(current);
		if (current === home) break;
		const parent = resolve(current, '..');
		if (parent === current) break;
		current = parent;
	}
	return dirs;
}

/**
 * Discovery order (low → high priority for later merge):
 * 1. ~/.spectra/agents
 * 2. .spectra/agents from root → cwd
 * 3. .claude/agents from root → cwd
 */
export function discoverAgentDirs(cwd: string): string[] {
	const dirs: string[] = [];
	const seen = new Set<string>();
	const push = (p: string) => {
		const key = pathKey(p);
		if (seen.has(key)) return;
		seen.add(key);
		dirs.push(p);
	};

	push(join(getGlobalConfigDir(), 'agents'));

	const bases = ancestorBases(cwd);
	for (const base of bases) {
		push(join(base, '.spectra', 'agents'));
	}
	for (const base of bases) {
		push(join(base, '.claude', 'agents'));
	}
	return dirs;
}

export async function loadAgentsFromDir(dir: string): Promise<LoadAgentsFromDirsResult> {
	const diagnostics: AgentDiagnostic[] = [];
	const agents: LoadedAgentFile[] = [];
	const files = await collectMarkdownFiles(dir);

	for (const filePath of files) {
		let raw: string;
		try {
			const st = await stat(filePath);
			if (!st.isFile()) continue;
			raw = await readFile(filePath, 'utf-8');
		} catch {
			continue;
		}

		const { frontmatter, body, diagnostics: diags } = parseAgentFrontmatter(raw, filePath);
		diagnostics.push(...diags);
		if (!frontmatter?.name || !frontmatter.description) continue;

		const definition: AgentDefinition = {
			name: frontmatter.name,
			mode: frontmatter.mode ?? 'subagent',
			description: frontmatter.description,
			tools: frontmatter.tools,
			disallowedTools: frontmatter.disallowedTools,
			maxTurns: frontmatter.maxTurns,
			temperature: frontmatter.temperature,
			prompt: body,
			reporting: frontmatter.reporting,
			hidden: frontmatter.hidden,
			color: frontmatter.color,
			model: parseModelRef(frontmatter.model),
			thinkingLevel: frontmatter.thinkingLevel,
			output: frontmatter.output,
			readSummarize: frontmatter.readSummarize,
			source: filePath,
		};
		agents.push({ definition, sourcePath: filePath });
	}

	return { agents, diagnostics };
}

export async function loadDiscoveredAgents(cwd: string): Promise<LoadAgentsFromDirsResult> {
	const diagnostics: AgentDiagnostic[] = [];
	const byName = new Map<string, LoadedAgentFile>();

	for (const dir of discoverAgentDirs(cwd)) {
		const result = await loadAgentsFromDir(dir);
		diagnostics.push(...result.diagnostics);
		for (const agent of result.agents) {
			// Later dirs (project / nearest) override earlier (user)
			byName.set(agent.definition.name, agent);
		}
	}

	return { agents: [...byName.values()], diagnostics };
}

/** Derive agent name from path relative to agents root (fallback if needed). */
export function agentNameFromPath(filePath: string, agentsRoot: string): string {
	const rel = relative(agentsRoot, filePath).replace(/\\/g, '/');
	return rel.replace(/\.md$/i, '');
}
