export { Agent } from './agent.js';
export { defineTool } from './define-tool.js';
export type {
	Skill,
	SkillMetadata,
	SkillDiscoveryOptions,
	MatchResult,
	SkillIndex,
} from './skill.js';
export {
	discoverSkills,
	getSkillDescription,
	buildAvailableSkillsBlock,
	formatSkillCatalogEntry,
	loadSkillContent,
	substituteVariables,
	buildIndex,
	matchSkills,
	getSkillIndex,
	invalidateSkillIndex,
} from './skill.js';
export { createSkillTool, createFindSkillsTool } from './tool/skill.js';
export {
	loadEvolvingSkill,
	loadAllEvolvingSkills,
	saveEvolvingSkill,
	incrementUseCount,
	findSimilarSkill,
	evolveSkill,
	forkSkill,
} from './skill-store.js';
export type { EvolvingSkillMeta } from './skill-store.js';
export { synthesizeSkill, isSessionEligibleForSynthesis } from './skill-synth.js';
export type { SessionTrace } from './skill-synth.js';
export type {
	AgentTool,
	ToolResult,
	ToolUpdateCallback,
	ToolExecutionMode,
	BeforeToolCallContext,
	AfterToolCallContext,
	BeforeToolCallResult,
	AfterToolCallResult,
	AgentEvent,
	AgentEventListener,
	AgentState,
	AgentConfig,
	RetryContext,
	RetryDecision,
} from './types.js';
export type { AssistantMessageEvent } from '@mohanscodex/spectra-ai';
