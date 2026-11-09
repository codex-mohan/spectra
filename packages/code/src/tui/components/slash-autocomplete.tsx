import { memo } from 'react';
import { c } from '../theme.js';
import { PromptAnchoredMenu } from './prompt-anchored-menu.js';
import { iconForCommand } from '../utils/icons.js';
import { truncateMenuText } from '../utils/menu-text.js';
import type { ResolvedCommand } from '../command-types.js';

export interface SlashAutocompleteProps {
	query: string;
	selected: number;
	items: readonly ResolvedCommand[];
	termWidth: number;
	termHeight: number;
	route: 'home' | 'chat';
	promptTop?: number;
	promptLeft?: number;
	promptWidth?: number;
}

const SlashRow = memo(function SlashRow({
	item,
	isSelected,
	width,
}: {
	item: ResolvedCommand;
	isSelected: boolean;
	width: number;
}) {
	const icon = iconForCommand(item.definition);
	const textWidth = Math.max(0, width - 2);
	return (
		<box
			id={item.definition.id}
			height={1}
			paddingLeft={1}
			paddingRight={1}
			backgroundColor={isSelected ? c.bgSelect : c.bgCard}
			flexDirection="row"
			justifyContent="space-between"
			alignItems="center"
		>
			<text width={textWidth} height={1} flexShrink={0} wrapMode="none" overflow="hidden">
				<span fg={icon.color}>{`${icon.glyph} `}</span>
				<span fg={isSelected ? c.accent : c.text}>{item.invocation.padEnd(18)}</span>
				<span fg={c.subtext}>{truncateMenuText(item.definition.description, Math.max(0, width - 24))}</span>
			</text>
		</box>
	);
}, (previous, next) => (
	previous.item.definition.id === next.item.definition.id
	&& previous.item.invocation === next.item.invocation
	&& previous.item.definition.description === next.item.definition.description
	&& previous.isSelected === next.isSelected
	&& previous.width === next.width
));

export function SlashAutocomplete(props: SlashAutocompleteProps) {
	const { query, selected, items, termWidth, termHeight, route, promptTop, promptLeft, promptWidth } = props;

	return (
		<PromptAnchoredMenu
			termWidth={termWidth}
			termHeight={termHeight}
			route={route}
			promptTop={promptTop}
			promptLeft={promptLeft}
			promptWidth={promptWidth}
			itemCount={items.length}
			selected={selected}
			headerLeft={
				<box flexDirection="row" gap={1}>
					<text fg={c.accent}>/</text>
					<text fg={c.text}>{query}</text>
				</box>
			}
			headerRight={
				<box flexDirection="row" gap={1} height={1}>
					<text fg={c.dim}>tab/enter</text>
				</box>
			}
			footerLeft={<text fg={c.dim}>{'\u2191\u2193'} navigate</text>}
			footerRight={<text fg={c.dim}>esc dismiss</text>}
		>
			{({ visibleWindow, width }) =>
				items.slice(visibleWindow.start, visibleWindow.end).map((item, offset) => {
					const actualIndex = visibleWindow.start + offset;
					return (
						<SlashRow
							key={item.definition.id}
							item={item}
							isSelected={actualIndex === selected}
							width={width}
						/>
					);
				})
			}
		</PromptAnchoredMenu>
	);
}
