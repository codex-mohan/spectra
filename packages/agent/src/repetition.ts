/**
 * Streaming repetition guard.
 *
 * Detects a suffix of the streaming text or thinking block that repeats the
 * same unit several times consecutively. Work is bounded by the retained tail
 * and uses a prefix-function scan, so cost is O(tail) per delta rather than
 * rescanning the whole response.
 */

export interface RepetitionDetection {
	kind: 'text' | 'thinking';
	unit: string;
	repeats: number;
}

export interface RepetitionDetectorOptions {
	minRepeats?: number;
	minUnitChars?: number;
	maxTailChars?: number;
}

const DEFAULT_MIN_REPEATS = 4;
const DEFAULT_MIN_UNIT_CHARS = 24;
const DEFAULT_MAX_TAIL_CHARS = 8192;

/** True for units that are pure digits, whitespace, or punctuation. */
function hasMeaningfulContent(unit: string): boolean {
	return /[A-Za-z]/.test(unit) && unit.replace(/[^A-Za-z0-9]/g, '').length >= 4;
}

function prefixFunction(text: string): number[] {
	const pi = new Array<number>(text.length).fill(0);
	for (let i = 1, j = 0; i < text.length; i++) {
		while (j > 0 && text[i] !== text[j]) j = pi[j - 1];
		if (text[i] === text[j]) j++;
		pi[i] = j;
	}
	return pi;
}

function repeatedSuffix(text: string, minRepeats: number, minUnitChars: number): { unit: string; repeats: number } | null {
	const n = text.length;
	const minLength = minRepeats * minUnitChars;
	if (n < minLength) return null;

	const pi = prefixFunction(text);
	for (let length = n; length >= minLength; length--) {
		const period = length - pi[length - 1];
		if (period < minUnitChars) continue;
		if (length % period !== 0) continue;
		const repeats = length / period;
		if (repeats < minRepeats) continue;

		const start = n - period * repeats;
		if (start < 0) continue;
		const unit = text.slice(n - period);
		if (!hasMeaningfulContent(unit)) continue;

		let matches = true;
		for (let index = 1; index < repeats; index++) {
			const offset = start + index * period;
			if (text.slice(offset, offset + period) !== unit) {
				matches = false;
				break;
			}
		}
		if (matches) return { unit, repeats };
	}
	return null;
}

export class RepetitionDetector {
	private readonly minRepeats: number;
	private readonly minUnitChars: number;
	private readonly maxTailChars: number;
	private readonly tails: Record<'text' | 'thinking', string> = { text: '', thinking: '' };
	private fired = false;

	constructor(options: RepetitionDetectorOptions = {}) {
		this.minRepeats = Math.max(2, Math.trunc(options.minRepeats ?? DEFAULT_MIN_REPEATS));
		this.minUnitChars = Math.max(8, Math.trunc(options.minUnitChars ?? DEFAULT_MIN_UNIT_CHARS));
		this.maxTailChars = Math.max(this.minUnitChars * this.minRepeats, Math.trunc(options.maxTailChars ?? DEFAULT_MAX_TAIL_CHARS));
	}

	push(kind: 'text' | 'thinking', delta: string): RepetitionDetection | null {
		if (this.fired || delta.length === 0) return null;
		const tail = (this.tails[kind] + delta).slice(-this.maxTailChars);
		this.tails[kind] = tail;

		const match = repeatedSuffix(tail, this.minRepeats, this.minUnitChars);
		if (!match) return null;
		this.fired = true;
		return { kind, unit: match.unit, repeats: match.repeats };
	}

	reset(): void {
		this.tails.text = '';
		this.tails.thinking = '';
		this.fired = false;
	}
}
