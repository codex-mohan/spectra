import { useEffect, useState } from 'react';
import { formatTokens } from '@mohanscodex/spectra-ai';
import { fetchUsageReports, type ProviderUsageReport, type UsageWindowReport } from '../../services/usage-store.js';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';

export interface UsageDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: unknown) => void) => void;
	activeProvider?: string | null;
}

function formatUsd(value: number): string {
	return `$${value.toFixed(4)}`;
}

function formatUsageValue(value: number, unit: UsageWindowReport['unit']): string {
	if (unit === 'usd') return formatUsd(value);
	if (unit === 'tokens') return formatTokens(value);
	if (unit === 'requests') return `${Math.round(value).toLocaleString()} requests`;
	if (unit === 'percent') return `${value.toFixed(1)}%`;
	return value === 0 ? 'unknown' : String(value);
}

function formatWindowAmount(window: UsageWindowReport): string {
	if (window.unit === 'percent') return `${formatUsageValue(window.used, window.unit)} used`;
	if (window.limit <= 0) return `${formatUsageValue(window.used, window.unit)} used`;
	return `${formatUsageValue(window.remaining, window.unit)} free of ${formatUsageValue(window.limit, window.unit)}`;
}

function formatResetTime(window: UsageWindowReport): string {
	if (window.resetsAt === undefined) return 'reset unknown';
	const remainingMs = window.resetsAt - Date.now();
	if (remainingMs <= 0) return 'reset now';
	const hours = remainingMs / (60 * 60 * 1000);
	if (hours < 24) return `resets in ${Math.ceil(hours)}h`;
	return `resets in ${Math.ceil(hours / 24)}d`;
}

function statusColor(status: UsageWindowReport['status']): string {
	if (status === 'exhausted') return c.error;
	if (status === 'warning') return c.warn;
	if (status === 'ok') return c.success;
	return c.dim;
}

function bar(window: UsageWindowReport, width: number): string {
	const filled = Math.round(Math.min(Math.max(window.usedFraction, 0), 1) * width);
	return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

function freePercent(window: UsageWindowReport): string {
	return `${(Math.max(0, 1 - window.usedFraction) * 100).toFixed(1)}% free`;
}

function sourceLabel(report: ProviderUsageReport): string {
	if (report.source === 'live') return report.fetchedAt ? `live · ${new Date(report.fetchedAt).toLocaleTimeString()}` : 'live';
	if (report.source === 'observed-costs') return 'Spectra-observed spend';
	if (report.source === 'observed-tokens') return 'Spectra-observed tokens';
	return 'untracked';
}

function reportRows(report: ProviderUsageReport, innerWidth: number) {
	const header = `${report.planName} · ${report.provider} · ${sourceLabel(report)}`;
	return (
		<box key={report.provider} flexDirection="column" gap={0}>
			<text fg={c.accent}>{header.slice(0, innerWidth)}</text>
			{report.notes.map((note) => (
				<text key={note} fg={c.dim}>{note.slice(0, innerWidth)}</text>
			))}
			{report.windows.length === 0 ? (
				<text fg={c.dim}>
					{`${report.accountLabel ?? 'account 1'} · no quota data`.slice(0, innerWidth)}
				</text>
			) : (
				report.windows.map((window) => {
					const label = `${window.label} ${window.accountLabel ?? report.accountLabel ?? 'account 1'}`;
					const meta = `${formatWindowAmount(window)} · ${formatResetTime(window)}`;
					const line1 = `● ${label} · ${meta}`.slice(0, innerWidth);
					const barStr = bar(window, Math.max(8, Math.min(28, innerWidth - 4)));
					const line2 = `${barStr} ${freePercent(window)}`.slice(0, innerWidth);
					return (
						<box key={`${report.provider}-${window.id}`} flexDirection="column" gap={0} flexShrink={1}>
							<text fg={statusColor(window.status)}>{line1}</text>
							<text fg={statusColor(window.status)}>{line2}</text>
							{window.notes?.map((note) => (
								<text key={note} fg={c.dim}>{note.slice(0, innerWidth)}</text>
							))}
						</box>
					);
				})
			)}
		</box>
	);
}

export function UsageDialog({ onClose, termWidth, termHeight, registerHandler, activeProvider }: UsageDialogProps) {
	const [reports, setReports] = useState<ProviderUsageReport[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const handler = (key: unknown) => {
			if (key && typeof key === 'object' && 'name' in key) {
				const name = key.name;
				if (name === 'escape' || name === 'return' || name === 'enter') onClose();
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler]);

	useEffect(() => {
		const controller = new AbortController();
		setReports(null);
		setError(null);
		fetchUsageReports({ providers: activeProvider ? [activeProvider] : undefined, signal: controller.signal })
			.then((next) => setReports(next))
			.catch((err) => {
				if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
			});
		return () => controller.abort();
	}, [activeProvider]);
	const shown = reports ?? [];
	const rowCount = reports === null
		? 3
		: shown.reduce((sum: number, report: ProviderUsageReport) => {
			const notes = report.notes.length;
			const windowLines = report.windows.length === 0 ? 1 : report.windows.length * 2 + report.windows.reduce((n: number, w) => n + (w.notes?.length ?? 0), 0);
			return sum + 2 + notes + windowLines;
		}, 0);
	const height = Math.min(termHeight - 2, Math.max(14, 7 + rowCount));

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={76}
			height={height}
			top="upper"
			title="Coding Plan Usage"
			footer={<text fg={c.dim}>close · enter</text>}
		>
			{({ innerWidth }) => (
				<box flexDirection="column" paddingX={2} gap={1} flexGrow={1}>
					<text fg={c.dim}>Connected coding/subscription plans. Live quota endpoints are used where available; observed rows only count Spectra requests.</text>
					{error && <text fg={c.error}>Usage load failed: {error}</text>}
					{reports === null ? (
						<text fg={c.dim}>Loading usage…</text>
					) : shown.length === 0 ? (
						<text fg={c.dim}>No connected coding plans or observed usage yet.</text>
					) : (
						<scrollbox maxHeight={termHeight - 10} paddingX={0} scrollY={true} scrollbarOptions={{ visible: false }}>
							<box flexDirection="column" gap={1}>
								{shown.map((report) => reportRows(report, innerWidth))}
							</box>
						</scrollbox>
					)}
				</box>
			)}
		</ModalFrame>
	);
}
