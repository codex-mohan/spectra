import type { AgentDefinition } from '../types.js';
import { buildAgent } from './build.js';
import { planAgent } from './plan.js';
import { debugAgent } from './debug.js';
import { exploreAgent } from './explore.js';

export const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
	[buildAgent.name]: buildAgent,
	[planAgent.name]: planAgent,
	[debugAgent.name]: debugAgent,
	[exploreAgent.name]: exploreAgent,
};

export const PRIMARY_AGENTS = Object.values(AGENT_DEFINITIONS)
	.filter((d) => d.mode === 'primary')
	.map((d) => d.name);

export const SUBAGENTS = Object.values(AGENT_DEFINITIONS)
	.filter((d) => d.mode === 'subagent')
	.map((d) => d.name);
