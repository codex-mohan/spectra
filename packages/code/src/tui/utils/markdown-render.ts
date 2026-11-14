import { renderMermaidASCII } from 'beautiful-mermaid';
import { renderMathInText } from './math.js';

const MAX_DIAGRAM_SOURCE = 20_000;

function renderMermaidBlocks(source: string): string {
	return source.replace(/```([A-Za-z0-9_-]*)\r?\n([\s\S]*?)```/g, (block, language: string, body: string) => {
		if (language.toLowerCase() !== 'mermaid') return block;
		if (body.length > MAX_DIAGRAM_SOURCE) return block;
		try {
			const ascii = renderMermaidASCII(body, { useAscii: false, colorMode: 'none' }).trimEnd();
			if (!ascii) return block;
			return `\`\`\`\n${ascii}\n\`\`\``;
		} catch {
			return block;
		}
	});
}

/** Prepare model-authored markdown: Mermaid fences to ASCII, then LaTeX spans to Unicode. */
export function prepareMarkdown(source: string): string {
	return renderMathInText(renderMermaidBlocks(source));
}
