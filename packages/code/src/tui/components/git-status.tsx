import type { GitStatus } from '../../services/git-status.js';
import { gitElementColor, layoutGitStatus } from '../utils/git-status-layout.js';

export function GitStatusSegment(props: { cwd: string; status: GitStatus | null; maxWidth: number }) {
	if (props.maxWidth <= 0) return null;
	const elements = layoutGitStatus({
		cwd: props.cwd,
		home: process.env.HOME || process.env.USERPROFILE || '',
		status: props.status,
		maxWidth: props.maxWidth,
	});

	return (
		<box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
			{elements.map((element, index) => (
				<text key={`${element.kind}-${index}`} fg={gitElementColor(element.kind)} overflow="hidden" wrapMode="none">
					{element.text}
				</text>
			))}
		</box>
	);
}
