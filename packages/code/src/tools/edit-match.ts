/**
 * Whitespace-tolerant find-and-replace matching for the edit tool.
 *
 * The edit tool's oldString parameter can arrive with whitespace that doesn't
 * exactly match the file's bytes — common cases are tabs normalised to spaces
 * and \r\n normalised to \n somewhere in the parameter pipeline. Exact substring
 * matching then fails even though the visible content is identical.
 *
 * The approach runs a pipeline of replacers, each yielding candidate substrings
 * that are guaranteed to exist verbatim in the file. The driver re-locates each
 * candidate in the original content and splices the file's actual bytes — never
 * the caller's oldString — so the file's real indentation and line endings are
 * what get removed.
 */
export type LineEnding = '\n' | '\r\n';

/** Normalize CRLF (and lone CR) down to LF. */
export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Detect a file's dominant line ending by first occurrence. */
export function detectLineEnding(text: string): LineEnding {
	const crlfIdx = text.indexOf('\r\n');
	const lfIdx = text.indexOf('\n');
	if (lfIdx === -1) return '\n';
	if (crlfIdx === -1) return '\n';
	return crlfIdx < lfIdx ? '\r\n' : '\n';
}

/** Convert a (LF-normalised) string to the given line ending. */
export function convertToLineEnding(text: string, ending: LineEnding): string {
	if (ending === '\n') return text;
	return text.replaceAll('\n', '\r\n');
}

export interface MatchResult {
	/** True when a unique match was located. */
	ok: boolean;
	/** Byte offset of the matched span in the ORIGINAL file content. */
	index?: number;
	/** Length of the ACTUAL matched span in the file (not the caller's oldString). */
	length?: number;
	/** Human-readable reason when ok is false. */
	error?: string;
}

/**
 * A replacer yields candidate substrings that are guaranteed to exist verbatim
 * in `content`. Each candidate is re-located by the driver with indexOf so the
 * spliced span is always the file's real bytes.
 */
type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

/** Similarity threshold for block-anchor matching when only one candidate is found. */
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
/** Similarity threshold for block-anchor matching when multiple candidates are found. */
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

/** Standard Levenshtein edit distance. */
function levenshtein(a: string, b: string): number {
	if (a === '' || b === '') {
		return Math.max(a.length, b.length);
	}
	const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
	);

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1,
				matrix[i][j - 1] + 1,
				matrix[i - 1][j - 1] + cost,
			);
		}
	}
	return matrix[a.length][b.length];
}

/** Sum the byte offset of the start of line `lineIndex` (newline = 1 char). */
function lineStartOffset(lines: string[], lineIndex: number): number {
	let offset = 0;
	for (let k = 0; k < lineIndex; k++) {
		offset += lines[k].length + 1;
	}
	return offset;
}

/** Span (start, end) for lines [startLine..endLine] inclusive, joined by \n. */
function lineSpanOffsets(lines: string[], startLine: number, endLine: number): { start: number; end: number } {
	const start = lineStartOffset(lines, startLine);
	let end = start;
	for (let k = startLine; k <= endLine; k++) {
		end += lines[k].length;
		if (k < endLine) end += 1;
	}
	return { start, end };
}

/** Strategy 0: exact substring. Yields the search string back verbatim. */
const SimpleReplacer: Replacer = function* (_content, find) {
	yield find;
};

/**
 * Strategy 1: compare line-by-line by trimmed content. Tolerates tabs-vs-spaces
 * and mixed indentation. Yields the file's actual span (original bytes).
 */
const LineTrimmedReplacer: Replacer = function* (content, find) {
	const originalLines = content.split('\n');
	const searchLines = find.split('\n');

	if (searchLines[searchLines.length - 1] === '') {
		searchLines.pop();
	}

	for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
		let matches = true;
		for (let j = 0; j < searchLines.length; j++) {
			if (originalLines[i + j].trim() !== searchLines[j].trim()) {
				matches = false;
				break;
			}
		}

		if (matches) {
			const { start, end } = lineSpanOffsets(originalLines, i, i + searchLines.length - 1);
			yield content.substring(start, end);
		}
	}
};

/**
 * Strategy 2: anchor on the first and last trimmed line, then score middle lines
 * by Levenshtein similarity. Rescues matches where the model garbled inner lines.
 * Only applies to searches of 3+ lines.
 */
const BlockAnchorReplacer: Replacer = function* (content, find) {
	const originalLines = content.split('\n');
	const searchLines = find.split('\n');

	if (searchLines.length < 3) return;

	if (searchLines[searchLines.length - 1] === '') {
		searchLines.pop();
	}

	const firstLineSearch = searchLines[0].trim();
	const lastLineSearch = searchLines[searchLines.length - 1].trim();
	const searchBlockSize = searchLines.length;

	// Collect all candidate positions where both anchors match.
	const candidates: Array<{ startLine: number; endLine: number }> = [];
	for (let i = 0; i < originalLines.length; i++) {
		if (originalLines[i].trim() !== firstLineSearch) continue;
		for (let j = i + 2; j < originalLines.length; j++) {
			if (originalLines[j].trim() === lastLineSearch) {
				candidates.push({ startLine: i, endLine: j });
				break;
			}
		}
	}

	if (candidates.length === 0) return;

	const scoreMiddle = (startLine: number, endLine: number): number => {
		const actualBlockSize = endLine - startLine + 1;
		const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);
		if (linesToCheck <= 0) return 1.0;

		let similarity = 0;
		for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
			const originalLine = originalLines[startLine + j].trim();
			const searchLine = searchLines[j].trim();
			const maxLen = Math.max(originalLine.length, searchLine.length);
			if (maxLen === 0) continue;
			similarity += 1 - levenshtein(originalLine, searchLine) / maxLen;
		}
		return similarity / linesToCheck;
	};

	// Single candidate: relaxed threshold (any non-negative similarity).
	if (candidates.length === 1) {
		const { startLine, endLine } = candidates[0];
		let similarity = 0;
		const actualBlockSize = endLine - startLine + 1;
		const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);
		if (linesToCheck > 0) {
			for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
				const originalLine = originalLines[startLine + j].trim();
				const searchLine = searchLines[j].trim();
				const maxLen = Math.max(originalLine.length, searchLine.length);
				if (maxLen === 0) continue;
				similarity += (1 - levenshtein(originalLine, searchLine) / maxLen) / linesToCheck;
				if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) break;
			}
		} else {
			similarity = 1.0;
		}

		if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
			const { start, end } = lineSpanOffsets(originalLines, startLine, endLine);
			yield content.substring(start, end);
		}
		return;
	}

	// Multiple candidates: pick the highest-scoring one if it clears the bar.
	let bestMatch: { startLine: number; endLine: number } | null = null;
	let maxSimilarity = -1;
	for (const candidate of candidates) {
		const similarity = scoreMiddle(candidate.startLine, candidate.endLine);
		if (similarity > maxSimilarity) {
			maxSimilarity = similarity;
			bestMatch = candidate;
		}
	}

	if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
		const { start, end } = lineSpanOffsets(originalLines, bestMatch.startLine, bestMatch.endLine);
		yield content.substring(start, end);
	}
};

/**
 * Strategy 3: collapse all whitespace runs to single spaces, then match. Handles
 * intra-line whitespace differences for single lines and multi-line blocks.
 */
const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
	const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();
	const normalizedFind = normalizeWhitespace(find);

	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (normalizeWhitespace(line) === normalizedFind) {
			yield line;
		} else {
			const normalizedLine = normalizeWhitespace(line);
			if (normalizedLine.includes(normalizedFind)) {
				const words = find.trim().split(/\s+/);
				if (words.length > 0) {
					const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
					try {
						const regex = new RegExp(pattern);
						const match = line.match(regex);
						if (match) yield match[0];
					} catch {
						// Invalid regex pattern, skip.
					}
				}
			}
		}
	}

	const findLines = find.split('\n');
	if (findLines.length > 1) {
		for (let i = 0; i <= lines.length - findLines.length; i++) {
			const block = lines.slice(i, i + findLines.length);
			if (normalizeWhitespace(block.join('\n')) === normalizedFind) {
				yield block.join('\n');
			}
		}
	}
};

/**
 * Strategy 4: strip the minimum common leading indent from both sides, then match.
 * Lets a search block match regardless of how far it was shifted left or right.
 */
const IndentationFlexibleReplacer: Replacer = function* (content, find) {
	const removeIndentation = (text: string) => {
		const lines = text.split('\n');
		const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
		if (nonEmptyLines.length === 0) return text;

		const minIndent = Math.min(
			...nonEmptyLines.map((line) => {
				const match = line.match(/^(\s*)/);
				return match ? match[1].length : 0;
			}),
		);

		return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join('\n');
	};

	const normalizedFind = removeIndentation(find);
	const contentLines = content.split('\n');
	const findLines = find.split('\n');

	for (let i = 0; i <= contentLines.length - findLines.length; i++) {
		const block = contentLines.slice(i, i + findLines.length).join('\n');
		if (removeIndentation(block) === normalizedFind) {
			yield block;
		}
	}
};

/**
 * Strategy 5: unescape literal \n / \t / \\ sequences a model may have emitted,
 * then match. Handles the case where escapes weren't interpreted by the pipeline.
 */
const EscapeNormalizedReplacer: Replacer = function* (content, find) {
	const unescapeString = (str: string): string => {
		return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar: string) => {
			switch (capturedChar) {
				case 'n':
					return '\n';
				case 't':
					return '\t';
				case 'r':
					return '\r';
				case "'":
					return "'";
				case '"':
					return '"';
				case '`':
					return '`';
				case '\\':
					return '\\';
				case '\n':
					return '\n';
				case '$':
					return '$';
				default:
					return match;
			}
		});
	};

	const unescapedFind = unescapeString(find);

	if (content.includes(unescapedFind)) {
		yield unescapedFind;
	}

	const lines = content.split('\n');
	const findLines = unescapedFind.split('\n');

	for (let i = 0; i <= lines.length - findLines.length; i++) {
		const block = lines.slice(i, i + findLines.length).join('\n');
		if (unescapeString(block) === unescapedFind) {
			yield block;
		}
	}
};

/**
 * Strategy 6: if the search has surrounding whitespace, try matching just the
 * trimmed core, or a file block whose trim() equals the trimmed search.
 */
const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
	const trimmedFind = find.trim();
	if (trimmedFind === find) return;

	if (content.includes(trimmedFind)) {
		yield trimmedFind;
	}

	const lines = content.split('\n');
	const findLines = find.split('\n');
	for (let i = 0; i <= lines.length - findLines.length; i++) {
		const block = lines.slice(i, i + findLines.length).join('\n');
		if (block.trim() === trimmedFind) {
			yield block;
		}
	}
};

/**
 * Strategy 7: anchor on the first and last trimmed line of a 3+ line search,
 * then accept if >=50% of non-empty middle lines match when trimmed.
 */
const ContextAwareReplacer: Replacer = function* (content, find) {
	const findLines = find.split('\n');
	if (findLines.length < 3) return;

	if (findLines[findLines.length - 1] === '') {
		findLines.pop();
	}

	const contentLines = content.split('\n');
	const firstLine = findLines[0].trim();
	const lastLine = findLines[findLines.length - 1].trim();

	for (let i = 0; i < contentLines.length; i++) {
		if (contentLines[i].trim() !== firstLine) continue;

		for (let j = i + 2; j < contentLines.length; j++) {
			if (contentLines[j].trim() === lastLine) {
				const blockLines = contentLines.slice(i, j + 1);
				const block = blockLines.join('\n');

				if (blockLines.length === findLines.length) {
					let matchingLines = 0;
					let totalNonEmptyLines = 0;

					for (let k = 1; k < blockLines.length - 1; k++) {
						const blockLine = blockLines[k].trim();
						const searchLine = findLines[k].trim();

						if (blockLine.length > 0 || searchLine.length > 0) {
							totalNonEmptyLines++;
							if (blockLine === searchLine) {
								matchingLines++;
							}
						}
					}

					if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
						yield block;
						break;
					}
				}
				break;
			}
		}
	}
};

/** Strategy 8: yields every exact occurrence so the driver can replace them all. */
const MultiOccurrenceReplacer: Replacer = function* (content, find) {
	let startIndex = 0;
	while (true) {
		const index = content.indexOf(find, startIndex);
		if (index === -1) break;
		yield find;
		startIndex = index + find.length;
	}
};

const REPLACERS: Replacer[] = [
	SimpleReplacer,
	LineTrimmedReplacer,
	BlockAnchorReplacer,
	WhitespaceNormalizedReplacer,
	IndentationFlexibleReplacer,
	EscapeNormalizedReplacer,
	TrimmedBoundaryReplacer,
	ContextAwareReplacer,
	MultiOccurrenceReplacer,
];

/**
 * Locate the byte span of `oldString` in `content` using a tolerant pipeline.
 *
 * The first strategy that yields a UNIQUE candidate wins. If a strategy yields
 * only ambiguous candidates, later strategies are tried. Returns offsets into
 * the ORIGINAL content (never the caller's oldString), so splicing removes the
 * file's actual bytes.
 */
export function findEditMatch(content: string, oldString: string): MatchResult {
	let notFound = true;

	for (const replacer of REPLACERS) {
		for (const search of replacer(content, oldString)) {
			const index = content.indexOf(search);
			if (index === -1) continue;
			notFound = false;
			const lastIndex = content.lastIndexOf(search);
			if (index !== lastIndex) continue;
			return { ok: true, index, length: search.length };
		}
	}

	if (notFound) {
		return {
			ok: false,
			error:
				'Could not find the specified text in the file. It must match including whitespace and indentation. Try reading the file first and copying the exact bytes.',
		};
	}
	return {
		ok: false,
		error: 'Found multiple matches for the specified text. Include more surrounding context to make the match unique.',
	};
}

/**
 * Convenience: locate the match and return the spliced result.
 *
 * Throws on failure (no match / ambiguous). The caller is expected to normalise
 * line endings on `newString` before calling — or use {@link applyEdit} which
 * does it for you.
 */
export function replaceOnce(content: string, oldString: string, newString: string): string {
	const match = findEditMatch(content, oldString);
	if (!match.ok || match.index === undefined || match.length === undefined) {
		throw new Error(match.error ?? 'edit match failed');
	}
	return content.slice(0, match.index) + newString + content.slice(match.index + match.length);
}

/**
 * Locate the match, splice the replacement, and preserve the file's line ending
 * in the inserted text. This is the high-level helper the edit tool uses.
 *
 * Returns `{ content: newFileContents, error?: string }`. On failure `content`
 * is undefined and `error` describes why.
 */
export function applyEdit(
	content: string,
	oldString: string,
	newString: string,
): { content?: string; error?: string } {
	const ending = detectLineEnding(content);
	const normalizedOld = convertToLineEnding(normalizeLineEndings(oldString), ending);
	const normalizedNew = convertToLineEnding(normalizeLineEndings(newString), ending);

	const match = findEditMatch(content, normalizedOld);
	if (!match.ok || match.index === undefined || match.length === undefined) {
		return { error: match.error };
	}

	const next =
		content.slice(0, match.index) + normalizedNew + content.slice(match.index + match.length);

	if (next === content) {
		return { error: "No changes made - the replacement didn't modify the file." };
	}

	return { content: next };
}
