import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseAgentFrontmatter, parseModelRef } from '../agents/frontmatter.js';
import { filterToolsByDefinition, normalizeToolName } from '../agents/tool-filter.js';
import { buildCatalogFromDefinitions } from '../agents/catalog.js';
import { loadAgentsFromDir } from '../agents/loader.js';
import { resolveAgentAccentColor } from '../tui/utils/agent-color.js';
import { c } from '../tui/tokens.js';
import { BUILTIN_AGENT_DEFINITIONS } from '../agents/definitions/index.js';
import type { AgentDefinition } from '../agents/types.js';
import type { AgentTool } from '@mohanscodex/spectra-agent';

function fakeTool(name: string): AgentTool {
	return {
		name,
		description: name,
		parameters: {} as AgentTool['parameters'],
		execute: async () => ({ content: [] }),
	};
}

describe('parseAgentFrontmatter', () => {
	it('requires name and description', () => {
		const raw = `---\nname: reviewer\n---\nbody`;
		const result = parseAgentFrontmatter(raw, 'x.md');
		expect(result.frontmatter).toBeNull();
		expect(result.diagnostics.some((d) => d.message.includes('description'))).toBe(true);
	});

	it('parses tools CSV, disallowedTools, thinking-level, read-summarize, color, mode', () => {
		const raw = `---
name: reviewer
description: Review code
tools: Read, Grep, Glob
disallowedTools: write, edit
thinking-level: high
read-summarize: true
color: blue
mode: primary
model: anthropic/claude-sonnet-4-20250514
maxTurns: 12
---

You are a reviewer.
`;
		const result = parseAgentFrontmatter(raw, 'reviewer.md');
		expect(result.frontmatter).toMatchObject({
			name: 'reviewer',
			description: 'Review code',
			tools: ['Read', 'Grep', 'Glob'],
			disallowedTools: ['write', 'edit'],
			thinkingLevel: 'high',
			readSummarize: true,
			color: 'blue',
			mode: 'primary',
			model: 'anthropic/claude-sonnet-4-20250514',
			maxTurns: 12,
		});
		expect(result.body).toContain('You are a reviewer');
		expect(parseModelRef(result.frontmatter?.model)).toEqual({
			provider: 'anthropic',
			id: 'claude-sonnet-4-20250514',
		});
	});
});

describe('filterToolsByDefinition (Claude semantics)', () => {
	const all = ['read', 'write', 'edit', 'bash', 'grep', 'glob'].map(fakeTool);

	it('omits tools => all tools', () => {
		const def: AgentDefinition = {
			name: 'build',
			mode: 'primary',
			description: 'x',
			prompt: 'p',
		};
		expect(filterToolsByDefinition(all, def).map((t) => t.name)).toEqual(all.map((t) => t.name));
	});

	it('allowlist only', () => {
		const def: AgentDefinition = {
			name: 'r',
			mode: 'subagent',
			description: 'x',
			prompt: 'p',
			tools: ['Read', 'grep'],
		};
		expect(filterToolsByDefinition(all, def).map((t) => t.name).sort()).toEqual(['grep', 'read']);
	});

	it('denylist only', () => {
		const def: AgentDefinition = {
			name: 'r',
			mode: 'primary',
			description: 'x',
			prompt: 'p',
			disallowedTools: ['write', 'edit'],
		};
		expect(filterToolsByDefinition(all, def).map((t) => t.name).sort()).toEqual(
			['bash', 'glob', 'grep', 'read'].sort(),
		);
	});

	it('allowlist then denylist', () => {
		const def: AgentDefinition = {
			name: 'r',
			mode: 'subagent',
			description: 'x',
			prompt: 'p',
			tools: ['read', 'write', 'bash'],
			disallowedTools: ['write'],
		};
		expect(filterToolsByDefinition(all, def).map((t) => t.name).sort()).toEqual(['bash', 'read']);
	});

	it('normalizes Claude aliases', () => {
		expect(normalizeToolName('Read')).toBe('read');
		expect(normalizeToolName('Bash')).toBe('bash');
		expect(normalizeToolName('Shell')).toBe('bash');
	});
});

describe('loadAgentsFromDir + catalog merge', () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('loads md agents and overrides builtins by name', async () => {
		dir = mkdtempSync(join(tmpdir(), 'spectra-agents-'));
		const agentsDir = join(dir, 'agents');
		mkdirSync(agentsDir);
		writeFileSync(
			join(agentsDir, 'explore.md'),
			`---
name: explore
description: Custom explore
tools: read, grep
color: #112233
---

Custom explore prompt.
`,
		);
		writeFileSync(
			join(agentsDir, 'reviewer.md'),
			`---
name: reviewer
description: New reviewer
mode: primary
---

Reviewer body.
`,
		);

		const loaded = await loadAgentsFromDir(agentsDir);
		expect(loaded.agents.map((a) => a.definition.name).sort()).toEqual(['explore', 'reviewer']);

		const builtins: Record<string, AgentDefinition> = {
			explore: {
				name: 'explore',
				mode: 'subagent',
				description: 'builtin',
				prompt: 'builtin prompt',
				disallowedTools: ['write'],
			},
			build: {
				name: 'build',
				mode: 'primary',
				description: 'build',
				prompt: 'build',
			},
		};
		for (const { definition } of loaded.agents) {
			const existing = builtins[definition.name];
			builtins[definition.name] = existing
				? { ...existing, ...definition, prompt: definition.prompt.trim() ? definition.prompt : existing.prompt }
				: definition;
		}
		const catalog = buildCatalogFromDefinitions(builtins);
		expect(catalog.definitions.explore.description).toBe('Custom explore');
		expect(catalog.definitions.explore.prompt).toContain('Custom explore prompt');
		expect(catalog.definitions.reviewer.mode).toBe('primary');
		expect(catalog.primary).toContain('reviewer');
		expect(catalog.primary).toContain('build');
	});
});

describe('resolveAgentAccentColor', () => {
	it('accepts hex and theme-backed named colors', () => {
		expect(resolveAgentAccentColor('#112233')).toBe('#112233');
		expect(resolveAgentAccentColor('blue')).toBe(c.blue);
		expect(resolveAgentAccentColor('red')).toBe(c.red);
		expect(resolveAgentAccentColor('accent')).toBe(c.accent);
		expect(resolveAgentAccentColor(undefined, '#abcdef')).toBe('#abcdef');
	});

	it('maps builtin agents to theme palette names', () => {
		expect(BUILTIN_AGENT_DEFINITIONS.build?.color).toBe('accent');
		expect(BUILTIN_AGENT_DEFINITIONS.plan?.color).toBe('orange');
		expect(BUILTIN_AGENT_DEFINITIONS.debug?.color).toBe('green');
		expect(BUILTIN_AGENT_DEFINITIONS.explore?.color).toBe('purple');
		expect(BUILTIN_AGENT_DEFINITIONS.general?.color).toBe('blue');
		expect(BUILTIN_AGENT_DEFINITIONS.title?.color).toBeUndefined();
		expect(BUILTIN_AGENT_DEFINITIONS['skill-synth']?.color).toBeUndefined();
		expect(resolveAgentAccentColor(BUILTIN_AGENT_DEFINITIONS.plan?.color)).toBe(c.orange);
	});
});
