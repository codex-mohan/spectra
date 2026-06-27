import { useRef, useEffect, useState, useCallback } from 'react';
import { SyntaxStyle } from '@opentui/core';
import type { FileContent } from '@mohanscodex/spectra-ai';
import { c } from './theme.js';
import { titlecase } from './utils.js';
import { formatAttachmentBadge, formatAttachmentMetadata, getFileVisual } from './utils/file-visuals.js';
import { readLocalAttachment, readClipboardAttachment, readPastedBytesAttachment, resolvePastedFilePath } from './utils/local-attachment.js';

const COMPACT_THRESHOLD = 250;
const ATTACHMENT_EXTMARK_TYPE = 'prompt-attachment';

export interface PromptAttachment extends FileContent {
	badge: { icon: string; label: string; color: string };
}

export interface PromptSubmitPayload {
	text: string;
	attachments: PromptAttachment[];
}

export interface AttachmentInsertOptions {
	replaceRange?: { start: number; end: number };
}

export interface PromptBarRef {
	addAttachment(file: FileContent, options?: AttachmentInsertOptions): void;
	getAttachments(): PromptAttachment[];
	clearAttachments(): void;
	setText(text: string, cursorOffset?: number): void;
}

export interface PromptBarProps {
	isLoading: boolean;
	spinnerFrame: number;
	inputKey: string | number;
	placeholder: string;
	onSubmit: (payload: PromptSubmitPayload) => void;
	hasModel: boolean;
	agent: string;
	model: string;
	provider: string;
	thinkingEffort?: string;
	initialValue?: string;
	width?: number | 'auto';
	elapsedMs?: number | null;
	tokenUsage?: { input: number; output: number };
	focused?: boolean;
	onTextChange?: (text: string) => void;
	onGetTextarea?: (ref: unknown) => void;
	onPositionChange?: (pos: { top: number; left: number; width: number }) => void;
	onGetPromptBar?: (ref: PromptBarRef) => void;
}

type PromptExtmark = {
	id: number;
	start: number;
	end: number;
	virtual: boolean;
	typeId: number;
};

type ExtmarksControllerLike = {
	registerType(typeName: string): number;
	getTypeId(typeName: string): number | null;
	create(options: { start: number; end: number; virtual?: boolean; typeId?: number; styleId?: number; priority?: number; metadata?: unknown }): number;
	delete(id: number): boolean;
	getAllForTypeId(typeId: number): PromptExtmark[];
	getMetadataFor(extmarkId: number): unknown;
	clear(): void;
};

type TextareaLike = {
	plainText?: string;
	cursorOffset?: number;
	setText?: (value: string) => void;
	insertText?: (value: string) => void;
	deleteCharBackward?: () => boolean;
	extmarks?: ExtmarksControllerLike;
	syntaxStyle?: SyntaxStyle | null;
};

type AttachmentMetadata = {
	attachment: PromptAttachment;
	text: string;
};

function toPromptAttachment(file: FileContent): PromptAttachment {
	const visual = getFileVisual(file);
	return { ...file, badge: { icon: visual.icon, label: visual.label, color: visual.color } };
}

function buildAttachmentText(file: FileContent): string {
	const meta = formatAttachmentMetadata(file);
	return `${formatAttachmentBadge(file)}${meta ? ` ${meta}` : ''}`;
}

function getAttachmentTypeId(textarea: TextareaLike): number | null {
	if (!textarea.extmarks) return null;
	return textarea.extmarks.getTypeId(ATTACHMENT_EXTMARK_TYPE) ?? textarea.extmarks.registerType(ATTACHMENT_EXTMARK_TYPE);
}

function getAttachmentStyleId(textarea: TextareaLike, attachment: PromptAttachment): number | undefined {
	if (!textarea.syntaxStyle) textarea.syntaxStyle = SyntaxStyle.create();
	const style = textarea.syntaxStyle;
	const styleName = `prompt-attachment-${attachment.badge.color.replace(/[^a-zA-Z0-9]/g, '')}`;
	return style.getStyleId(styleName) ?? style.registerStyle(styleName, {
		fg: c.bg,
		bg: attachment.badge.color,
		bold: true,
	});
}

function syncAttachmentsFromExtmarks(textarea: TextareaLike | null): PromptAttachment[] {
	if (!textarea?.extmarks) return [];
	const typeId = textarea.extmarks.getTypeId(ATTACHMENT_EXTMARK_TYPE);
	if (typeId == null) return [];
	return textarea.extmarks
		.getAllForTypeId(typeId)
		.sort((a, b) => a.start - b.start)
		.map((mark) => textarea.extmarks?.getMetadataFor(mark.id))
		.filter((metadata): metadata is AttachmentMetadata => {
			return !!metadata && typeof metadata === 'object' && 'attachment' in metadata;
		})
		.map((metadata) => metadata.attachment);
}

function stripAttachmentText(text: string, textarea: TextareaLike | null): string {
	if (!textarea?.extmarks) return text;
	const typeId = textarea.extmarks.getTypeId(ATTACHMENT_EXTMARK_TYPE);
	if (typeId == null) return text;

	let result = text;
	const marks = textarea.extmarks
		.getAllForTypeId(typeId)
		.map((mark) => textarea.extmarks?.getMetadataFor(mark.id))
		.filter((metadata): metadata is AttachmentMetadata => {
			return !!metadata && typeof metadata === 'object' && 'text' in metadata;
		});

	for (const mark of marks) {
		result = result.replace(mark.text, '');
	}
	return result.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ');
}

export function PromptBar(props: PromptBarProps) {
	const {
		isLoading, spinnerFrame, inputKey, placeholder, onSubmit, hasModel,
		agent, model, provider, thinkingEffort, initialValue, width,
		elapsedMs, tokenUsage, focused = true,
		onTextChange, onGetTextarea, onPositionChange, onGetPromptBar,
	} = props;

	const textareaRef = useRef<TextareaLike | null>(null);
	const boxRef = useRef<unknown>(null);
	const attachmentsRef = useRef<PromptAttachment[]>([]);
	const [showHint, setShowHint] = useState(false);
	const [charCount, setCharCount] = useState(0);
	const [attachments, setAttachments] = useState<PromptAttachment[]>([]);

	const syncAttachments = useCallback(() => {
		const next = syncAttachmentsFromExtmarks(textareaRef.current);
		attachmentsRef.current = next;
		setAttachments(next);
		return next;
	}, []);

	const addAttachment = useCallback((file: FileContent, options?: AttachmentInsertOptions) => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		const typeId = getAttachmentTypeId(textarea);
		if (typeId == null) return;

		const attachment = toPromptAttachment(file);
		const badgeText = buildAttachmentText(file);
		const insertText = ` ${badgeText} `;
		const replaceRange = options?.replaceRange;

		let start = textarea.cursorOffset ?? (textarea.plainText?.length ?? 0);
		if (replaceRange && textarea.plainText != null && textarea.setText) {
			const before = textarea.plainText.slice(0, replaceRange.start);
			const after = textarea.plainText.slice(replaceRange.end);
			textarea.setText(`${before}${insertText}${after}`);
			start = before.length;
			textarea.cursorOffset = start + insertText.length;
		} else if (textarea.insertText) {
			textarea.insertText(insertText);
		} else if (textarea.setText) {
			const current = textarea.plainText ?? '';
			const offset = textarea.cursorOffset ?? current.length;
			textarea.setText(`${current.slice(0, offset)}${insertText}${current.slice(offset)}`);
			start = offset;
			textarea.cursorOffset = offset + insertText.length;
		}
		const end = textarea.cursorOffset ?? start + insertText.length;
		textarea.extmarks?.create({
			start,
			end: Math.max(start, end - 1),
			virtual: true,
			typeId,
			styleId: getAttachmentStyleId(textarea, attachment),
			priority: 10,
			metadata: { attachment, text: insertText } satisfies AttachmentMetadata,
		});
		syncAttachments();
	}, [syncAttachments]);

	// Expose PromptBarRef to parent
	useEffect(() => {
		if (!onGetPromptBar) return;
		onGetPromptBar({
			addAttachment,
			getAttachments() { return syncAttachments(); },
			clearAttachments() {
				textareaRef.current?.extmarks?.clear();
				attachmentsRef.current = [];
				setAttachments([]);
			},
			setText(text: string, cursorOffset?: number) {
				textareaRef.current?.setText?.(text);
				if (cursorOffset !== undefined && textareaRef.current) textareaRef.current.cursorOffset = cursorOffset;
			},
		});
	}, [addAttachment, onGetPromptBar, syncAttachments]);

	const handleContentChange = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea?.plainText) {
			syncAttachments();
			onTextChange?.('');
			setCharCount(0);
			setShowHint(false);
			return;
		}
		const text = stripAttachmentText(textarea.plainText, textarea);
		setCharCount(text.length);
		setShowHint(text.length >= COMPACT_THRESHOLD);
		syncAttachments();
		onTextChange?.(text);
	}, [onTextChange, syncAttachments]);

	useEffect(() => {
		const textarea = textareaRef.current;
		if (textarea && initialValue !== undefined && initialValue !== null) {
			const current = textarea.plainText ?? '';
			if (current !== initialValue) textarea.setText?.(initialValue);
		}
	}, [inputKey, initialValue]);

	useEffect(() => {
		if (onPositionChange && boxRef.current) {
			const updatePosition = () => {
				const el = boxRef.current as { y?: number; x?: number; width?: number } | null;
				if (el) onPositionChange({ top: el.y ?? 0, left: el.x ?? 0, width: el.width ?? 0 });
			};
			const interval = setInterval(updatePosition, 100);
			return () => clearInterval(interval);
		}
	}, [onPositionChange]);

	const handleSubmit = useCallback(() => {
		const textarea = textareaRef.current;
		const text = stripAttachmentText(textarea?.plainText ?? '', textarea).trim();
		const currentAttachments = syncAttachments();
		if (!text && currentAttachments.length === 0) return;
		onSubmit({ text, attachments: currentAttachments });
		textarea?.extmarks?.clear();
		attachmentsRef.current = [];
		setAttachments([]);
		setShowHint(false);
		setCharCount(0);
	}, [onSubmit, syncAttachments]);

	const handlePaste = useCallback(async (event: { bytes?: Uint8Array; preventDefault?: () => void }) => {
		if (!event.bytes || event.bytes.length === 0) { const clipboardFile = await readClipboardAttachment(); if (clipboardFile) { addAttachment(clipboardFile); event.preventDefault?.(); } return; }
		const pastedFile = readPastedBytesAttachment(event.bytes);
		if (pastedFile) {
			addAttachment(pastedFile);
			event.preventDefault?.();
			return;
		}
		const decoder = new TextDecoder();
		const raw = decoder.decode(event.bytes).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const pastedContent = raw.trim();

		if (!pastedContent) {
			const clipboardFile = await readClipboardAttachment();
			if (clipboardFile) {
				addAttachment(clipboardFile);
				event.preventDefault?.();
			}
			return;
		}

		const filePath = resolvePastedFilePath(pastedContent, process.platform);
		if (filePath) {
			event.preventDefault?.();
			const attachment = await readLocalAttachment(filePath);
			if (attachment) {
				addAttachment(attachment);
			}
		}
	}, [addAttachment]);

	if (!hasModel && !isLoading) {
		return (
			<box flexDirection="row">
				<box width={1} backgroundColor={c.accent} height={'auto'} />
				<box flexDirection="row" alignItems="center" backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} width={width ?? 'auto'}>
					<text fg={c.warn}>●</text>
					<text fg={c.dim}> Connect a provider to get started — </text>
					<text fg={c.accent}>Ctrl+P</text>
					<text fg={c.dim}> → connect provider</text>
				</box>
			</box>
		);
	}

	return (
		<box flexDirection="column" ref={(r: unknown) => { boxRef.current = r; }}>
			<box flexDirection="row">
				<box width={1} backgroundColor={c.accent} height={'auto'} />
				<box flexDirection="row" alignItems="center" backgroundColor={c.bgBar} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} width={width ?? 'auto'}>
					<box flexDirection="column" flexGrow={1} paddingLeft={2}>
						{showHint && (
							<box height={1}><text fg={c.warn}>{charCount.toLocaleString()} chars</text></box>
						)}
						<box minHeight={1} maxHeight={6}>
							<box flexDirection="row" flexGrow={1} gap={1}>
								<text fg={attachments.length > 0 ? attachments[0]?.badge.color ?? c.accent : c.accent}>›</text>
								<box flexGrow={1}>
									<textarea
										key={inputKey}
										placeholder={isLoading ? 'Streaming...' : placeholder}
										minHeight={1}
										maxHeight={6}
										width={'100%'}
										initialValue={initialValue}
										keyBindings={[
											{ name: 'return', action: 'submit' },
											{ name: 'return', shift: true, action: 'newline' },
										]}
										ref={(r: unknown) => { textareaRef.current = r as TextareaLike; onGetTextarea?.(r); }}
										onContentChange={handleContentChange}
										onPaste={handlePaste}
										onSubmit={handleSubmit}
										focused={focused}
									/>
								</box>
							</box>
						</box>
						<box height={1} />
						<box flexDirection="row" justifyContent="space-between" alignItems="center" height={1}>
							<box flexDirection="row" gap={2} alignItems="center">
								<text fg={c.accent}>{titlecase(agent)}</text>
								<text fg={c.dim}>{model}</text>
								<text fg={c.subtext}>{provider}</text>
								{thinkingEffort && thinkingEffort !== 'none' && <text fg={c.warn}>{thinkingEffort}</text>}
							</box>
							{tokenUsage && (
								<box flexDirection="row" gap={1} height={1}>
									{elapsedMs != null && <text fg={c.dim}>{(elapsedMs / 1000).toFixed(1)}s</text>}
									<text fg="#6ABFA0">↑{tokenUsage.input}</text>
									<text fg="#D0A880">↓{tokenUsage.output}</text>
								</box>
							)}
						</box>
					</box>
				</box>
			</box>
		</box>
	);
}
