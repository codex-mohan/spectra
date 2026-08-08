import { useEffect, useMemo, useRef, useState } from 'react';
import type { AskQuestion, AskToolDetails, AskToolInput } from '../../tools/ask.js';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';

interface QuestionDraft {
	selected: number[];
	customInput?: string;
}

export interface AskDialogProps {
	input: AskToolInput;
	termWidth: number;
	termHeight: number;
	onSubmit: (details: AskToolDetails) => void;
	onCancel: () => void;
	registerHandler: (handler: ((key: unknown) => void) | null) => void;
}

function initialCursor(question: AskQuestion, draft: QuestionDraft): number {
	if (draft.customInput !== undefined) return question.options.length + (question.multi ? 1 : 0);
	if (draft.selected.length > 0) return draft.selected[0] ?? 0;
	const recommended = question.recommended ?? 0;
	return Math.max(0, Math.min(recommended, question.options.length));
}

export function AskDialog({ input, termWidth, termHeight, onSubmit, onCancel, registerHandler }: AskDialogProps) {
	const questions = input.questions;
	const [questionIndex, setQuestionIndex] = useState(0);
	const [drafts, setDrafts] = useState<QuestionDraft[]>(() => questions.map(() => ({ selected: [] })));
	const [cursor, setCursor] = useState(() => initialCursor(questions[0]!, drafts[0]!));
	const [customMode, setCustomMode] = useState(false);
	const scrollRef = useRef<{ scrollChildIntoView?: (id: string) => void } | null>(null);
	const customInputRef = useRef<{ plainText?: string } | null>(null);

	const question = questions[questionIndex]!;
	const draft = drafts[questionIndex]!;
	const doneIndex = question.multi ? question.options.length : -1;
	const otherIndex = question.options.length + (question.multi ? 1 : 0);
	const rowCount = otherIndex + 1;

	const buildDetails = (nextDrafts: QuestionDraft[]): AskToolDetails => ({
		results: questions.map((item, index) => {
			const answer = nextDrafts[index] ?? { selected: [] };
			return {
				id: item.id,
				question: item.question,
				options: item.options.map((option) => option.label),
				multi: item.multi ?? false,
				selectedOptions: answer.selected
					.map((selectedIndex) => item.options[selectedIndex]?.label)
					.filter((label): label is string => label !== undefined),
				...(answer.customInput !== undefined ? { customInput: answer.customInput } : {}),
			};
		}),
	});

	const advance = (nextDrafts = drafts) => {
		setDrafts(nextDrafts);
		if (questionIndex === questions.length - 1) {
			onSubmit(buildDetails(nextDrafts));
			return;
		}
		const nextIndex = questionIndex + 1;
		setQuestionIndex(nextIndex);
		setCursor(initialCursor(questions[nextIndex]!, nextDrafts[nextIndex]!));
		setCustomMode(false);
	};

	const goBack = () => {
		if (questionIndex === 0) return;
		const previousIndex = questionIndex - 1;
		setQuestionIndex(previousIndex);
		setCursor(initialCursor(questions[previousIndex]!, drafts[previousIndex]!));
		setCustomMode(false);
	};

	const updateCurrentDraft = (next: QuestionDraft): QuestionDraft[] => {
		const updated = drafts.slice();
		updated[questionIndex] = next;
		setDrafts(updated);
		return updated;
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
			const selected = new Set(draft.selected);
			if (selected.has(cursor)) selected.delete(cursor);
			else selected.add(cursor);
			updateCurrentDraft({ ...draft, selected: [...selected].sort((a, b) => a - b) });
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
				setCursor((value) => Math.max(0, value - 1));
				return;
			}
			if (keyName === 'down') {
				setCursor((value) => Math.min(rowCount - 1, value + 1));
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

	useEffect(() => {
		scrollRef.current?.scrollChildIntoView?.(`ask-option-${cursor}`);
	}, [cursor]);

	const modalHeight = Math.max(12, Math.min(termHeight - 4, 20));
	const selected = useMemo(() => new Set(draft.selected), [draft.selected]);

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={72}
			height={modalHeight}
			top="upper"
			title={`Ask · ${questionIndex + 1}/${questions.length}`}
			rightHint="esc cancel"
			footer={
				customMode ? (
					<text fg={c.dim}>enter submit · shift+enter newline · esc back</text>
				) : (
					<text fg={c.dim}>↑↓ navigate · ←→ question · enter select · esc cancel</text>
				)
			}
		>
			{({ innerWidth }) => (
				<box flexDirection="column" paddingX={2} flexGrow={1}>
					<text fg={c.text} attributes={1} wrapMode="word">
						{question.question}
					</text>
					<box height={1} />
					{customMode ? (
						<box flexDirection="column" flexGrow={1}>
							<text fg={c.dim}>Type your own answer</text>
							<box marginTop={1} paddingX={1} backgroundColor={c.bgBar} flexGrow={1}>
								<textarea
									key={`ask-custom-${questionIndex}`}
									ref={(value: { plainText?: string } | null) => {
										customInputRef.current = value;
									}}
									initialValue={draft.customInput ?? ''}
									placeholder="Your answer..."
									width={'100%'}
									minHeight={3}
									maxHeight={Math.max(3, modalHeight - 10)}
									keyBindings={[
										{ name: 'return', action: 'submit' },
										{ name: 'return', shift: true, action: 'newline' },
									]}
									onSubmit={() => {
										const updated = updateCurrentDraft({
											...draft,
											customInput: customInputRef.current?.plainText ?? '',
										});
										advance(updated);
									}}
									focused={true}
								/>
							</box>
						</box>
					) : (
						<scrollbox
							ref={(value: { scrollChildIntoView?: (id: string) => void } | null) => {
								scrollRef.current = value;
							}}
							width={innerWidth}
							flexGrow={1}
							scrollY={true}
							scrollbarOptions={{ visible: false }}
						>
							<box flexDirection="column">
								{question.options.map((option, index) => {
									const active = cursor === index;
									const checked = selected.has(index);
									const marker = question.multi ? (checked ? '☑' : '☐') : active ? '●' : '○';
									return (
										<box
											key={`${option.label}-${index}`}
											id={`ask-option-${index}`}
											flexDirection="column"
											paddingX={1}
											paddingY={option.description ? 1 : 0}
											backgroundColor={active ? c.bgSelect : c.bgCard}
										>
											<box flexDirection="row" gap={1}>
												<text fg={active ? c.accent : checked ? c.success : c.dim}>{marker}</text>
												<text fg={active ? c.text : c.subtext}>{option.label}</text>
												{question.recommended === index && <text fg={c.warn}>Recommended</text>}
											</box>
											{option.description && (
												<text fg={c.dim} paddingLeft={2} wrapMode="word">
													{option.description}
												</text>
											)}
										</box>
									);
								})}
								{question.multi && (
									<box
										id={`ask-option-${doneIndex}`}
										paddingX={1}
										backgroundColor={cursor === doneIndex ? c.bgSelect : c.bgCard}
									>
										<text fg={cursor === doneIndex ? c.success : c.dim}>✓ Done selecting</text>
									</box>
								)}
								<box
									id={`ask-option-${otherIndex}`}
									paddingX={1}
									marginTop={1}
									backgroundColor={cursor === otherIndex ? c.bgSelect : c.bgCard}
								>
									<text fg={cursor === otherIndex ? c.accent : c.dim}>○ Other (type your own)</text>
								</box>
							</box>
						</scrollbox>
					)}
				</box>
			)}
		</ModalFrame>
	);
}
