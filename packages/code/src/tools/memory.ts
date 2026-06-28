import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import {
	addEntry,
	replaceEntry,
	removeEntry,
	readEntries,
	getMemoryUsage,
	type MemoryTarget,
} from '../services/memory.js';

const targets = ['memory', 'user', 'project'] as const;
const actions = ['add', 'replace', 'remove', 'read', 'list'] as const;

export const memoryTool: SpectraTool = {
	name: 'memory',
	capabilities: { reads: true, writes: true },
	description: `Add, replace, remove, or read persistent memory entries.
Memory is loaded into the agent's context at the start of each session.

Three scopes:
- "memory" — agent notes and cross-project knowledge (global)
- "user" — user profile and preferences (global)
- "project" — project-specific knowledge (scoped to current working directory)

Entries are bounded: memory ≤ 2200 chars, user ≤ 1375 chars, project ≤ 2200 chars.
Duplicate entries are rejected. Writes are atomic.

Use "read" to inspect entries, "list" to see usage stats, "add" to append,
"replace" to update an existing entry, "remove" to delete one.`,
	displayName: (args: { action: string; target: string }) => `${args.action} ${args.target}`,
	parameters: z.object({
		target: z.enum(targets).describe('Which memory scope to operate on'),
		action: z.enum(actions).describe('Operation: add, replace, remove, read, or list'),
		entry: z.string().optional().describe('Entry text for add/remove — the exact entry content'),
		replacement: z.string().optional().describe('New entry text for replace'),
	}),
	execute: async ({ target, action, entry, replacement }) => {
		const t = target as MemoryTarget;

		switch (action) {
			case 'read': {
				const entries = readEntries(t);
				if (entries.length === 0) return textResult(`No entries in ${target}.`);
				const usage = getMemoryUsage(t);
				return textResult(
					`${target} (${usage.used}/${usage.limit} chars, ${usage.entries} entries):\n\n${entries.join('\n\n')}`,
				);
			}

			case 'list': {
				const usage = getMemoryUsage(t);
				return textResult(
					`${target}: ${usage.entries} entries, ${usage.used}/${usage.limit} chars used.`,
				);
			}

			case 'add': {
				if (!entry) return errorResult('Missing required parameter: entry');
				const result = addEntry(t, entry);
				return result.success ? textResult(result.message) : errorResult(result.message);
			}

			case 'replace': {
				if (!entry) return errorResult('Missing required parameter: entry (the entry to replace)');
				if (!replacement) return errorResult('Missing required parameter: replacement');
				const result = replaceEntry(t, entry, replacement);
				return result.success ? textResult(result.message) : errorResult(result.message);
			}

			case 'remove': {
				if (!entry) return errorResult('Missing required parameter: entry');
				const result = removeEntry(t, entry);
				return result.success ? textResult(result.message) : errorResult(result.message);
			}

			default:
				return errorResult(`Unknown action: ${action}`);
		}
	},
};
