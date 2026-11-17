import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../tui/types.js';
import { needsStableRepaint } from '../tui/utils/display-text.js';

function message(content: string, blocks?: ChatMessage['blocks']): ChatMessage {
	return { id: 'm', role: 'assistant', content, ...(blocks ? { blocks } : {}) };
}

describe('stable repaint detection', () => {
	it('detects Tamil, Arabic, and CJK content', () => {
		expect(needsStableRepaint([message('உஜ்ஜயினி லக்னம்')])).toBe(true);
		expect(needsStableRepaint([message('العربية')])).toBe(true);
		expect(needsStableRepaint([message('こんにちは')])).toBe(true);
	});

	it('leaves ASCII-only transcripts on the culling path', () => {
		expect(needsStableRepaint([message('plain english text')])).toBe(false);
	});

	it('checks structured blocks and tool arguments', () => {
		expect(needsStableRepaint([message('', [{ type: 'text', content: 'மகரம்' }])])).toBe(true);
		expect(needsStableRepaint([{ ...message(''), toolArguments: { text: 'مرحبا' } }])).toBe(true);
	});
});
