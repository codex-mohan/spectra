import { z } from 'zod';
import type { ToolResult } from '@mohanscodex/spectra-agent';
import type { SpectraTool, ToolContext } from './types.js';

const askOptionSchema = z.object({
	label: z.string(),
	description: z.string().optional(),
});

const askQuestionSchema = z.object({
	id: z.string(),
	question: z.string(),
	options: z.array(askOptionSchema),
	multi: z.boolean().optional(),
	recommended: z.number().int().nonnegative().optional(),
});

export const askToolSchema = z.object({
	questions: z.array(askQuestionSchema).min(1),
});

export type AskToolInput = z.infer<typeof askToolSchema>;
export type AskQuestion = AskToolInput['questions'][number];

export const askQuestionResultSchema = z.object({
	id: z.string(),
	question: z.string(),
	options: z.array(z.string()),
	multi: z.boolean(),
	selectedOptions: z.array(z.string()),
	customInput: z.string().optional(),
});

export const askToolDetailsSchema = z.object({
	results: z.array(askQuestionResultSchema),
});

export type AskQuestionResult = z.infer<typeof askQuestionResultSchema>;
export type AskToolDetails = z.infer<typeof askToolDetailsSchema>;

export type AskHandler = (input: AskToolInput, context: ToolContext) => Promise<AskToolDetails | undefined>;

const unavailableMessage =
	'Interactive questions are not supported in this session. Continue using the safest reasonable assumption, state that assumption, and do not call ask again.';

function formatResult(details: AskToolDetails): string {
	const lines = details.results.map((result) => {
		if (result.customInput !== undefined) {
			const selected = result.selectedOptions.length > 0 ? ` [${result.selectedOptions.join(', ')}]` : '';
			return `${result.id}:${selected} ${JSON.stringify(result.customInput)}`;
		}
		if (result.selectedOptions.length === 0) return `${result.id}: no selection`;
		return result.multi
			? `${result.id}: [${result.selectedOptions.join(', ')}]`
			: `${result.id}: ${result.selectedOptions[0]}`;
	});
	return `User answers:\n${lines.join('\n')}`;
}

export function createAskTool(handler?: AskHandler): SpectraTool<typeof askToolSchema> {
	return {
		name: 'ask',
		displayName: 'Ask',
		description:
			'Ask the interactive user one or more multiple-choice questions, with an optional custom answer for each question.',
		parameters: askToolSchema,
		promptGuidelines: [
			'Use ask only when the user must choose between materially different options.',
			'Provide 2-5 concise options and put tradeoffs in option descriptions.',
			'Do not add an Other option; the interactive UI adds it automatically.',
			'Use recommended as the zero-based index of the safest default when appropriate.',
		],
		capabilities: { reads: false, writes: false },
		execute: async (args, context): Promise<ToolResult<AskToolDetails>> => {
			if (!handler) return { content: [{ type: 'text', text: unavailableMessage }] };
			const details = await handler(args, context);
			if (!details) {
				return {
					content: [{ type: 'text', text: 'The user cancelled the question. Continue without asking again.' }],
				};
			}
			return {
				content: [{ type: 'text', text: formatResult(details) }],
				details,
			};
		},
	};
}
