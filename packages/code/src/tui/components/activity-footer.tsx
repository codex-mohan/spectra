import { c } from '../tokens.js';
import { layoutFooter, resolveFooterStatus, truncateFooterLabel } from '../footer-status.js';

type ActivityFooterProps = Parameters<typeof resolveFooterStatus>[0] & {
	width: number;
	metrics: string;
	spinner: string;
};

export function ActivityFooter(props: ActivityFooterProps) {
	const status = resolveFooterStatus(props);
	const layout = layoutFooter(props.width, props.metrics, props.isLoading, status.text, status.message);
	const label = truncateFooterLabel(status.text, Math.max(0, layout.activityWidth - 2));
	return (
		<box width={layout.total} height={1} flexShrink={0} flexDirection="row" overflow="hidden">
			<box width={layout.activityWidth} height={1} flexShrink={0} overflow="hidden">
				<text fg={c[status.tone]} width={layout.activityWidth} height={1} overflow="hidden" wrapMode="none">
					{layout.activityWidth >= 2 ? `${status.busy ? props.spinner : '•'} ${label}` : ''}
				</text>
			</box>
			{layout.metricsText && <text fg={c.subtext} width={layout.metricsText.length + 2} height={1} flexShrink={0} wrapMode="none" overflow="hidden">{`  ${layout.metricsText}`}</text>}
			{layout.statusWidth > 0 && <text fg={c[status.tone]} width={layout.statusWidth + 2} height={1} flexShrink={0} wrapMode="none" overflow="hidden">{`  ${truncateFooterLabel(status.message, layout.statusWidth)}`}</text>}
			<box flexGrow={1} minWidth={0} />
			{layout.hintsText && <text fg={c.subtext} width={layout.hintsText.length + 2} height={1} flexShrink={0} wrapMode="none" overflow="hidden">{`  ${layout.hintsText}`}</text>}
		</box>
	);
}
