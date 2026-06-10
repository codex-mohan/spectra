import { eastAsianWidth } from 'get-east-asian-width';

// ---------------------------------------------------------------------------
// ANSI code extraction
// ---------------------------------------------------------------------------

export function extractAnsiCode(str: string, pos: number): { code: string; length: number } | null {
	if (pos >= str.length || str[pos] !== '\x1b') return null;

	const next = str[pos + 1];

	// CSI sequence: ESC [ ... finalByte
	if (next === '[') {
		let j = pos + 2;
		while (j < str.length && !/[mGKHJ]/.test(str[j]!)) j++;
		if (j < str.length) return { code: str.substring(pos, j + 1), length: j + 1 - pos };
		return null;
	}

	// OSC sequence: ESC ] ... BEL or ESC ] ... ST (ESC \)
	if (next === ']') {
		let j = pos + 2;
		while (j < str.length) {
			if (str[j] === '\x07') return { code: str.substring(pos, j + 1), length: j + 1 - pos };
			if (str[j] === '\x1b' && str[j + 1] === '\\') return { code: str.substring(pos, j + 2), length: j + 2 - pos };
			j++;
		}
		return null;
	}

	// APC sequence: ESC _ ... BEL or ESC _ ... ST (ESC \)
	if (next === '_') {
		let j = pos + 2;
		while (j < str.length) {
			if (str[j] === '\x07') return { code: str.substring(pos, j + 1), length: j + 1 - pos };
			if (str[j] === '\x1b' && str[j + 1] === '\\') return { code: str.substring(pos, j + 2), length: j + 2 - pos };
			j++;
		}
		return null;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Image line detection
// ---------------------------------------------------------------------------

export function isImageLine(line: string): boolean {
	return line.includes('\x1b_G') || line.includes('\x1b]1337;File');
}

// ---------------------------------------------------------------------------
// visibleWidth
// ---------------------------------------------------------------------------

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function getSegmenter(): Intl.Segmenter {
	return segmenter;
}

const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;

function couldBeEmoji(segment: string): boolean {
	const cp = segment.codePointAt(0)!;
	return (
		(cp >= 0x1f000 && cp <= 0x1fbff) ||
		(cp >= 0x2300 && cp <= 0x23ff) ||
		(cp >= 0x2600 && cp <= 0x27bf) ||
		(cp >= 0x2b50 && cp <= 0x2b55) ||
		segment.includes('\uFE0F') ||
		segment.length > 2
	);
}

function graphemeWidth(segment: string): number {
	if (zeroWidthRegex.test(segment)) return 0;
	if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) return 2;

	// Regional indicator symbols (flags)
	const cp = segment.codePointAt(0);
	if (cp === undefined) return 0;
	if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return 2;

	let width = eastAsianWidth(cp);

	if (segment.length > 1) {
		for (const char of segment.slice(1)) {
			const c = char.codePointAt(0)!;
			if (c >= 0xff00 && c <= 0xffef) width += eastAsianWidth(c);
		}
	}

	return width;
}

function isPrintableAscii(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 0x20 || code > 0x7e) return false;
	}
	return true;
}

export function visibleWidth(str: string): number {
	if (str.length === 0) return 0;
	if (isPrintableAscii(str)) return str.length;

	let clean = str;
	if (str.includes('\t')) clean = clean.replace(/\t/g, '   ');
	if (clean.includes('\x1b')) {
		let stripped = '';
		let i = 0;
		while (i < clean.length) {
			const ansi = extractAnsiCode(clean, i);
			if (ansi) {
				i += ansi.length;
				continue;
			}
			stripped += clean[i];
			i++;
		}
		clean = stripped;
	}

	let width = 0;
	for (const { segment } of segmenter.segment(clean)) {
		width += graphemeWidth(segment);
	}
	return width;
}

// ---------------------------------------------------------------------------
// truncateToWidth
// ---------------------------------------------------------------------------

export function truncateToWidth(
	text: string,
	maxWidth: number,
	ellipsis: string = '...',
	pad: boolean = false,
): string {
	if (maxWidth <= 0) return pad ? ' '.repeat(maxWidth) : '';
	if (text.length === 0) return pad ? ' '.repeat(maxWidth) : '';

	const ellipsisWidth = visibleWidth(ellipsis);

	// Fast path: pure ASCII
	if (isPrintableAscii(text)) {
		if (text.length <= maxWidth) {
			return pad ? text + ' '.repeat(maxWidth - text.length) : text;
		}
		const targetWidth = maxWidth - ellipsisWidth;
		let result = text.slice(0, targetWidth);
		if (ellipsis.length > 0) {
			result = result + '\x1b[0m' + ellipsis + '\x1b[0m';
		}
		const totalWidth = visibleWidth(result);
		return pad ? result + ' '.repeat(Math.max(0, maxWidth - totalWidth)) : result;
	}

	// Unicode path: scan grapheme by grapheme
	let clean = text;
	if (clean.includes('\t')) clean = clean.replace(/\t/g, '   ');

	const targetWidth = maxWidth - ellipsisWidth;
	let result = '';
	let pendingAnsi = '';
	let keptWidth = 0;
	let visibleSoFar = 0;
	let keepContiguous = true;
	let overflowed = false;
	let exhaustedInput = false;

	if (!clean.includes('\x1b')) {
		for (const { segment } of segmenter.segment(clean)) {
			const w = graphemeWidth(segment);
			if (keepContiguous && keptWidth + w <= targetWidth) {
				result += segment;
				keptWidth += w;
			} else {
				keepContiguous = false;
			}
			visibleSoFar += w;
			if (visibleSoFar > maxWidth) {
				overflowed = true;
				break;
			}
		}
		exhaustedInput = !overflowed;
	} else {
		let i = 0;
		while (i < clean.length) {
			const ansi = extractAnsiCode(clean, i);
			if (ansi) {
				pendingAnsi += ansi.code;
				i += ansi.length;
				continue;
			}

			let end = i;
			while (end < clean.length && !extractAnsiCode(clean, end)) end++;

			for (const { segment } of segmenter.segment(clean.slice(i, end))) {
				const w = graphemeWidth(segment);
				if (keepContiguous && keptWidth + w <= targetWidth) {
					if (pendingAnsi) {
						result += pendingAnsi;
						pendingAnsi = '';
					}
					result += segment;
					keptWidth += w;
				} else {
					keepContiguous = false;
					pendingAnsi = '';
				}
				visibleSoFar += w;
				if (visibleSoFar > maxWidth) {
					overflowed = true;
					break;
				}
			}
			if (overflowed) break;
			i = end;
		}
		exhaustedInput = i >= clean.length;
	}

	if (!overflowed && exhaustedInput) {
		return pad ? text + ' '.repeat(Math.max(0, maxWidth - visibleSoFar)) : text;
	}

	const reset = '\x1b[0m';
	let final = result;
	if (ellipsis.length > 0) final = final + reset + ellipsis + reset;
	const finalWidth = visibleWidth(final);
	return pad ? final + ' '.repeat(Math.max(0, maxWidth - finalWidth)) : final;
}

// ---------------------------------------------------------------------------
// applyBackgroundToLine
// ---------------------------------------------------------------------------

export function applyBackgroundToLine(line: string, width: number, bgFn: (text: string) => string): string {
	const visibleLen = visibleWidth(line);
	const paddingNeeded = Math.max(0, width - visibleLen);
	return bgFn(line + ' '.repeat(paddingNeeded));
}

// ---------------------------------------------------------------------------
// wrapTextWithAnsi
// ---------------------------------------------------------------------------

class AnsiCodeTracker {
	private bold = false;
	private dim = false;
	private italic = false;
	private underline = false;
	private blink = false;
	private inverse = false;
	private hidden = false;
	private strikethrough = false;
	private fgColor: string | null = null;
	private bgColor: string | null = null;

	process(ansiCode: string): void {
		if (!ansiCode.endsWith('m')) return;
		const match = ansiCode.match(/\x1b\[([\d;]*)m/);
		if (!match) return;
		const params = match[1];
		if (params === '' || params === '0') {
			this.reset();
			return;
		}

		const parts = params.split(';');
		let i = 0;
		while (i < parts.length) {
			const code = Number.parseInt(parts[i], 10);
			if (code === 38 || code === 48) {
				if (parts[i + 1] === '5' && parts[i + 2] !== undefined) {
					if (code === 38) this.fgColor = `38;5;${parts[i + 2]}`;
					else this.bgColor = `48;5;${parts[i + 2]}`;
					i += 3;
					continue;
				} else if (parts[i + 1] === '2' && parts[i + 4] !== undefined) {
					if (code === 38) this.fgColor = `38;2;${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
					else this.bgColor = `48;2;${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
					i += 5;
					continue;
				}
			}

			switch (code) {
				case 0:
					this.reset();
					break;
				case 1:
					this.bold = true;
					break;
				case 2:
					this.dim = true;
					break;
				case 3:
					this.italic = true;
					break;
				case 4:
					this.underline = true;
					break;
				case 5:
					this.blink = true;
					break;
				case 7:
					this.inverse = true;
					break;
				case 8:
					this.hidden = true;
					break;
				case 9:
					this.strikethrough = true;
					break;
				case 22:
					this.bold = false;
					this.dim = false;
					break;
				case 23:
					this.italic = false;
					break;
				case 24:
					this.underline = false;
					break;
				case 25:
					this.blink = false;
					break;
				case 27:
					this.inverse = false;
					break;
				case 28:
					this.hidden = false;
					break;
				case 29:
					this.strikethrough = false;
					break;
				case 39:
					this.fgColor = null;
					break;
				case 49:
					this.bgColor = null;
					break;
				default:
					if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) this.fgColor = String(code);
					else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) this.bgColor = String(code);
					break;
			}
			i++;
		}
	}

	reset(): void {
		this.bold = this.dim = this.italic = this.underline = this.blink = this.inverse = false;
		this.hidden = this.strikethrough = false;
		this.fgColor = this.bgColor = null;
	}

	clear(): void {
		this.reset();
	}

	getActiveCodes(): string {
		const codes: string[] = [];
		if (this.bold) codes.push('1');
		if (this.dim) codes.push('2');
		if (this.italic) codes.push('3');
		if (this.underline) codes.push('4');
		if (this.blink) codes.push('5');
		if (this.inverse) codes.push('7');
		if (this.hidden) codes.push('8');
		if (this.strikethrough) codes.push('9');
		if (this.fgColor) codes.push(this.fgColor);
		if (this.bgColor) codes.push(this.bgColor);
		if (codes.length === 0) return '';
		return `\x1b[${codes.join(';')}m`;
	}

	getLineEndReset(): string {
		if (this.underline) return '\x1b[24m';
		return '';
	}
}

function updateTrackerFromText(text: string, tracker: AnsiCodeTracker): void {
	let i = 0;
	while (i < text.length) {
		const ansi = extractAnsiCode(text, i);
		if (ansi) {
			tracker.process(ansi.code);
			i += ansi.length;
		} else i++;
	}
}

function splitIntoTokensWithAnsi(text: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let pendingAnsi = '';
	let inWhitespace = false;
	let i = 0;
	while (i < text.length) {
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			pendingAnsi += ansiResult.code;
			i += ansiResult.length;
			continue;
		}
		const char = text[i];
		const charIsSpace = char === ' ';
		if (charIsSpace !== inWhitespace && current) {
			tokens.push(current);
			current = '';
		}
		if (pendingAnsi) {
			current += pendingAnsi;
			pendingAnsi = '';
		}
		inWhitespace = charIsSpace;
		current += char;
		i++;
	}
	if (pendingAnsi) current += pendingAnsi;
	if (current) tokens.push(current);
	return tokens;
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
	if (!text) return [''];

	const inputLines = text.split('\n');
	const result: string[] = [];
	const tracker = new AnsiCodeTracker();

	for (const inputLine of inputLines) {
		const prefix = result.length > 0 ? tracker.getActiveCodes() : '';
		result.push(...wrapSingleLine(prefix + inputLine, width));
		updateTrackerFromText(inputLine, tracker);
	}

	return result.length > 0 ? result : [''];
}

function wrapSingleLine(line: string, width: number): string[] {
	if (!line) return [''];
	const visibleLength = visibleWidth(line);
	if (visibleLength <= width) return [line];

	const wrapped: string[] = [];
	const tracker = new AnsiCodeTracker();
	const tokens = splitIntoTokensWithAnsi(line);
	let currentLine = '';
	let currentVisibleLength = 0;

	for (const token of tokens) {
		const tokenVisibleLength = visibleWidth(token);
		const isWhitespace = token.trim() === '';

		if (tokenVisibleLength > width && !isWhitespace) {
			if (currentLine) {
				const lineEndReset = tracker.getLineEndReset();
				if (lineEndReset) currentLine += lineEndReset;
				wrapped.push(currentLine);
				currentLine = '';
				currentVisibleLength = 0;
			}
			const broken = breakLongWord(token, width, tracker);
			wrapped.push(...broken.slice(0, -1));
			currentLine = broken[broken.length - 1];
			currentVisibleLength = visibleWidth(currentLine);
			continue;
		}

		const totalNeeded = currentVisibleLength + tokenVisibleLength;
		if (totalNeeded > width && currentVisibleLength > 0) {
			let lineToWrap = currentLine.trimEnd();
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) lineToWrap += lineEndReset;
			wrapped.push(lineToWrap);
			if (isWhitespace) {
				currentLine = tracker.getActiveCodes();
				currentVisibleLength = 0;
			} else {
				currentLine = tracker.getActiveCodes() + token;
				currentVisibleLength = tokenVisibleLength;
			}
		} else {
			currentLine += token;
			currentVisibleLength += tokenVisibleLength;
		}
		updateTrackerFromText(token, tracker);
	}

	if (currentLine) wrapped.push(currentLine);
	return wrapped.length > 0 ? wrapped.map((line) => line.trimEnd()) : [''];
}

function breakLongWord(word: string, width: number, tracker: AnsiCodeTracker): string[] {
	const lines: string[] = [];
	let currentLine = tracker.getActiveCodes();
	let currentWidth = 0;

	let i = 0;
	const segments: Array<{ type: 'ansi' | 'grapheme'; value: string }> = [];
	while (i < word.length) {
		const ansiResult = extractAnsiCode(word, i);
		if (ansiResult) {
			segments.push({ type: 'ansi', value: ansiResult.code });
			i += ansiResult.length;
		} else {
			let end = i;
			while (end < word.length) {
				const nextAnsi = extractAnsiCode(word, end);
				if (nextAnsi) break;
				end++;
			}
			for (const seg of segmenter.segment(word.slice(i, end))) {
				segments.push({ type: 'grapheme', value: seg.segment });
			}
			i = end;
		}
	}

	for (const seg of segments) {
		if (seg.type === 'ansi') {
			currentLine += seg.value;
			tracker.process(seg.value);
			continue;
		}
		const grapheme = seg.value;
		if (!grapheme) continue;
		const w = graphemeWidth(grapheme);
		if (currentWidth + w > width) {
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) currentLine += lineEndReset;
			lines.push(currentLine);
			currentLine = tracker.getActiveCodes();
			currentWidth = 0;
		}
		currentLine += grapheme;
		currentWidth += w;
	}

	if (currentLine) lines.push(currentLine);
	return lines.length > 0 ? lines : [''];
}

// ---------------------------------------------------------------------------
// sliceByColumn / sliceWithWidth
// ---------------------------------------------------------------------------

export function sliceByColumn(line: string, startCol: number, length: number, strict = false): string {
	return sliceWithWidth(line, startCol, length, strict).text;
}

export function sliceWithWidth(
	line: string,
	startCol: number,
	length: number,
	strict = false,
): { text: string; width: number } {
	if (length <= 0) return { text: '', width: 0 };
	const endCol = startCol + length;
	let result = '',
		resultWidth = 0,
		currentCol = 0,
		i = 0,
		pendingAnsi = '';

	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			if (currentCol >= startCol && currentCol < endCol) result += ansi.code;
			else if (currentCol < startCol) pendingAnsi += ansi.code;
			i += ansi.length;
			continue;
		}

		let textEnd = i;
		while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;

		for (const { segment } of segmenter.segment(line.slice(i, textEnd))) {
			const w = graphemeWidth(segment);
			const inRange = currentCol >= startCol && currentCol < endCol;
			const fits = !strict || currentCol + w <= endCol;
			if (inRange && fits) {
				if (pendingAnsi) {
					result += pendingAnsi;
					pendingAnsi = '';
				}
				result += segment;
				resultWidth += w;
			}
			currentCol += w;
			if (currentCol >= endCol) break;
		}
		i = textEnd;
		if (currentCol >= endCol) break;
	}

	return { text: result, width: resultWidth };
}

// ---------------------------------------------------------------------------
// extractSegments
// ---------------------------------------------------------------------------

const pooledStyleTracker = new AnsiCodeTracker();

export function extractSegments(
	line: string,
	beforeEnd: number,
	afterStart: number,
	afterLen: number,
	strictAfter = false,
): { before: string; beforeWidth: number; after: string; afterWidth: number } {
	let before = '',
		beforeWidth = 0,
		after = '',
		afterWidth = 0;
	let currentCol = 0,
		i = 0;
	let pendingAnsiBefore = '';
	let afterStarted = false;
	const afterEnd = afterStart + afterLen;

	pooledStyleTracker.clear();

	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			pooledStyleTracker.process(ansi.code);
			if (currentCol < beforeEnd) pendingAnsiBefore += ansi.code;
			else if (currentCol >= afterStart && currentCol < afterEnd && afterStarted) after += ansi.code;
			i += ansi.length;
			continue;
		}

		let textEnd = i;
		while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;

		for (const { segment } of segmenter.segment(line.slice(i, textEnd))) {
			const w = graphemeWidth(segment);
			if (currentCol < beforeEnd) {
				if (pendingAnsiBefore) {
					before += pendingAnsiBefore;
					pendingAnsiBefore = '';
				}
				before += segment;
				beforeWidth += w;
			} else if (currentCol >= afterStart && currentCol < afterEnd) {
				const fits = !strictAfter || currentCol + w <= afterEnd;
				if (fits) {
					if (!afterStarted) {
						after += pooledStyleTracker.getActiveCodes();
						afterStarted = true;
					}
					after += segment;
					afterWidth += w;
				}
			}
			currentCol += w;
			if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
		}
		i = textEnd;
		if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
	}

	return { before, beforeWidth, after, afterWidth };
}

// ---------------------------------------------------------------------------
// Stub for image dimensions (not implemented yet)
// ---------------------------------------------------------------------------

export let _cellDimensions: { widthPx: number; heightPx: number } | null = null;

export function setCellDimensions(dim: { widthPx: number; heightPx: number }): void {
	_cellDimensions = dim;
}

export function getCellDimensions(): { widthPx: number; heightPx: number } | null {
	return _cellDimensions;
}
