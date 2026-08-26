import type { AskQuestion, AskToolDetails } from '../../tools/ask.js';

export interface AskQuestionDraft {
	selected: number[];
	customInput?: string;
}

export function getInitialAskCursor(question: AskQuestion, draft: AskQuestionDraft): number {
	if (draft.customInput !== undefined) return question.options.length + (question.multi ? 1 : 0);
	if (draft.selected.length > 0) return draft.selected[0] ?? 0;
	const recommended = question.recommended ?? 0;
	return Math.max(0, Math.min(recommended, question.options.length));
}

export function buildAskDetails(questions: AskQuestion[], drafts: AskQuestionDraft[]): AskToolDetails {
	return {
		results: questions.map((item, index) => {
			const answer = drafts[index] ?? { selected: [] };
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
	};
}

export function toggleAskSelection(selected: number[], index: number): number[] {
	const nextSelected = new Set(selected);
	if (nextSelected.has(index)) nextSelected.delete(index);
	else nextSelected.add(index);
	return [...nextSelected].sort((a, b) => a - b);
}
