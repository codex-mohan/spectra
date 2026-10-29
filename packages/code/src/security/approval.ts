import type { Ruleset } from './types.js';
import { evaluate } from './permissions.js';

export type ApprovalTier = 'read' | 'write' | 'exec' | 'network';
export type ApprovalMode = 'always-ask' | 'write' | 'yolo';
export type ApprovalDecision = 'allow' | 'deny' | 'prompt';

export interface ApprovalInput {
	tier: ApprovalTier;
	mode: ApprovalMode;
	toolName: string;
	permission: string;
	targets: string[];
	rules: Ruleset;
	toolPolicy?: ApprovalDecision;
	/** Tool-level safety override, e.g. destructive shell patterns. */
	safety?: 'deny' | 'prompt';
	/** External paths always prompt unless a rule explicitly allows them. */
	external?: boolean;
}

export interface ApprovalResult {
	decision: ApprovalDecision;
	reason: string;
	target?: string;
}

const DEFAULT_MODE: ApprovalMode = 'write';

export function approvalModeFromConfig(value: unknown): ApprovalMode {
	return value === 'always-ask' || value === 'write' || value === 'yolo' ? value : DEFAULT_MODE;
}

export function tierAllows(mode: ApprovalMode, tier: ApprovalTier): boolean {
	if (mode === 'yolo') return true;
	if (mode === 'write') return tier === 'read' || tier === 'write';
	return tier === 'read';
}

export function decideApproval(input: ApprovalInput): ApprovalResult {
	if (input.safety === 'deny') return { decision: 'deny', reason: 'blocked by tool safety policy' };
	if (input.safety === 'prompt') return { decision: 'prompt', reason: 'tool safety policy requires confirmation' };
	if (input.toolPolicy === 'deny') return { decision: 'deny', reason: 'denied by tools.approval policy' };
	if (input.toolPolicy === 'prompt') return { decision: 'prompt', reason: 'tools.approval policy requires confirmation' };

	let unmatched: string | undefined;
	let denied: string | undefined;
	for (const target of input.targets) {
		const rule = evaluate(input.permission, target, input.rules);
		if (rule.action === 'deny') denied = target;
		else if (rule.action !== 'allow' && unmatched === undefined) unmatched = target;
	}
	if (denied) return { decision: 'deny', reason: 'matched a deny permission rule', target: denied };

	if (input.targets.length > 0 && unmatched === undefined) {
		return { decision: 'allow', reason: 'all targets allowed by permission rules' };
	}

	if (input.toolPolicy === 'allow') return { decision: 'allow', reason: 'allowed by tools.approval policy' };

	if (input.external) {
		return { decision: 'prompt', reason: 'path is outside the workspace', target: unmatched };
	}

	if (tierAllows(input.mode, input.tier)) {
		return { decision: 'allow', reason: `mode=${input.mode} auto-approves ${input.tier}` };
	}

	return { decision: 'prompt', reason: `mode=${input.mode} requires confirmation for ${input.tier}`, target: unmatched };
}
