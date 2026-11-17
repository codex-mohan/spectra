import { c, mdStyle, mdStyleMuted } from '../theme.js';
import React from 'react';
import { prepareMarkdown, splitComplexBlocks } from '../utils/markdown-render.js';

interface MarkdownContentProps {
	content: string;
	muted?: boolean;
	streaming?: boolean;
	marginTop?: number;
}

/**
 * Markdown with a preformatted fallback for code blocks containing scripts
 * whose terminal cell width OpenTUI mismeasures (Tamil, Arabic, CJK, …).
 */
export function MarkdownContent({ content, muted = false, streaming = false, marginTop }: MarkdownContentProps) {
	const segments = splitComplexBlocks(content);
	return (
		<box flexDirection="column" marginTop={marginTop}>
			{segments.map((segment, index) => segment.kind === 'pre' ? (
				<box key={`pre-${index}`} backgroundColor={c.bg} paddingLeft={0}>
					<text fg={muted ? c.dim : c.text} wrapMode="none" overflow="hidden">{segment.text}</text>
				</box>
			) : (
				<markdown
					key={`md-${index}`}
					content={prepareMarkdown(segment.text, { streaming })}
					syntaxStyle={muted ? mdStyleMuted : mdStyle}
					streaming={streaming}
					conceal={true}
					width="100%"
					tableOptions={{ style: 'grid', borders: true, borderStyle: 'single' }}
				/>
			))}
		</box>
	);
}
