import { c } from '../theme.js';
import { PromptAnchoredMenu } from './prompt-anchored-menu.js';
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
					<text fg={c.dim}>tab</text>
				</box>
			}
			footerLeft={<text fg={c.dim}>{'\u2191\u2193'} navigate</text>}
			footerRight={<text fg={c.dim}>esc dismiss</text>}
		>
			{({ visibleWindow }) =>
				items.slice(visibleWindow.start, visibleWindow.end).map((item, offset) => {
					const actualIndex = visibleWindow.start + offset;
					const isSel = actualIndex === selected;
					return (
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
						</box>
					);
				})
			}
		</PromptAnchoredMenu>
	);
}
