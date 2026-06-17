import { useRef, useEffect, useMemo } from 'react';
import { c } from '../theme.js';
import type { CmdItem } from './command-palette.js';

export interface SlashAutocompleteProps {
	query: string;
	selected: number;
	items: CmdItem[];
	termWidth: number;
	termHeight: number;
	route: 'home' | 'chat';
	promptTop?: number;
	promptLeft?: number;
	promptWidth?: number;
}

// Visible-row budget for the list window. Unlike the command palette (a centered
// modal with lots of vertical room), this menu floats directly above the prompt
// and grows upward — so the window must be clamped to the space actually
// available above the prompt, not a flat cap. The scrollbox then handles any
// overflow beyond the window.
const MAX_LIST_ROWS = 8;
const MIN_LIST_ROWS = 3;
const MENU_CHROME = 3; // header + divider + footer rows surrounding the list

export function SlashAutocomplete(props: SlashAutocompleteProps) {
	const { query, selected, items, termWidth, termHeight, route, promptTop, promptLeft, promptWidth } = props;
	const scrollRef = useRef<any>(null);

	const isChat = route === 'chat';

	// Vertical space above the prompt that the menu is allowed to occupy.
	// On chat route the menu is anchored above the prompt; on home route there is
	// no prompt so we fall back to the full terminal height.
	const spaceAbove = isChat ? Math.max(0, (promptTop ?? termHeight) - MENU_CHROME - 1) : termHeight;
	const listH = Math.max(MIN_LIST_ROWS, Math.min(MAX_LIST_ROWS, items.length, spaceAbove));
	const mh = listH + MENU_CHROME;

	const menuLeft = promptLeft ?? 3;
	const menuWidth = promptWidth ?? Math.min(50, termWidth - 8);
	const menuTop = isChat ? (promptTop ?? termHeight) - mh - 1 : Math.floor(termHeight / 2) - mh - 2;

	const rows = useMemo(() => {
		const r: any[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const isSel = i === selected;
			r.push(
				<box
					key={item.id}
					id={item.id}
					height={1}
					paddingLeft={1}
					paddingRight={1}
					backgroundColor={isSel ? c.bgSelect : c.bgCard}
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
				>
					<box flexDirection="row" gap={1}>
						<text fg={isSel ? c.accent : c.dim}>/{item.slashName || item.id}</text>
						{item.label && item.label !== (item.slashName || item.id) && <text fg={c.subtext}>{item.label}</text>}
					</box>
					<text fg={c.dim}>{item.desc}</text>
				</box>,
			);
		}
		return r;
	}, [items, selected]);

	// Keep the highlighted row inside the scroll window. Same approach as
	// command-palette.tsx: prefer scrollChildIntoView, fall back to manual scrollBy.
	useEffect(() => {
		if (!scrollRef.current) return;
		const sel = items[selected];
		if (!sel) return;
		const el = scrollRef.current;
		if (typeof el.scrollChildIntoView === 'function') {
			el.scrollChildIntoView(sel.id);
			return;
		}
		const child = el.getChildren?.()?.find?.((ch: any) => ch.id === sel.id);
		if (child) {
			const y = child.y - (el.y || 0);
			if (y >= (el.height || listH)) el.scrollBy?.(y - (el.height || listH) + 1);
			if (y < 0) el.scrollBy?.(y);
		}
	}, [selected, items, listH]);

	return (
		<box
			position="absolute"
			left={menuLeft}
			top={menuTop}
			width={menuWidth}
			height={mh}
			zIndex={100}
			backgroundColor={c.bgCard}
		>
			<box
				height={1}
				paddingLeft={1}
				paddingRight={1}
				flexDirection="row"
				justifyContent="space-between"
				alignItems="center"
			>
				<box flexDirection="row" gap={1}>
					<text fg={c.accent}>/</text>
					<text fg={c.text}>{query}</text>
				</box>
				<box flexDirection="row" gap={1} height={1}>
					<text fg={c.dim}>tab</text>
				</box>
			</box>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<text fg={c.border}>{'─'.repeat(menuWidth - 2)}</text>
			</box>
			<scrollbox
				ref={(r: any) => {
					scrollRef.current = r;
				}}
				maxHeight={listH}
				scrollY={true}
				scrollbarOptions={{ visible: false }}
			>
				<box flexDirection="column">{rows}</box>
			</scrollbox>
			<box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
				<text fg={c.dim}>{'\u2191\u2193'} navigate</text>
				<text fg={c.dim}>esc dismiss</text>
			</box>
		</box>
	);
}
