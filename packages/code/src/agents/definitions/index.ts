import type { AgentDefinition } from '../types.js';
import { buildAgent } from './build.js';
import { planAgent } from './plan.js';
import { debugAgent } from './debug.js';
import { exploreAgent } from './explore.js';
import { generalAgent } from './general.js';
import { titleAgent } from './title.js';
import { skillSynthAgent } from './skill-synth.js';

/** Built-in agents only. Prefer loadAgentCatalog() for the full merged set. */
export const BUILTIN_AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
	[buildAgent.name]: buildAgent,
	[planAgent.name]: planAgent,
	[debugAgent.name]: debugAgent,
	[exploreAgent.name]: exploreAgent,
	[generalAgent.name]: generalAgent,
	[titleAgent.name]: titleAgent,
	[skillSynthAgent.name]: skillSynthAgent,
};
