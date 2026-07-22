import { describe, expect, it } from 'vitest';
import { formatAttachmentReferences } from '../tui/utils/attachment-reference.js';

describe('formatAttachmentReferences', () => {
	it('numbers images and includes their dimensions and size', () => {
		expect(formatAttachmentReferences([
			{ filename: 'first.png', mime: 'image/png', metadata: { width: 300, height: 400, sizeBytes: 1536 } },
			{ filename: 'second.webp', mime: 'image/webp', metadata: { width: 1200, height: 800 } },
		])).toBe('[Image #1, 300×400 1.5KB]\n[Image #2, 1200×800]');
	});

	it('keeps non-image attachments identifiable without inventing dimensions', () => {
		expect(formatAttachmentReferences([
			{ filename: 'spec.pdf', mime: 'application/pdf', metadata: { sizeBytes: 1024 } },
			{ filename: 'notes.txt', mime: 'text/plain' },
		])).toBe('[File #1, 1.0KB]\n[File #2]');
	});
});
