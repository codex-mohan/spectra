import { describe, it, expect } from 'vitest';
import {
	findEditMatch,
	applyEdit,
	replaceOnce,
	normalizeLineEndings,
	detectLineEnding,
	convertToLineEnding,
} from '../tools/edit-match.js';

describe('edit-match: line-ending helpers', () => {
	it('detects CRLF vs LF by first occurrence', () => {
		expect(detectLineEnding('a\nb')).toBe('\n');
		expect(detectLineEnding('a\r\nb')).toBe('\r\n');
		// Mixed: first occurrence wins.
		expect(detectLineEnding('a\r\nb\nc')).toBe('\r\n');
		expect(detectLineEnding('a\nb\r\nc')).toBe('\n');
	});

	it('normalises CRLF and lone CR to LF', () => {
		expect(normalizeLineEndings('a\r\nb')).toBe('a\nb');
		expect(normalizeLineEndings('a\rb')).toBe('a\nb');
		expect(normalizeLineEndings('a\nb')).toBe('a\nb');
	});

	it('converts LF text to the requested ending', () => {
		expect(convertToLineEnding('a\nb', '\n')).toBe('a\nb');
		expect(convertToLineEnding('a\nb', '\r\n')).toBe('a\r\nb');
	});
});

describe('edit-match: exact match', () => {
	it('finds a unique exact substring', () => {
		const content = 'function foo() {\n\treturn 1;\n}\n';
		const m = findEditMatch(content, '\treturn 1;');
		expect(m.ok).toBe(true);
		expect(m.index).toBe(content.indexOf('\treturn 1;'));
		expect(m.length).toBe('\treturn 1;'.length);
	});

	it('reports not-found for absent text', () => {
		const m = findEditMatch('hello world', 'goodbye');
		expect(m.ok).toBe(false);
		expect(m.error).toMatch(/Could not find/i);
	});

	it('reports ambiguous for multiple exact matches', () => {
		const content = 'const x = 1;\nconst y = 2;\nconst x = 1;\n';
		const m = findEditMatch(content, 'const x = 1;');
		expect(m.ok).toBe(false);
		expect(m.error).toMatch(/multiple matches/i);
	});
});

describe('edit-match: CRLF tolerance', () => {
	// CRLF/LF tolerance is exercised through applyEdit, which normalises the
	// oldString to the file's detected line ending BEFORE running the match
	// pipeline. That lets SimpleReplacer (exact) handle it cleanly, avoiding
	// the trailing-\r artifact that LineTrimmedReplacer would otherwise yield
	// when splitting CRLF content on \n. This mirrors opencode's flow.

	it('applyEdit matches an LF oldString against a CRLF file', () => {
		const content = 'line one\r\nline two\r\nline three\r\n';
		const { content: next, error } = applyEdit(content, 'line one\nline two\nline three', 'A\r\nB\r\nC');
		expect(error).toBeUndefined();
		expect(next).toBe('A\r\nB\r\nC\r\n');
	});

	it('applyEdit matches a CRLF oldString against an LF file', () => {
		const content = 'line one\nline two\nline three\n';
		const { content: next, error } = applyEdit(content, 'line one\r\nline two\r\nline three', 'A\nB\nC');
		expect(error).toBeUndefined();
		expect(next).toBe('A\nB\nC\n');
	});

	it('applyEdit matches a multi-line LF block against a CRLF file (the reported message.tsx case)', () => {
		const content = 'export function Foo() {\r\n\treturn <div />;\r\n}\r\n';
		const { content: next, error } = applyEdit(
			content,
			'export function Foo() {\n\treturn <div />;\n}',
			'export function Bar() {\n\treturn <span />;\n}',
		);
		expect(error).toBeUndefined();
		expect(next).toBe('export function Bar() {\r\n\treturn <span />;\r\n}\r\n');
	});

	it('applyEdit preserves CRLF in the file when newString uses LF', () => {
		const content = 'foo\r\nbar\r\nbaz\r\n';
		const { content: next, error } = applyEdit(content, 'bar', 'BAR');
		expect(error).toBeUndefined();
		expect(next).toBe('foo\r\nBAR\r\nbaz\r\n');
	});

	it('applyEdit preserves LF in the file when newString uses CRLF', () => {
		const content = 'foo\nbar\nbaz\n';
		const { content: next, error } = applyEdit(content, 'bar\r\n', 'QUUX\r\n');
		expect(error).toBeUndefined();
		// Detected ending is LF; newString CRLFs are normalised down to LF.
		expect(next).toBe('foo\nQUUX\nbaz\n');
	});
});

describe('edit-match: tab vs space tolerance (reported bug)', () => {
	// The reported failure: a deeply tab-indented .tsx file, agent's oldString
	// arrives with tabs turned into spaces somewhere in the parameter pipeline.
	it('matches space-indented oldString against tab-indented file (LineTrimmed)', () => {
		const content = 'export function Foo() {\n\treturn (\n\t\t<div>\n\t\t\t<span>hi</span>\n\t\t</div>\n\t);\n}\n';
		// oldString uses 4-space indentation per level instead of tabs.
		const oldString = '        <span>hi</span>';
		const m = findEditMatch(content, oldString);
		expect(m.ok).toBe(true);
		// The matched span is the file's real tab bytes.
		expect(content.slice(m.index!, m.index! + m.length!)).toBe('\t\t\t<span>hi</span>');
	});

	it('matches tab-indented oldString against space-indented file (LineTrimmed)', () => {
		const content = '    foo()\n    bar()\n';
		const m = findEditMatch(content, '\tfoo()');
		expect(m.ok).toBe(true);
		expect(content.slice(m.index!, m.index! + m.length!)).toBe('    foo()');
	});

	it('matches a multi-line tab-indented block against space-indented oldString', () => {
		const content = 'if (x) {\n\t\tdoA();\n\t\tdoB();\n\t}\n';
		const oldString = '        doA();\n        doB();';
		const m = findEditMatch(content, oldString);
		expect(m.ok).toBe(true);
		expect(content.slice(m.index!, m.index! + m.length!)).toBe('\t\tdoA();\n\t\tdoB();');
	});
});

describe('edit-match: whitespace-normalised strategy', () => {
	it('collapses internal whitespace runs when matching a single line', () => {
		const content = 'const   x     =   1;\n';
		const m = findEditMatch(content, 'const x = 1;');
		expect(m.ok).toBe(true);
		expect(content.slice(m.index!, m.index! + m.length!)).toBe('const   x     =   1;');
	});

	it('matches multi-line block ignoring inter-line whitespace differences', () => {
		// WhitespaceNormalizedReplacer's multi-line branch yields whole file
		// lines (including any leading indent), so the span is the full matched
		// block, not a substring trimmed to the search's start column.
		const content = '  a  b\n   c   d\n';
		const m = findEditMatch(content, 'a b\nc d');
		expect(m.ok).toBe(true);
		expect(content.slice(m.index!, m.index! + m.length!)).toBe('  a  b\n   c   d');
	});
});

describe('edit-match: indentation-flexible strategy', () => {
	it('matches a block shifted by a different common indent', () => {
		const content = 'function outer() {\n\t\tfunction inner() {\n\t\t\treturn 0;\n\t\t}\n\t}\n';
		const oldString = 'function inner() {\n\t\treturn 0;\n\t}';
		// oldString has 1-level indent; file has 2-level. Strip common indent
		// from both and the de-indented bodies match.
		const m = findEditMatch(content, oldString);
		expect(m.ok).toBe(true);
		expect(content.slice(m.index!, m.index! + m.length!)).toBe(
			'\t\tfunction inner() {\n\t\t\treturn 0;\n\t\t}',
		);
	});
});

describe('edit-match: escape-normalised strategy', () => {
	it('unescapes literal \\n / \\t sequences emitted by the model', () => {
		const content = 'console.log("a\tb");\n';
		// Model emitted literal backslash-t instead of a tab character.
		const m = findEditMatch(content, 'console.log("a\\tb");');
		expect(m.ok).toBe(true);
		expect(content.slice(m.index!, m.index! + m.length!)).toBe('console.log("a\tb");');
	});
});

describe('edit-match: trimmed-boundary strategy', () => {
	it('matches a search with surrounding whitespace against trimmed core', () => {
		const content = 'function foo() { return 1; }\n';
		const m = findEditMatch(content, '   foo() { return 1; }   ');
		expect(m.ok).toBe(true);
		expect(content.slice(m.index!, m.index! + m.length!)).toBe('foo() { return 1; }');
	});
});

describe('edit-match: block-anchor fuzzy strategy', () => {
	it('locates a 3+ line block via first/last anchors with garbled middle', () => {
		const content = [
			'export function foo() {',
			'  const result = computeSomethingVerySpecific(1, 2, 3);',
			'  return result;',
			'}',
		].join('\n');
		// Search with a typo in the middle line; anchors at top and bottom match.
		const oldString = [
			'export function foo() {',
			'  const result = computeSomethingSlightlyDifferent();',
			'  return result;',
			'}',
		].join('\n');
		const m = findEditMatch(content, oldString);
		expect(m.ok).toBe(true);
	});

	it('skips block-anchor when there are fewer than 3 search lines', () => {
		// A 2-line search cannot use the anchor strategy; it should fail cleanly
		// rather than crash, since no other strategy can match a typo.
		const content = 'first line\nsecond line\n';
		const m = findEditMatch(content, 'first line\ntotally different');
		expect(m.ok).toBe(false);
	});
});

describe('edit-match: context-aware strategy', () => {
	it('matches when >=50% of non-empty middle lines agree', () => {
		const content = [
			'def hello():',
			'    print("hi")',
			'    x = 1',
			'    y = 2',
			'    return x + y',
		].join('\n');
		const oldString = [
			'def hello():',
			'    print("hi")',
			'    x = 1',
			'    z = 99',
			'    return x + y',
		].join('\n');
		const m = findEditMatch(content, oldString);
		expect(m.ok).toBe(true);
	});
});

describe('edit-match: multi-occurrence (replaceOnce semantics)', () => {
	it('findEditMatch is ambiguous for a repeated substring', () => {
		const content = 'TODO: fix\nTODO: fix\n';
		const m = findEditMatch(content, 'TODO: fix');
		// Without a uniqueness guarantee, the pipeline reports multiple matches.
		expect(m.ok).toBe(false);
		expect(m.error).toMatch(/multiple matches/i);
	});

	it('replaceOnce throws on ambiguous match', () => {
		const content = 'dup\ndup\n';
		expect(() => replaceOnce(content, 'dup', 'x')).toThrow(/multiple matches/i);
	});
});

describe('edit-match: applyEdit edge cases', () => {
	it('returns a no-change error when newString equals the matched text', () => {
		const content = 'hello world\n';
		const { error, content: next } = applyEdit(content, 'hello', 'hello');
		expect(error).toMatch(/no changes/i);
		expect(next).toBeUndefined();
	});

	it('errors on not-found', () => {
		const { error, content: next } = applyEdit('foo\n', 'bar', 'baz');
		expect(error).toMatch(/could not find/i);
		expect(next).toBeUndefined();
	});

	it('applies a clean edit and returns the spliced content', () => {
		const content = 'alpha\nbeta\ngamma\n';
		const { content: next, error } = applyEdit(content, 'beta', 'BETA');
		expect(error).toBeUndefined();
		expect(next).toBe('alpha\nBETA\ngamma\n');
	});
});
