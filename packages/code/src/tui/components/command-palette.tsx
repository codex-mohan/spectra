import { useRef, useEffect, useMemo } from 'react';
import { c } from '../theme.js';

export interface CmdItem {
	id: string;
	label: string;
	desc: string;
	cat?: string;
	action: () => void;
	slashName?: string;
	slashAliases?: string[];
}

export interface CommandPaletteProps {
	filter: string;
	selected: number;
	items: CmdItem[];
	termWidth: number;
	termHeight: number;
}

export function CommandPalette(props: CommandPaletteProps) {
	const { filter, selected, items, termWidth, termHeight } = props;
	const scrollRef = useRef<any>(null);

	const mw = Math.min(64, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = Math.min(22, termHeight - 4);
	const mt = Math.max(1, Math.floor((termHeight - mh) / 2));
	const innerW = mw - 4;
	const listH = mh - 5;

	const rows = useMemo(() => {
		const r: any[] = [];
		let prevCat = '';
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.cat && item.cat !== prevCat) {
				if (prevCat) {
					r.push(<box key={`gap-${i}`} height={1} backgroundColor={c.bgCard} />);
				}
				prevCat = item.cat;
				r.push(
					<box key={`cat-${i}`} height={1} paddingLeft={2} backgroundColor={c.bgCard}>
						<text fg={c.warn} attributes={1}>
							{item.cat}
						</text>
					</box>,
				);
			}
			const isSelected = i === selected;
			r.push(
				<box
					key={item.id}
					id={item.id}
					height={1}
					paddingLeft={2}
					paddingRight={1}
					backgroundColor={isSelected ? c.bgSelect : c.bgCard}
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
				>
					<text fg={isSelected ? c.accent : c.text} overflow="hidden" wrapMode="none" flexGrow={1}>
						{item.label}
					</text>
					<text fg={c.dim} flexShrink={0}>
						{item.desc}
					</text>
				</box>,
			);
		}
		return r;
	}, [items, selected]);

	useEffect(() => {
		if (!scrollRef.current || !items[selected]) return;
		const el = scrollRef.current;
		if (typeof el.scrollChildIntoView === 'function') {
			el.scrollChildIntoView(items[selected].id);
		} else {
			const child = el.getChildren?.()?.find?.((ch: any) => ch.id === items[selected].id);
			if (child) {
				const y = child.y - (el.y || 0);
				if (y >= (el.height || listH)) el.scrollBy?.(y - (el.height || listH) + 1);
				if (y < 0) el.scrollBy?.(y);
			}
		}
	}, [selected, items, listH]);

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
					<box flexDirection="row" height={1}>
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
						{rows.length === 0 ? (
							<box height={1} paddingX={1} backgroundColor={c.bgCard}>
								<text fg={c.dim}>No matching commands</text>
							</box>
						) : (
							rows
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
