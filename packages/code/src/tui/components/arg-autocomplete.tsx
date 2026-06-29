import { c } from '../theme.js';
import { PromptAnchoredMenu } from './prompt-anchored-menu.js';

export interface ArgAutocompleteProps {
	commandName: string;
	query: string;
	selected: number;
	items: string[];
	termWidth: number;
	termHeight: number;
	route: 'home' | 'chat';
	promptTop?: number;
	promptLeft?: number;
	promptWidth?: number;
}

export function ArgAutocomplete(props: ArgAutocompleteProps) {
	const { commandName, query, selected, items, termWidth, termHeight, route, promptTop, promptLeft, promptWidth } = props;

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
					<text fg={c.accent}>/{commandName}</text>
					<text fg={c.text}>{query || 'args'}</text>
				</box>
			}
			headerRight={<text fg={c.dim}>{items.length} options</text>}
			footerLeft={<text fg={c.dim}>↑↓ navigate</text>}
			footerRight={<text fg={c.dim}>tab/enter select · esc dismiss</text>}
		>
			{({ visibleWindow }) => {
				if (items.length === 0) {
					return (
						<box height={1} paddingLeft={1} paddingRight={1}>
							<text fg={c.dim}>No matching options</text>
						</box>
					);
				}
				return items.slice(visibleWindow.start, visibleWindow.end).map((item, offset) => {
					const actualIndex = visibleWindow.start + offset;
					const isSel = actualIndex === selected;
					return (
						<box
							key={`arg-${actualIndex}`}
							height={1}
							paddingLeft={1}
							paddingRight={1}
							backgroundColor={isSel ? c.bgSelect : c.bgCard}
							flexDirection="row"
							alignItems="center"
						>
							<text fg={isSel ? c.accent : c.text}>{item}</text>
						</box>
					);
				});
			}}
		</PromptAnchoredMenu>
	);
}
