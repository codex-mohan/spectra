import { beforeEach, describe, expect, it, vi } from 'vitest';
import open from 'open';
import type { CliRenderer, MouseEvent } from '@opentui/core';
import { openLinkAtPointer } from '../tui/utils/link-open.js';

vi.mock('open', () => ({ default: vi.fn(() => Promise.resolve()) }));
vi.mock('../tui/components/toast.js', () => ({ showToast: vi.fn() }));

function mouseEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
	return {
		button: 0,
		x: 3,
		y: 2,
		modifiers: { shift: false, alt: false, ctrl: false },
		isDragging: false,
		stopPropagation: vi.fn(),
		...overrides,
	} as unknown as MouseEvent;
}

function rendererFor(link: string | null): Pick<CliRenderer, 'getLinkAt'> {
	return { getLinkAt: vi.fn(() => link) };
}

describe('transcript link clicks', () => {
	beforeEach(() => {
		vi.mocked(open).mockClear();
	});

	it('opens the link under a plain left click', async () => {
		await openLinkAtPointer(rendererFor('https://example.com'), mouseEvent());
		expect(open).toHaveBeenCalledWith('https://example.com');
	});

	it('leaves modified clicks to the terminal', async () => {
		await openLinkAtPointer(
			rendererFor('https://example.com'),
			mouseEvent({ modifiers: { shift: false, alt: false, ctrl: true } }),
		);
		expect(open).not.toHaveBeenCalled();
	});

	it('ignores clicks that are not over a link or are a drag', async () => {
		await openLinkAtPointer(rendererFor(null), mouseEvent());
		await openLinkAtPointer(rendererFor('https://example.com'), mouseEvent({ isDragging: true }));
		await openLinkAtPointer(rendererFor('https://example.com'), mouseEvent({ button: 2 }));
		expect(open).not.toHaveBeenCalled();
	});
});
