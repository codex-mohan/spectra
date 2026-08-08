import { describe, expect, it } from 'vitest';
import type { AgentTool } from '@mohanscodex/spectra-agent';
import { createAskTool, type AskToolDetails, type AskToolInput } from '../tools/ask.js';
import { createAllTools, createAllToolsWithSecurity } from '../tools/index.js';
import { createSecurityManager } from '../security/index.js';

const input: AskToolInput = {
	questions: [
		{
			id: 'storage',
			question: 'Which storage backend?',
			options: [
				{ label: 'SQLite', description: 'Local and zero-configuration.' },
				{ label: 'PostgreSQL', description: 'Shared production database.' },
			],
			recommended: 0,
		},
	],
};

const details: AskToolDetails = {
	results: [
		{
			id: 'storage',
			question: 'Which storage backend?',
			options: ['SQLite', 'PostgreSQL'],
			multi: false,
			selectedOptions: ['SQLite'],
		},
	],
};

function toolByName(tools: AgentTool[], name: string): AgentTool {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Missing tool: ${name}`);
	return tool;
}

describe('ask tool', () => {
	it('is available in the default tool catalog', () => {
		expect(createAllTools().some((tool) => tool.name === 'ask')).toBe(true);
	});

	it('tells non-interactive agents to continue without asking again', async () => {
		const result = await createAskTool().execute(input, { toolCallId: 'ask-1' });
		expect(result.isError).not.toBe(true);
		expect(result.content[0]).toMatchObject({
			type: 'text',
			text: expect.stringContaining('not supported in this session'),
		});
	});

	it('returns the interactive answer to the model with structured details', async () => {
		const tool = createAskTool(async (receivedInput, context) => {
			expect(receivedInput).toEqual(input);
			expect(context.toolCallId).toBe('ask-2');
			return details;
		});
		const result = await tool.execute(input, { toolCallId: 'ask-2' });
		expect(result.details).toEqual(details);
		expect(result.content[0]).toMatchObject({ type: 'text', text: 'User answers:\nstorage: SQLite' });
	});

	it('injects the interactive handler through the secure TUI tool factory', async () => {
		const tools = createAllToolsWithSecurity(
			createSecurityManager(),
			undefined,
			undefined,
			undefined,
			async () => details,
		);
		const result = await toolByName(tools, 'ask').execute('ask-secure', input);
		expect(result.details).toEqual(details);
	});
	it('turns dialog cancellation into a normal continuation message', async () => {
		const result = await createAskTool(async () => undefined).execute(input, { toolCallId: 'ask-3' });
		expect(result.isError).not.toBe(true);
		expect(result.content[0]).toMatchObject({
			type: 'text',
			text: expect.stringContaining('cancelled'),
		});
	});

});
