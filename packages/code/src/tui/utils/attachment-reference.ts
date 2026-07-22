export interface AttachmentReference {
	filename: string;
	mime: string;
	metadata?: {
		sizeBytes?: number;
		width?: number;
		height?: number;
		durationMs?: number;
		files?: number;
	};
}

export function formatAttachmentMetadata(input: Pick<AttachmentReference, 'metadata'>): string {
	const metadata = input.metadata;
	if (!metadata) return '';

	const parts: string[] = [];
	if (metadata.width != null && metadata.height != null) parts.push(`${metadata.width}×${metadata.height}`);
	if (metadata.durationMs != null) parts.push(formatDuration(metadata.durationMs));
	if (metadata.files != null) parts.push(`${metadata.files} files`);
	if (metadata.sizeBytes != null) parts.push(formatSize(metadata.sizeBytes));
	return parts.join(' ');
}

/**
 * Creates stable, model-visible references for attachments in a user prompt.
 * The binary file blocks remain the source of attachment content.
 */
export function formatAttachmentReferences(attachments: readonly AttachmentReference[]): string {
	let imageNumber = 0;
	let fileNumber = 0;

	return attachments.map((attachment) => {
		const label = attachment.mime.startsWith('image/')
			? `Image #${++imageNumber}`
			: `File #${++fileNumber}`;
		const metadata = formatAttachmentMetadata(attachment);
		return `[${[label, metadata].filter(Boolean).join(', ')}]`;
	}).join('\n');
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
