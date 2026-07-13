import { useState, useEffect, useMemo, useRef } from 'react';
import { c } from '../theme.js';
import { resolveAgentAccentColor } from '../utils/agent-color.js';
import type { AgentDefinition } from '../../agents/index.js';
import { titlecase } from '../utils.js';

export interface AgentSwitcherProps {
	currentAgent: string;
	primaryAgents: string[];
	definitions: Record<string, AgentDefinition>;
	termWidth: number;
	termHeight: number;
	onAgentSelected: (agent: string) => void;
	onClose: () => void;
	registerHandler: (fn: ((key: unknown) => void) | null) => void;
}

export function AgentSwitcher(props: AgentSwitcherProps) {
	const { currentAgent, primaryAgents, definitions, termWidth, termHeight, onAgentSelected, onClose, registerHandler } = props;
	const [filter, setFilter] = useState('');
	const [sel, setSel] = useState(0);
	const scrollRef = useRef<{ scrollChildIntoView?: (id: string) => void } | null>(null);

	const mw = Math.min(56, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = Math.min(16, termHeight - 4);
	const mt = Math.max(1, Math.floor((termHeight - mh) / 2));
	const innerW = mw - 4;
	const listH = mh - 6;

	const items = useMemo(() => {
		return primaryAgents.map((name) => ({
			name,
			def: definitions[name],
		}));
	}, [primaryAgents, definitions]);

	const filtered = useMemo(() => {
		if (!filter) return items.map((i, idx) => ({ ...i, idx }));
		const q = filter.toLowerCase();
		return items
			.map((i, idx) => ({ ...i, idx }))
			.filter((i) => i.name.includes(q) || i.def?.description.toLowerCase().includes(q));
	}, [items, filter]);

	useEffect(() => {
		registerHandler((rawKey: unknown) => {
			const key = rawKey && typeof rawKey === 'object' && 'name' in rawKey
				? (rawKey as { name?: string })
				: {};
			if (key.name === 'up') {
				setSel((s) => Math.max(0, s - 1));
				return;
			}
			if (key.name === 'down') {
				setSel((s) => Math.min(filtered.length - 1, s + 1));
				return;
			}
			if (key.name === 'return' || key.name === 'enter') {
				if (filtered[sel]) onAgentSelected(filtered[sel].name);
				return;
			}
			if (key.name === 'escape') {
				onClose();
				return;
			}
			if (key.name === 'backspace') {
				setFilter((f) => f.slice(0, -1));
				setSel(0);
				return;
			}
			if (key.name?.length === 1) {
				setFilter((f) => f + key.name);
				setSel(0);
				return;
			}
		});
		return () => registerHandler(null);
	}, [filtered, sel, onAgentSelected, onClose, registerHandler]);

	useEffect(() => {
		if (scrollRef.current && filtered[sel]) {
			const el = scrollRef.current;
			if (typeof el.scrollChildIntoView === 'function') {
				el.scrollChildIntoView(`agent-${filtered[sel].name}`);
			}
		}
	}, [sel, filtered]);

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box
					height={1}
					paddingX={2}
					paddingTop={1}
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
				>
					<box flexDirection="row" gap={1} alignItems="center">
						<text fg={c.accent}>{'>'}</text>
						<text fg={c.text}>{filter || 'Type to filter...'}</text>
					</box>
					<box height={1}>
						<text fg={c.dim}>esc</text>
					</box>
				</box>
				<box height={1} />
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<scrollbox
					ref={(r: any) => {
						scrollRef.current = r;
					}}
					paddingX={1}
					maxHeight={listH}
					scrollY={true}
					scrollbarOptions={{ visible: false }}
				>
					<box flexDirection="column">
						{filtered.length === 0 ? (
							<box height={1} paddingX={1}>
								<text fg={c.dim}>No matching agents</text>
							</box>
						) : (
							filtered.map((item, i) => {
								const isSelected = i === sel;
								const isCurrent = item.name === currentAgent;
								return (
									<box
										key={item.name}
										id={`agent-${item.name}`}
										height={2}
										paddingLeft={2}
										paddingRight={1}
										backgroundColor={isSelected ? c.bgSelect : c.bgCard}
									>
										<box flexDirection="row" alignItems="center" gap={1}>
											<text fg={resolveAgentAccentColor(item.def?.color)}>{isCurrent ? '●' : '○'}</text>
											<text fg={isSelected ? c.accent : isCurrent ? c.text : c.dim}>
												{titlecase(item.name)}
											</text>
										</box>
										<text fg={c.dim} overflow="hidden" wrapMode="none">
											{item.def?.description}
										</text>
									</box>
								);
							})
						)}
					</box>
				</scrollbox>
				<box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center">
					<text fg={c.dim}>
						{'\u2191\u2193'} navigate · {'\u23CE'} select · esc close
					</text>
				</box>
			</box>
		</box>
	);
}
