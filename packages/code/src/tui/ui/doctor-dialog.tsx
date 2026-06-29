import { useEffect, useRef } from 'react';
import type { DoctorResult } from '../../commands/doctor.js';
import { ModalFrame } from './modal-frame.js';
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

	const failedCount = result.checks.filter((check) => !check.passed).length;
	const innerW = Math.min(68, termWidth - 4) - 4;
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
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={68}
			height={Math.min(32, termHeight - 4)}
			top="upper"
			title={result.allPassed ? '✓ All checks passed' : `✗ ${failedCount}/${result.checks.length} failed`}
			titleColor={result.allPassed ? c.success : c.error}
			rightHint={undefined}
			footer={<text fg={c.dim}>esc/enter close</text>}
		>
			{({ height }) => (
				<scrollbox
					ref={(r: any) => {
						scrollRef.current = r;
					}}
					paddingX={1}
					maxHeight={height - 5}
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
			)}
		</ModalFrame>
	);
}
