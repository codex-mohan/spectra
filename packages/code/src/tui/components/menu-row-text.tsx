import { c } from '../tokens.js';
import { menuColumns } from '../utils/menu-text.js';

export function MenuRowText({ width, title, detail = '', selected = false }: { width: number; title: string; detail?: string; selected?: boolean }) {
	const columns = menuColumns(width, title, detail);
	return <box width={Math.max(0, width)} height={1} flexShrink={0} flexDirection="row" overflow="hidden">
		<text width={columns.titleWidth} height={1} flexShrink={0} wrapMode="none" overflow="hidden" fg={selected ? c.accent : c.text}>{columns.title}</text>
		{columns.detailWidth > 0 && <box width={columns.detailWidth} marginLeft={1} height={1} flexShrink={0} flexDirection="row" justifyContent="flex-end" overflow="hidden">
			<text height={1} flexShrink={0} wrapMode="none" overflow="hidden" fg={c.subtext}>{columns.detail}</text>
		</box>}
	</box>;
}
