import { useEffect, useMemo, useRef, useState } from 'react';
import type { AskToolDetails, AskToolInput } from '../../tools/ask.js';
import { PromptAnchoredMenu } from '../components/prompt-anchored-menu.js';
import { c } from '../theme.js';
import { buildAskDetails, getInitialAskCursor, toggleAskSelection, type AskQuestionDraft } from './ask-menu-state.js';


export interface AskMenuProps {
	input: AskToolInput;
	termWidth: number;
	termHeight: number;
	route: 'home' | 'chat';
	promptTop?: number;
	promptLeft?: number;
	promptWidth?: number;
	onSubmit: (details: AskToolDetails) => void;
	onCancel: () => void;
	registerHandler: (handler: ((key: unknown) => void) | null) => void;
}


export function AskMenu({
	input,
	termWidth,
	termHeight,
	route,
	promptTop,
	promptLeft,
	promptWidth,
	onSubmit,
	onCancel,
	registerHandler,
}: AskMenuProps) {
	const questions = input.questions;
	const [questionIndex, setQuestionIndex] = useState(0);
	const [drafts, setDrafts] = useState<AskQuestionDraft[]>(() => questions.map(() => ({ selected: [] })));
	const [cursor, setCursor] = useState(() => getInitialAskCursor(questions[0]!, drafts[0]!));
	const [customMode, setCustomMode] = useState(false);
	const customInputRef = useRef<{ plainText?: string } | null>(null);

	const question = questions[questionIndex]!;
	const draft = drafts[questionIndex]!;
	const doneIndex = question.multi ? question.options.length : -1;
	const otherIndex = question.options.length + (question.multi ? 1 : 0);
	const rowCount = otherIndex + 1;
	const selected = useMemo(() => new Set(draft.selected), [draft.selected]);


	const advance = (nextDrafts = drafts) => {
		setDrafts(nextDrafts);
		if (questionIndex === questions.length - 1) {
			onSubmit(buildAskDetails(questions, nextDrafts));
			return;
		}
		const nextIndex = questionIndex + 1;
		setQuestionIndex(nextIndex);
		setCursor(getInitialAskCursor(questions[nextIndex]!, nextDrafts[nextIndex]!));
		setCustomMode(false);
	};

	const goBack = () => {
		if (questionIndex === 0) return;
		const previousIndex = questionIndex - 1;
		setQuestionIndex(previousIndex);
		setCursor(getInitialAskCursor(questions[previousIndex]!, drafts[previousIndex]!));
		setCustomMode(false);
	};

	const updateCurrentDraft = (next: AskQuestionDraft): AskQuestionDraft[] => {
		const updated = drafts.slice();
		updated[questionIndex] = next;
		setDrafts(updated);
		return updated;
	};

	const submitCustomAnswer = () => {
		const updated = updateCurrentDraft({
			selected: question.multi ? draft.selected : [],
			customInput: customInputRef.current?.plainText ?? '',
		});
		advance(updated);
	};

	const selectCurrent = () => {
		if (cursor === otherIndex) {
			setCustomMode(true);
			return;
		}
		if (question.multi) {
			if (cursor === doneIndex) {
				advance();
				return;
			}
			updateCurrentDraft({ ...draft, selected: toggleAskSelection(draft.selected, cursor) });
			return;
		}
		const updated = updateCurrentDraft({ selected: [cursor] });
		advance(updated);
	};

	useEffect(() => {
		registerHandler((rawKey: unknown) => {
			let keyName: string | undefined;
			if (rawKey && typeof rawKey === 'object' && 'name' in rawKey && typeof rawKey.name === 'string') {
				keyName = rawKey.name;
			}
			if (customMode) {
				if (keyName === 'escape') setCustomMode(false);
				return;
			}
			if (keyName === 'escape') {
				onCancel();
				return;
			}
			if (keyName === 'up') {
				setCursor((value) => (value > 0 ? value - 1 : rowCount - 1));
				return;
			}
			if (keyName === 'down') {
				setCursor((value) => (value < rowCount - 1 ? value + 1 : 0));
				return;
			}
			if (keyName === 'left') {
				goBack();
				return;
			}
			if (keyName === 'right') {
				advance();
				return;
			}
			if (keyName === 'return' || keyName === 'enter' || keyName === 'space') selectCurrent();
		});
		return () => registerHandler(null);
	}, [advance, customMode, goBack, onCancel, registerHandler, rowCount, selectCurrent]);

	return (
		<PromptAnchoredMenu
			termWidth={termWidth}
			termHeight={termHeight}
			route={route}
			promptTop={promptTop}
			promptLeft={promptLeft}
			promptWidth={promptWidth}
			itemCount={customMode ? 3 : rowCount}
			selected={cursor}
			headerLeft={
				<box flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
					<text fg={c.accent}>?</text>
					<text fg={c.text} attributes={1} overflow="hidden" wrapMode="none" truncate>
						{question.question}
					</text>
				</box>
			}
			headerRight={<text fg={c.dim}>{questionIndex + 1}/{questions.length}</text>}
			footerLeft={
				customMode
					? <text fg={c.dim}>enter submit · shift+enter newline</text>
					: <text fg={c.dim}>{'↑↓'} navigate · enter select</text>
			}
			footerRight={
				customMode
					? <text fg={c.dim}>esc back</text>
					: <text fg={c.dim}>{questions.length > 1 ? '←→ question · ' : ''}esc cancel</text>
			}
		>
			{({ listHeight, visibleWindow }) => customMode ? (
				<box height={listHeight} paddingLeft={1} paddingRight={1} backgroundColor={c.bgCard}>
					<textarea
						key={`ask-custom-${questionIndex}`}
						ref={(value: { plainText?: string } | null) => {
							customInputRef.current = value;
						}}
						initialValue={draft.customInput ?? ''}
						placeholder="Type your own answer..."
						width="100%"
						height={listHeight}
						keyBindings={[
							{ name: 'return', action: 'submit' },
							{ name: 'return', shift: true, action: 'newline' },
						]}
						onSubmit={submitCustomAnswer}
						focused={true}
					/>
				</box>
			) : (
				Array.from(
					{ length: visibleWindow.end - visibleWindow.start },
					(_, offset) => visibleWindow.start + offset,
				).map((index) => {
					const active = cursor === index;
					if (index === doneIndex) {
						return (
							<box key="done" height={1} paddingLeft={1} paddingRight={1} backgroundColor={active ? c.bgSelect : c.bgCard}>
								<text fg={active ? c.success : c.dim}>✓ Done selecting</text>
							</box>
						);
					}
					if (index === otherIndex) {
						return (
							<box key="other" height={1} paddingLeft={1} paddingRight={1} backgroundColor={active ? c.bgSelect : c.bgCard}>
								<text fg={active ? c.accent : c.dim}>○ Other (type your own)</text>
							</box>
						);
					}

					const option = question.options[index]!;
					const checked = selected.has(index);
					const marker = question.multi ? (checked ? '☑' : '☐') : active ? '●' : '○';
					return (
						<box
							key={`${option.label}-${index}`}
							height={1}
							paddingLeft={1}
							paddingRight={1}
							backgroundColor={active ? c.bgSelect : c.bgCard}
							flexDirection="row"
							justifyContent="space-between"
							alignItems="center"
						>
							<box flexDirection="row" gap={1} flexShrink={0}>
								<text fg={active ? c.accent : checked ? c.success : c.dim}>{marker}</text>
								<text fg={active ? c.text : c.subtext}>{option.label}</text>
								{question.recommended === index && <text fg={c.warn}>Recommended</text>}
							</box>
							{option.description && (
								<text fg={c.dim} overflow="hidden" wrapMode="none" truncate flexShrink={1} marginLeft={1}>
									{option.description}
								</text>
							)}
						</box>
					);
				})
			)}
		</PromptAnchoredMenu>
	);
}
