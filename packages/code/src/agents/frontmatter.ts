import type {
	AgentDiagnostic,
	AgentMode,
	AgentOutputSchema,
	AgentThinkingLevel,
} from './types.js';

export interface AgentFrontmatter {
	name?: string;
	description?: string;
	tools?: string[];
	disallowedTools?: string[];
	model?: string;
	maxTurns?: number;
	temperature?: number;
	mode?: AgentMode;
	hidden?: boolean;
	color?: string;
	thinkingLevel?: AgentThinkingLevel;
	output?: AgentOutputSchema;
	readSummarize?: boolean;
	reporting?: string;
}

export interface ParseAgentFrontmatterResult {
	frontmatter: AgentFrontmatter | null;
	body: string;
	diagnostics: AgentDiagnostic[];
}

const THINKING_LEVELS = new Set<string>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const MODES = new Set<string>(['primary', 'subagent', 'all']);

const FIELD_ALIASES: Record<string, string> = {
	name: 'name',
	description: 'description',
	tools: 'tools',
	disallowedtools: 'disallowedTools',
	'disallowed-tools': 'disallowedTools',
	disallowed_tools: 'disallowedTools',
	model: 'model',
	maxturns: 'maxTurns',
	'max-turns': 'maxTurns',
	max_turns: 'maxTurns',
	temperature: 'temperature',
	mode: 'mode',
	hidden: 'hidden',
	color: 'color',
	thinkinglevel: 'thinkingLevel',
	'thinking-level': 'thinkingLevel',
	thinking_level: 'thinkingLevel',
	output: 'output',
	readsummarize: 'readSummarize',
	'read-summarize': 'readSummarize',
	read_summarize: 'readSummarize',
	reporting: 'reporting',
};

function stripQuotes(value: string): string {
	const t = value.trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		return t.slice(1, -1);
	}
	return t;
}

function parseStringList(raw: string): string[] {
	const t = raw.trim();
	if (!t) return [];
	// JSON array
	if (t.startsWith('[')) {
		try {
			const parsed = JSON.parse(t.replace(/'/g, '"'));
			if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
		} catch {
			/* fall through */
		}
	}
	// YAML inline [a, b]
	if (t.startsWith('[') && t.endsWith(']')) {
		return t
			.slice(1, -1)
			.split(',')
			.map((s) => stripQuotes(s))
			.filter(Boolean);
	}
	// CSV
	return t
		.split(',')
		.map((s) => stripQuotes(s))
		.filter(Boolean);
}

function parseBool(raw: string): boolean | undefined {
	const t = stripQuotes(raw).toLowerCase();
	if (t === 'true' || t === 'yes' || t === '1') return true;
	if (t === 'false' || t === 'no' || t === '0') return false;
	return undefined;
}

function parseNumber(raw: string): number | undefined {
	const n = Number(stripQuotes(raw));
	return Number.isFinite(n) ? n : undefined;
}

/**
 * Minimal YAML-ish frontmatter parser for agent markdown.
 * Supports scalars, CSV lists, JSON arrays, and a nested `output:` block (indented).
 */
export function parseAgentFrontmatter(raw: string, sourcePath: string): ParseAgentFrontmatterResult {
	const diagnostics: AgentDiagnostic[] = [];
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
	if (!match) {
		return {
			frontmatter: null,
			body: raw.trim(),
			diagnostics: [
				{
					kind: 'parse',
					sourcePath,
					message: 'Agent file must start with a closed YAML frontmatter block (---)',
				},
			],
		};
	}

	const block = match[1].replace(/\r\n/g, '\n');
	const body = raw.slice(match[0].length).trim();
	const fm: AgentFrontmatter = {};
	const lines = block.split('\n');
	let i = 0;
	let invalid = false;

	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			i++;
			continue;
		}

		// Nested output: block
		if (/^output\s*:\s*$/i.test(trimmed) || /^output\s*:\s*\|?\s*$/i.test(trimmed)) {
			const nested: string[] = [];
			i++;
			while (i < lines.length) {
				const nl = lines[i];
				if (nl.trim() && !/^\s/.test(nl) && !nl.startsWith('\t')) break;
				nested.push(nl);
				i++;
			}
			const nestedText = nested.join('\n').trim();
			if (nestedText) {
				try {
					// Prefer JSON object if it looks like one; else store raw structure as { raw }
					if (nestedText.startsWith('{')) {
						fm.output = JSON.parse(nestedText) as AgentOutputSchema;
					} else {
						// Keep indented YAML as opaque string tree under _yaml for consumers
						fm.output = { _yaml: nestedText };
					}
				} catch {
					fm.output = { _yaml: nestedText };
				}
			}
			continue;
		}

		const colon = trimmed.indexOf(':');
		if (colon < 1) {
			diagnostics.push({ kind: 'parse', sourcePath, message: `Invalid frontmatter line: "${trimmed}"` });
			invalid = true;
			i++;
			continue;
		}

		const rawKey = trimmed.slice(0, colon).trim();
		const rawVal = trimmed.slice(colon + 1).trim();
		const key = FIELD_ALIASES[rawKey.toLowerCase()] ?? FIELD_ALIASES[rawKey];

		if (!key) {
			// Unknown keys ignored (Claude/Pi extras we don't model yet)
			i++;
			continue;
		}

		switch (key) {
			case 'name':
				fm.name = stripQuotes(rawVal);
				break;
			case 'description':
				fm.description = stripQuotes(rawVal);
				break;
			case 'tools':
				fm.tools = parseStringList(rawVal);
				break;
			case 'disallowedTools':
				fm.disallowedTools = parseStringList(rawVal);
				break;
			case 'model':
				fm.model = stripQuotes(rawVal);
				break;
			case 'maxTurns': {
				const n = parseNumber(rawVal);
				if (n !== undefined) fm.maxTurns = Math.max(1, Math.floor(n));
				break;
			}
			case 'temperature': {
				const n = parseNumber(rawVal);
				if (n !== undefined) fm.temperature = n;
				break;
			}
			case 'mode': {
				const m = stripQuotes(rawVal).toLowerCase();
				if (MODES.has(m)) fm.mode = m as AgentMode;
				else {
					diagnostics.push({ kind: 'validation', sourcePath, message: `Invalid mode "${rawVal}"` });
					invalid = true;
				}
				break;
			}
			case 'hidden': {
				const b = parseBool(rawVal);
				if (b !== undefined) fm.hidden = b;
				break;
			}
			case 'color':
				fm.color = stripQuotes(rawVal);
				break;
			case 'thinkingLevel': {
				const t = stripQuotes(rawVal).toLowerCase();
				if (THINKING_LEVELS.has(t)) fm.thinkingLevel = t as AgentThinkingLevel;
				else {
					diagnostics.push({
						kind: 'validation',
						sourcePath,
						message: `Invalid thinking-level "${rawVal}"`,
					});
					invalid = true;
				}
				break;
			}
			case 'output':
				if (rawVal) {
					try {
						fm.output = JSON.parse(rawVal) as AgentOutputSchema;
					} catch {
						fm.output = { value: stripQuotes(rawVal) };
					}
				}
				break;
			case 'readSummarize': {
				const b = parseBool(rawVal);
				if (b !== undefined) fm.readSummarize = b;
				break;
			}
			case 'reporting':
				fm.reporting = stripQuotes(rawVal);
				break;
		}
		i++;
	}

	if (!fm.name) {
		diagnostics.push({ kind: 'validation', sourcePath, message: 'Missing required "name" field' });
		invalid = true;
	}
	if (!fm.description) {
		diagnostics.push({ kind: 'validation', sourcePath, message: 'Missing required "description" field' });
		invalid = true;
	}
	if (fm.name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.name)) {
		diagnostics.push({
			kind: 'validation',
			sourcePath,
			message: `Invalid name "${fm.name}"; use lowercase letters, numbers, and hyphens`,
		});
		invalid = true;
	}

	if (invalid) {
		return { frontmatter: null, body, diagnostics };
	}

	return { frontmatter: fm, body, diagnostics };
}

export function parseModelRef(model: string | undefined): { id: string; provider: string } | undefined {
	if (!model?.trim()) return undefined;
	const m = model.trim();
	if (m.includes('/')) {
		const [provider, ...rest] = m.split('/');
		return { provider, id: rest.join('/') };
	}
	return { provider: 'anthropic', id: m };
}
