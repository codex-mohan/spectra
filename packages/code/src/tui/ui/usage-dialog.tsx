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

function bar(window: UsageWindowReport, width: number): { filled: string; empty: string } {
	const filledWidth = Math.round(Math.min(Math.max(window.usedFraction, 0), 1) * width);
	return {
		filled: '█'.repeat(filledWidth),
		empty: '█'.repeat(Math.max(0, width - filledWidth)),
	};
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
		<box key={report.provider} flexDirection="column" gap={1}>
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
					const barSegments = bar(window, Math.max(8, Math.min(28, innerWidth - 4)));
					return (
						<box key={`${report.provider}-${window.id}`} flexDirection="column" gap={1} flexShrink={1}>
							<text fg={statusColor(window.status)}>{line1}</text>
							<text>
								<span fg={statusColor(window.status)}>{barSegments.filled}</span>
								<span fg={c.border}>{barSegments.empty}</span>
								<span fg={statusColor(window.status)}> {freePercent(window)}</span>
							</text>
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
	const [selectedProvider, setSelectedProvider] = useState<string | null>(activeProvider ?? null);
	const shown = reports ?? [];
	const selectedIndex = Math.max(0, shown.findIndex((report) => report.provider === selectedProvider));
	const selectedReport = shown[selectedIndex];

	useEffect(() => {
		const handler = (key: unknown) => {
			if (!key || typeof key !== 'object' || !('name' in key)) return;
			const name = key.name;
			if ((name === 'tab' || name === 'right') && shown.length > 1) {
				setSelectedProvider(shown[(selectedIndex + 1) % shown.length].provider);
				return;
			}
			if (name === 'left' && shown.length > 1) {
				setSelectedProvider(shown[(selectedIndex - 1 + shown.length) % shown.length].provider);
				return;
			}
			if (name === 'escape' || name === 'return' || name === 'enter') onClose();
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler, selectedIndex, shown]);

	useEffect(() => {
		const controller = new AbortController();
		setReports(null);
		setError(null);
		fetchUsageReports({ providers: activeProvider ? [activeProvider] : undefined, signal: controller.signal })
			.then((nextReports) => {
				setReports(nextReports);
				setSelectedProvider((current) => {
					if (current && nextReports.some((report) => report.provider === current)) return current;
					if (activeProvider && nextReports.some((report) => report.provider === activeProvider)) return activeProvider;
					return nextReports[0]?.provider ?? null;
				});
			})
			.catch((err) => {
				if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
			});
		return () => controller.abort();
	}, [activeProvider]);

	const reportRowCount = selectedReport
		? 2 + selectedReport.notes.length + (selectedReport.windows.length === 0
			? 1
			: selectedReport.windows.length * 2
				+ selectedReport.windows.reduce((count, window) => count + (window.notes?.length ?? 0), 0))
		: 1;
	const modalInnerWidth = Math.max(1, Math.min(76, termWidth - 4) - 4);
	const tabCharacters = shown.reduce((count, report) => count + report.planName.length + 2, 0)
		+ Math.max(0, shown.length - 1) * 2;
	const tabRows = shown.length === 0 ? 0 : Math.max(1, Math.ceil(tabCharacters / modalInnerWidth));
	const height = Math.min(termHeight - 2, Math.max(15, 9 + tabRows + reportRowCount + (error ? 1 : 0)));

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={76}
			height={height}
			top="upper"
			title="Coding Plan Usage"
			footer={(
				<box flexDirection="row" gap={2}>
					{shown.length > 1 && <text fg={c.dim}>← → / tab switch</text>}
					<text fg={c.dim}>enter close</text>
				</box>
			)}
		>
			{({ innerWidth }) => (
				<box flexDirection="column" paddingX={2} gap={1} flexGrow={1}>
					<text fg={c.dim}>Live provider quota when available; otherwise Spectra-observed usage.</text>
					{error && <text fg={c.error}>Usage load failed: {error}</text>}
					{reports === null ? (
						<text fg={c.dim}>Loading usage…</text>
					) : shown.length === 0 ? (
						<text fg={c.dim}>No connected coding plans or observed usage yet.</text>
					) : (
						<>
							<box flexDirection="row" flexWrap="wrap" gap={2}>
								{shown.map((report, index) => {
									const selected = index === selectedIndex;
									return (
										<box key={report.provider} paddingX={1} backgroundColor={selected ? c.text : c.bgCard}>
											<text fg={selected ? c.bgCard : c.dim} attributes={selected ? 1 : 0}>
												{report.planName}
											</text>
										</box>
									);
								})}
							</box>
							<scrollbox
								maxHeight={Math.max(3, height - 10 - tabRows)}
								paddingX={0}
								scrollY={true}
								scrollbarOptions={{ visible: false }}
							>
								{selectedReport && reportRows(selectedReport, innerWidth)}
							</scrollbox>
						</>
					)}
				</box>
			)}
		</ModalFrame>
	);
}
