import { useEffect, useRef } from 'react';
import type { DoctorResult } from '../../commands/doctor.js';
import { c } from '../theme.js';

export function DoctorDialog({
	result,
	onClose,
	termWidth,
	termHeight,
	registerHandler,
}: {
	result: DoctorResult;
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
}) {
	const scrollRef = useRef<any>(null);

	useEffect(() => {
		const handler = (key: any) => {
			if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') {
				onClose();
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler]);

	const mw = Math.min(68, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = Math.min(32, termHeight - 4);
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = mw - 4;
	const listH = mh - 5;

	const failedCount = result.checks.filter((check) => !check.passed).length;

	// Name/detail inline: ✓ Name  detail
	// Reserve: icon(1) + gap(1) + gap(2) + detail padding = ~4 chars overhead
	const nameMax = Math.floor(innerW * 0.35);
	const detailMax = innerW - nameMax - 4;

	function trunc(s: string, max: number): string {
		if (s.length <= max) return s;
		return s.slice(0, Math.max(1, max - 1)) + '…';
	}

	const rows: React.ReactNode[] = [];
	let prevSection = '';
	for (let i = 0; i < result.checks.length; i++) {
		const check = result.checks[i];
		if (check.section !== prevSection) {
			if (prevSection) {
				rows.push(<box key={`gap-${i}`} height={1} backgroundColor={c.bgCard} />);
			}
			prevSection = check.section;
			rows.push(
				<box key={`sec-${check.section}`} height={1} paddingLeft={2} backgroundColor={c.bgCard}>
					<text fg={c.accent}>{check.section}</text>
				</box>,
			);
		}
		rows.push(
			<box
				key={check.name}
				flexDirection="row"
				height={1}
				paddingLeft={4}
				paddingRight={1}
				gap={2}
				alignItems="center"
				backgroundColor={c.bgCard}
			>
				<text fg={check.passed ? c.success : c.error} width={1}>
					{check.passed ? '✓' : '✗'}
				</text>
				<text fg={c.text}>{trunc(check.name, nameMax)}</text>
				{check.detail && <text fg={c.dim}>{trunc(check.detail, detailMax)}</text>}
			</box>,
		);
	}

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box height={1} paddingX={2} paddingTop={1} paddingBottom={1} backgroundColor={c.bgCard}>
					<text fg={result.allPassed ? c.success : c.error}>
						{result.allPassed ? '✓ All checks passed' : `✗ ${failedCount}/${result.checks.length} failed`}
					</text>
				</box>

				<box height={1} paddingX={2} backgroundColor={c.bgCard}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>

				<scrollbox
					ref={(r: any) => {
						scrollRef.current = r;
					}}
					paddingX={1}
					maxHeight={listH}
					scrollY={true}
					backgroundColor={c.bgCard}
				>
					<box flexDirection="column" backgroundColor={c.bgCard}>
						{rows.length === 0 ? (
							<box height={1} paddingX={1} backgroundColor={c.bgCard}>
								<text fg={c.dim}>No checks</text>
							</box>
						) : (
							rows
						)}
					</box>
				</scrollbox>

				<box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center">
					<text fg={c.dim}>esc/enter close</text>
				</box>
			</box>
		</box>
	);
}
