import * as path from 'node:path';

const MIN_SUMMARY_LINES = 300;
const MIN_BODY_LINES = 8;

type SyntaxNode = { type: string; startPosition: { row: number }; endPosition: { row: number }; childCount: number; child(index: number): SyntaxNode | null; hasError: boolean };
type SyntaxTree = { rootNode: SyntaxNode };
type SyntaxParser = { setLanguage(language: unknown): void; parse(source: string): SyntaxTree };

export interface StructuralSummary {
	content: string;
	elidedRanges: Array<{ start: number; end: number }>;
}

function languageFor(filePath: string): unknown {
	const extension = path.extname(filePath).toLowerCase();
	const moduleByExtension: Record<string, string> = {
		'.ts': 'tree-sitter-typescript', '.tsx': 'tree-sitter-typescript', '.js': 'tree-sitter-javascript', '.jsx': 'tree-sitter-javascript', '.py': 'tree-sitter-python', '.rs': 'tree-sitter-rust', '.go': 'tree-sitter-go', '.java': 'tree-sitter-java', '.c': 'tree-sitter-c', '.h': 'tree-sitter-c', '.cc': 'tree-sitter-cpp', '.cpp': 'tree-sitter-cpp', '.cs': 'tree-sitter-c-sharp', '.php': 'tree-sitter-php', '.rb': 'tree-sitter-ruby', '.sh': 'tree-sitter-bash', '.bash': 'tree-sitter-bash', '.sql': 'tree-sitter-sql', '.json': 'tree-sitter-json', '.html': 'tree-sitter-html', '.css': 'tree-sitter-css',
	};
	const packageName = moduleByExtension[extension];
	if (!packageName) return undefined;
	const grammar = require(packageName) as Record<string, unknown>;
	if (packageName === 'tree-sitter-typescript') return extension === '.tsx' ? grammar.tsx : grammar.typescript;
	if (packageName === 'tree-sitter-php') return grammar.php ?? grammar;
	return grammar.default ?? grammar;
}

function collectElisions(node: SyntaxNode, ranges: Array<{ start: number; end: number }>): void {
	const start = node.startPosition.row + 1;
	const end = node.endPosition.row + 1;
	const bodyLike = /(?:body|block|statement_block|compound_statement|class_body|object|array|comment|argument_list|parameters)/.test(node.type);
	if (bodyLike && end - start - 1 >= MIN_BODY_LINES) {
		ranges.push({ start: start + 1, end: end - 1 });
		return;
	}
	for (let index = 0; index < node.childCount; index++) {
		const child = node.child(index);
		if (child) collectElisions(child, ranges);
	}
}

export function summarizeSource(content: string, filePath: string): StructuralSummary | undefined {
	const lines = content.split('\n');
	if (lines.length < MIN_SUMMARY_LINES) return undefined;
	const language = languageFor(filePath);
	if (!language) return undefined;
	const Parser = require('tree-sitter') as new () => SyntaxParser;
	const parser = new Parser();
	parser.setLanguage(language);
	const tree = parser.parse(content);
	if (tree.rootNode.hasError) return undefined;
	const elidedRanges: Array<{ start: number; end: number }> = [];
	collectElisions(tree.rootNode, elidedRanges);
	const nonOverlapping = elidedRanges.sort((left, right) => left.start - right.start).filter((range, index, ranges) => index === 0 || range.start > ranges[index - 1].end);
	if (nonOverlapping.length === 0) return undefined;
	const ranges = new Map(nonOverlapping.map((range) => [range.start, range]));
	const rendered: string[] = [];
	for (let line = 1; line <= lines.length; line++) {
		const range = ranges.get(line);
		if (range) {
			rendered.push(`${range.start}-${range.end}: …`);
			line = range.end;
			continue;
		}
		rendered.push(`${line}:${lines[line - 1]}`);
	}
	const example = nonOverlapping.slice(0, 2).map((range) => `${range.start}-${range.end}`).join(',');
	const totalElided = nonOverlapping.reduce((total, range) => total + range.end - range.start + 1, 0);
	rendered.push(`[${totalElided} lines elided; re-read required ranges with ${filePath}:${example}]`);
	return { content: rendered.join('\n'), elidedRanges: nonOverlapping };
}
