import type { ReactNode } from 'react';
import { c } from '../theme.js';
import { getCenteredWindow, type SelectionWindow } from '../utils/selection-window.js';

interface PromptAnchoredMenuRenderProps {
	listHeight: number;
	visibleWindow: SelectionWindow;
}

export interface PromptAnchoredMenuProps {
	termWidth: number;
	termHeight: number;
	route: 'home' | 'chat';
	promptTop?: number;
	promptLeft?: number;
	promptWidth?: number;
	itemCount: number;
	selected: number;
	headerLeft: ReactNode;
	headerRight?: ReactNode;
	footerLeft: ReactNode;
	footerRight: ReactNode;
	children: (props: PromptAnchoredMenuRenderProps) => ReactNode;
}

const MAX_LIST_ROWS = 8;
const MIN_LIST_ROWS = 3;
const MENU_CHROME = 3;

export function PromptAnchoredMenu({
	termWidth,
	termHeight,
	route,
	promptTop,
	promptLeft,
	promptWidth,
	itemCount,
	selected,
	headerLeft,
	headerRight,
	footerLeft,
	footerRight,
	children,
}: PromptAnchoredMenuProps) {
	const isChat = route === 'chat';
	const spaceAbove = isChat ? Math.max(0, (promptTop ?? termHeight) - MENU_CHROME - 1) : termHeight;
	const listHeight = Math.max(MIN_LIST_ROWS, Math.min(MAX_LIST_ROWS, itemCount, spaceAbove));
	const height = listHeight + MENU_CHROME;
	const left = promptLeft ?? 3;
	const width = promptWidth ?? Math.min(50, termWidth - 8);
	const top = isChat ? (promptTop ?? termHeight) - height - 1 : Math.floor(termHeight / 2) - height - 2;
	const visibleWindow = getCenteredWindow(itemCount, selected, listHeight);

	return (
		<box position="absolute" left={left} top={top} width={width} height={height} zIndex={100} backgroundColor={c.bgCard}>
			<box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between" alignItems="center">
				{headerLeft}
				{headerRight}
			</box>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<text fg={c.border}>{'─'.repeat(Math.max(0, width - 2))}</text>
			</box>
			<box height={listHeight} flexDirection="column">
				{children({ listHeight, visibleWindow })}
			</box>
			<box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
				{footerLeft}
				{footerRight}
			</box>
		</box>
	);
}
