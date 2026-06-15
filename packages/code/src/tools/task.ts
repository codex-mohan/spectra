import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { textResult, errorResult } from './utils.js';
import { AGENT_DEFINITIONS, SUBAGENTS, filterToolsByAgent } from '../agents/index.js';
import type { AgentRegistryConfig } from '../agents/registry.js';
import type { SecurityManager } from '../security/index.js';
import type { AgentTool } from '@mohanscodex/spectra-agent';
import { getSystemPrompt } from '../utils/platform.js';

function descriptionForTaskTool(): string {
	const subagentList = SUBAGENTS.map((name) => {
		const def = AGENT_DEFINITIONS[name];
		return `- **${name}**: ${def.description}`;
	}).join('\n');

	return `Launch a new agent to handle complex, multistep tasks autonomously.

When to use the Task tool:
${subagentList}

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance
2. Each agent invocation starts with a fresh context
3. The agent's outputs should generally be trusted
4. Clearly tell the agent whether you expect it to write code or just to do research`;
}

export function createTaskTool(config: AgentRegistryConfig, security: SecurityManager): SpectraTool {
	return {
		name: 'task',
		capabilities: { reads: false, writes: false },
		description: descriptionForTaskTool(),
		displayName: (args: { description: string }) =>
			`@${(args as any).subagent_type || 'subagent'} ${args.description || ''}`.slice(0, 60),
		parameters: z.object({
			description: z.string().describe('A short (3-5 words) description of the task'),
			prompt: z.string().describe('The task for the agent to perform'),
			subagent_type: z.string().describe('The type of specialized agent to use for this task'),
		}),

		execute: async ({ description, prompt, subagent_type }, ctx) => {
			const def = AGENT_DEFINITIONS[subagent_type];
			if (!def) {
				const available = SUBAGENTS.join(', ');
				return errorResult(`Unknown subagent "${subagent_type}". Available: ${available}`);
			}
			if (def.mode !== 'subagent') {
				return errorResult(
					`"${subagent_type}" is a primary agent, not a subagent. Available subagents: ${SUBAGENTS.join(', ')}`,
				);
			}

			try {
				const { Agent } = await import('@mohanscodex/spectra-agent');
				const { createAllToolsWithSecurity } = await import('./index.js');
				const allTools = createAllToolsWithSecurity(security, config);
				const tools = filterToolsByAgent(allTools, subagent_type);

				const subagent = new Agent({
					model: config.model,
					systemPrompt: [getSystemPrompt(), def.prompt].filter(Boolean).join('\n\n'),
					tools,
					...(def.maxTurns ? { maxTurns: def.maxTurns } : {}),
					getApiKey: config.getApiKey,
				});

				let finalText = '';
				for await (const ev of subagent.run(prompt, { signal: ctx.signal })) {
					if (ev.type === 'message_update' && ev.message.role === 'assistant') {
						const textBlocks = ev.message.content.filter(
							(c): c is { type: 'text'; text: string } => c.type === 'text',
						);
						finalText = textBlocks.map((b) => b.text).join('');
					}
				}

				const resultText = finalText.trim();
				if (!resultText) {
					return textResult(`Subagent @${subagent_type} completed with no text output.`);
				}
				return textResult(resultText);
			} catch (err) {
				if (ctx.signal?.aborted) {
					return textResult(`Subagent @${subagent_type} was interrupted.`);
				}
				return errorResult(`Subagent @${subagent_type} failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	};
}
