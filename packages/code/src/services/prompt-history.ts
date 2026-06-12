import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { getGlobalStateDir } from '../utils/paths.js';

const MAX_HISTORY = 200;

export interface PromptHistoryEntry {
	text: string;
	timestamp: number;
}

export class PromptHistoryService {
	private filePath: string;
	private history: PromptHistoryEntry[] = [];
	private index: number | null = null;
	private draft: string = '';

	constructor() {
		const stateDir = getGlobalStateDir();
		this.filePath = join(stateDir, 'prompt-history.jsonl');
		this.load();
	}

	private load(): void {
		try {
			if (!existsSync(this.filePath)) return;
			const text = readFileSync(this.filePath, 'utf-8');
			const entries = text
				.split('\n')
				.filter(Boolean)
				.map((line) => {
					try {
						return JSON.parse(line) as PromptHistoryEntry;
					} catch {
						return null;
					}
				})
				.filter((e): e is PromptHistoryEntry => e !== null)
				.slice(-MAX_HISTORY);
			this.history = entries;
			// Self-heal: rewrite with only valid entries
			if (entries.length > 0) {
				this.persist();
			}
		} catch {
			// corrupt file, start fresh
		}
	}

	private persist(): void {
		try {
			const dir = join(this.filePath, '..');
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			const content = this.history.map((e) => JSON.stringify(e)).join('\n') + '\n';
			writeFileSync(this.filePath, content, 'utf-8');
		} catch {
			// never fail on persistence errors
		}
	}

	/** Append a prompt to history. Deduplicates consecutive identical entries. */
	append(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;

		const last = this.history[this.history.length - 1];
		if (last && last.text === trimmed) {
			this.index = null;
			this.draft = '';
			return;
		}

		const entry: PromptHistoryEntry = { text: trimmed, timestamp: Date.now() };
		this.history.push(entry);
		if (this.history.length > MAX_HISTORY) {
			this.history = this.history.slice(-MAX_HISTORY);
		}
		this.index = null;
		this.draft = '';

		try {
			appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
		} catch {
			// fallback to full persist
			this.persist();
		}
	}

	/**
	 * Navigate history. Returns the text to display, or undefined if no navigation.
	 * @param direction -1 for up (older), 1 for down (newer)
	 * @param currentText The current text in the textarea
	 * @param cursorOffset The cursor position in the text
	 */
	move(direction: -1 | 1, currentText: string, cursorOffset: number): string | undefined {
		if (!this.history.length) return undefined;

		// Up: only navigate if cursor is at the very beginning
		if (direction === -1 && cursorOffset !== 0) return undefined;

		// Down: only navigate if cursor is at the very end
		if (direction === 1 && cursorOffset !== currentText.length) return undefined;

		// Entering history mode (first up press)
		if (this.index === null) {
			if (direction === 1) return undefined; // can't go down from current
			const idx = this.history.length - 1;
			this.index = idx;
			this.draft = currentText;
			return this.history[idx].text;
		}

		const idx = this.index + direction;

		// Past the end → restore draft
		if (idx >= this.history.length) {
			this.index = null;
			return this.draft;
		}

		// Before the beginning → clamp
		if (idx < 0) return undefined;

		this.index = idx;
		return this.history[idx].text;
	}

	/** Check if we're currently browsing history. */
	isBrowsing(): boolean {
		return this.index !== null;
	}

	/** Get the cursor position after a history move. */
	getCursorAfterMove(direction: -1 | 1): number {
		// Up → cursor at beginning, Down → cursor at end
		return direction === -1 ? 0 : -1; // -1 means "end of text"
	}

	/** Build history from existing session messages (for loading past sessions). */
	loadFromSessionMessages(messages: Array<{ role: string; content: string | unknown }>): void {
		const existing = new Set(this.history.map((e) => e.text));
		for (const msg of messages) {
			if (msg.role !== 'user') continue;
			const text = typeof msg.content === 'string' ? msg.content.trim() : '';
			if (!text || existing.has(text)) continue;
			existing.add(text);
			this.history.push({ text, timestamp: Date.now() });
		}
		if (this.history.length > MAX_HISTORY) {
			this.history = this.history.slice(-MAX_HISTORY);
		}
		this.persist();
	}
}
