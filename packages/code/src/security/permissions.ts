import type { Rule, Ruleset, PermissionAction, PermissionConfig } from './types.js';
import { matchWildcard } from './wildcard.js';

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
	const rules = rulesets.flat();
	const match = [...rules]
		.reverse()
		.find((rule: Rule) => matchWildcard(rule.permission, permission) && matchWildcard(rule.pattern, pattern));
	return match ?? { permission, pattern: '*', action: 'ask' };
}

export function fromConfig(config: PermissionConfig): Ruleset {
	const ruleset: Ruleset = [];

	for (const [key, value] of Object.entries(config)) {
		if (typeof value === 'string') {
			ruleset.push({ permission: key, pattern: '*', action: value as PermissionAction });
		} else if (typeof value === 'object' && value !== null) {
			for (const [pattern, action] of Object.entries(value as Record<string, PermissionAction>)) {
				ruleset.push({ permission: key, pattern, action });
			}
		}
	}

	return ruleset;
}

export function merge(...rulesets: Ruleset[]): Ruleset {
	return rulesets.flat();
}

const WRITE_TOOL_NAMES = ['edit', 'write', 'apply_patch'];

export function disabled(toolNames: string[], ruleset: Ruleset): Set<string> {
	const result = new Set<string>();
	for (const tool of toolNames) {
		const permission = WRITE_TOOL_NAMES.includes(tool) ? 'write' : tool;
		const rule = [...ruleset].reverse().find((r: Rule) => matchWildcard(r.permission, permission));
		if (!rule) continue;
		if (rule.pattern === '*' && rule.action === 'deny') {
			result.add(tool);
		}
	}
	return result;
}

export function getCanonicalPermission(toolName: string): string {
	return WRITE_TOOL_NAMES.includes(toolName) ? 'write' : toolName;
}
