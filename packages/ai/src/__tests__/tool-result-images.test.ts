import { describe, expect, it } from 'vitest';
import type { AssistantMessage, ImageContent, Message, Model, StopReason, ToolResultMessage } from '../types.js';
import { toAnthropicMessage } from '../providers/anthropic.js';
import { convertMessages } from '../providers/openai-completions.js';
import { convertResponsesMessages } from '../providers/openai-responses.js';

const IMAGE: ImageContent = { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' };
const DATA_URL = `data:${IMAGE.mimeType};base64,${IMAGE.data}`;
const IMAGE_NOTE = 'Read image file [image/png] (12 bytes)';
const FOLLOW_UP_NOTE = 'Images returned by the tool result above:';

const model: Model = { id: 'test-model', name: 'Test', provider: 'openai', api: 'openai-completions' };

function userTurn(text: string): Message {
	return { role: 'user', content: text, timestamp: 0 };
}

function assistantCall(...ids: string[]): AssistantMessage {
	return {
		role: 'assistant',
		content: ids.map((id) => ({ type: 'toolCall' as const, id, name: 'read', arguments: { path: 'shot.png' } })),
		provider: 'openai',
		model: 'test-model',
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
		stopReason: 'toolUse' as StopReason,
		timestamp: 1,
	};
}

function imageToolResult(toolCallId: string): ToolResultMessage {
	return {
		role: 'toolResult',
		toolCallId,
		toolName: 'read',
		content: [{ type: 'text', text: IMAGE_NOTE }, IMAGE],
		isError: false,
		timestamp: 2,
	};
}

function textToolResult(toolCallId: string): ToolResultMessage {
	return {
		role: 'toolResult',
		toolCallId,
		toolName: 'read',
		content: [{ type: 'text', text: 'plain output' }],
		isError: false,
		timestamp: 2,
	};
}

type Wire = Array<Record<string, unknown>>;

describe('openai chat completions tool-result images', () => {
	it('replays a tool-result image in one user turn after the text-only tool payload', () => {
		const messages = convertMessages(model, {
			messages: [userTurn('look at this'), assistantCall('call_1'), imageToolResult('call_1')],
		}) as unknown as Wire;

		expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'user']);
		expect(messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_1', content: IMAGE_NOTE });
		expect(messages[3]).toEqual({
			role: 'user',
			content: [
				{ type: 'text', text: FOLLOW_UP_NOTE },
				{ type: 'image_url', image_url: { url: DATA_URL } },
			],
		});
	});

	it('keeps parallel tool results adjacent and batches their images into one turn', () => {
		const messages = convertMessages(model, {
			messages: [assistantCall('call_1', 'call_2'), imageToolResult('call_1'), imageToolResult('call_2')],
		}) as unknown as Wire;

		expect(messages.map((message) => message.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
		expect(messages[1]).toMatchObject({ tool_call_id: 'call_1' });
		expect(messages[2]).toMatchObject({ tool_call_id: 'call_2' });
		expect(String(JSON.stringify(messages))).not.toContain('tool result missing');
		expect(messages[3].content).toEqual([
			{ type: 'text', text: FOLLOW_UP_NOTE },
			{ type: 'image_url', image_url: { url: DATA_URL } },
			{ type: 'image_url', image_url: { url: DATA_URL } },
		]);
	});

	it('adds no image turn for text-only tool results', () => {
		const messages = convertMessages(model, {
			messages: [assistantCall('call_1'), textToolResult('call_1')],
		}) as unknown as Wire;

		expect(messages.map((message) => message.role)).toEqual(['assistant', 'tool']);
	});
});

describe('openai responses tool-result images', () => {
	it('replays a tool-result image in one user item after the function_call_output', () => {
		const messages = convertResponsesMessages(model, {
			messages: [userTurn('look at this'), assistantCall('call_1'), imageToolResult('call_1')],
		}) as unknown as Wire;

		const outputIndex = messages.findIndex((message) => message.type === 'function_call_output');
		expect(messages[outputIndex]).toMatchObject({ type: 'function_call_output', call_id: 'call_1', output: IMAGE_NOTE });
		expect(messages[outputIndex + 1]).toEqual({
			role: 'user',
			content: [
				{ type: 'input_text', text: FOLLOW_UP_NOTE },
				{ type: 'input_image', image_url: DATA_URL },
			],
		});
	});

	it('keeps parallel tool results adjacent and batches their images into one item', () => {
		const messages = convertResponsesMessages(model, {
			messages: [assistantCall('call_1', 'call_2'), imageToolResult('call_1'), imageToolResult('call_2')],
		}) as unknown as Wire;

		const outputIndexes = messages
			.map((message, index) => (message.type === 'function_call_output' ? index : -1))
			.filter((index) => index >= 0);
		expect(outputIndexes).toEqual([2, 3]);
		expect(messages[4]).toEqual({
			role: 'user',
			content: [
				{ type: 'input_text', text: FOLLOW_UP_NOTE },
				{ type: 'input_image', image_url: DATA_URL },
				{ type: 'input_image', image_url: DATA_URL },
			],
		});
	});
});

type AnthropicWire = { role?: string; content: Array<Record<string, unknown>> };

function anthropicToolResult(result: ToolResultMessage): AnthropicWire {
	return toAnthropicMessage(result) as unknown as AnthropicWire;
}

describe('anthropic tool-result images', () => {
	it('merges text and image blocks into a single tool_result', () => {
		const converted = anthropicToolResult(imageToolResult('toolu_1'));

		expect(converted.role).toBe('user');
		expect(converted.content).toHaveLength(1);
		expect(converted.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
		expect(converted.content[0].content).toEqual([
			{ type: 'text', text: IMAGE_NOTE },
			{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: IMAGE.data } },
		]);
	});

	it('never emits two tool_result blocks for one tool_use_id', () => {
		const converted = anthropicToolResult(imageToolResult('toolu_1'));

		const ids = converted.content.map((block) => block.tool_use_id);
		expect(ids).toEqual(['toolu_1']);
	});

	it('keeps a text-free tool result valid with a string content', () => {
		const converted = anthropicToolResult({
			role: 'toolResult',
			toolCallId: 'toolu_2',
			toolName: 'read',
			content: [],
			isError: false,
			timestamp: 3,
		});

		expect(converted.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_2', content: '' });
	});
});
