import { useMemo } from 'react';
import { c } from './theme.js';

const TIPS = [
	'Type {highlight}:q{/highlight} to exit Spectra Code',
	'Press {highlight}Tab{/highlight} to cycle between Build, Plan, Debug, and Explore agents',
	'Press {highlight}Ctrl+P{/highlight} to open the command palette',
	'Press {highlight}Ctrl+L{/highlight} to clear the conversation',
	'Use {highlight}Esc{/highlight} to stop the AI mid-response or go back',
	'Switch to {highlight}Plan{/highlight} agent to get suggestions without making changes',
	"Commit your project's {highlight}AGENTS.md{/highlight} file to Git for team-wide instructions",
	'Run {highlight}spectra doctor{/highlight} from CLI to check system health',
	'Press {highlight}↑{/highlight} to edit your last message',
	'Run {highlight}spectra session list{/highlight} to browse all conversations',
	'Use {highlight}Ctrl+P{/highlight} → {highlight}doctor{/highlight} to run a health check from the TUI',
	'Add {highlight}.spectra/{/highlight} to your project for project-level config',
];

function parse(tip: string): { text: string; highlight: boolean }[] {
	const parts: { text: string; highlight: boolean }[] = [];
	const regex = /\{highlight\}(.*?)\{\/highlight\}/g;
	let last = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(tip)) !== null) {
		if (match.index > last) parts.push({ text: tip.slice(last, match.index), highlight: false });
		parts.push({ text: match[1], highlight: true });
		last = match.index + match[0].length;
	}
	if (last < tip.length) parts.push({ text: tip.slice(last), highlight: false });
	return parts;
}

export function Tips() {
	const parts = useMemo(() => {
		const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
		return parse(tip);
	}, []);

	return (
		<box height={1} paddingTop={1} flexDirection="row" gap={1}>
			<text fg={c.warn}>{'\u25CF'}</text>
			<text fg={c.dim}>Tip</text>
			{parts.map((p, i) => (
				<text key={i} fg={p.highlight ? c.text : c.dim}>
					{p.text}
				</text>
			))}
		</box>
	);
}
