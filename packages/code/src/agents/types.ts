export interface AgentDefinition {
	name: string;
	mode: 'primary' | 'subagent';
	description: string;
	blockedTools: string[];
	maxTurns: number;
	temperature?: number;
	prompt: string;
}
