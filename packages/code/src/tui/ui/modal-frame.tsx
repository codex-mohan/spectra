import type { ReactNode } from 'react';
import { c } from '../theme.js';

export interface ModalFrameLayout {
	width: number;
	height: number;
	innerWidth: number;
}

export interface ModalFrameProps {
	termWidth: number;
	termHeight: number;
	width: number;
	height: number;
	top?: 'center' | 'upper';
	title?: ReactNode;
	titleColor?: string;
	rightHint?: ReactNode;
	footer?: ReactNode;
	footerJustify?: 'center' | 'space-between';
	children: ReactNode | ((layout: ModalFrameLayout) => ReactNode);
}

export function ModalFrame({
	termWidth,
	termHeight,
	width,
	height,
	top = 'center',
	title,
	titleColor = c.accent,
	rightHint = 'esc',
	footer,
	footerJustify = 'center',
	children,
}: ModalFrameProps) {
	const modalWidth = Math.min(width, termWidth - 4);
	const modalHeight = height;
	const modalLeft = Math.floor((termWidth - modalWidth) / 2);
	const modalTop =
		top === 'upper'
			? Math.max(0, Math.floor((termHeight - modalHeight) / 3))
			: Math.max(1, Math.floor((termHeight - modalHeight) / 2));
	const layout = { width: modalWidth, height: modalHeight, innerWidth: modalWidth - 4 };
	const body = typeof children === 'function' ? children(layout) : children;

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={modalLeft} top={modalTop} width={modalWidth} height={modalHeight} backgroundColor={c.bgCard}>
				{title !== undefined && (
					<>
						<box
							height={1}
							paddingX={2}
							paddingTop={1}
							paddingBottom={1}
							flexDirection="row"
							justifyContent="space-between"
							backgroundColor={c.bgCard}
						>
							<text fg={titleColor} attributes={1} height={1}>
								{title}
							</text>
							{rightHint !== undefined && (
								<text fg={c.dim} height={1}>
									{rightHint}
								</text>
							)}
						</box>
						<box height={1} paddingX={2}>
							<text fg={c.border}>{'─'.repeat(layout.innerWidth)}</text>
						</box>
					</>
				)}
				{body}
				{footer !== undefined && (
					<box paddingX={2} paddingY={1} paddingBottom={1} flexDirection="row" justifyContent={footerJustify}>
						{footer}
					</box>
				)}
			</box>
		</box>
	);
}
