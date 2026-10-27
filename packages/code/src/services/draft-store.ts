import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getGlobalConfigDir } from '../utils/paths.js';

const DRAFTS_DIR = 'drafts';

function draftPath(sessionId: string): string {
	return join(getGlobalConfigDir(), DRAFTS_DIR, `${encodeURIComponent(sessionId)}.txt`);
}

/**
 * Persist an unsent draft for a session. Empty text removes the sidecar so a
 * clean exit never restores a stale draft.
 */
export function saveDraft(sessionId: string, text: string): void {
	try {
		const path = draftPath(sessionId);
		if (!text.trim()) {
			rmSync(path, { force: true });
			return;
		}
		mkdirSync(join(getGlobalConfigDir(), DRAFTS_DIR), { recursive: true });
		writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 });
	} catch {
		// Draft persistence must never block shutdown.
	}
}

/** Read and delete the draft for a session. */
export function consumeDraft(sessionId: string): string | null {
	try {
		const path = draftPath(sessionId);
		if (!existsSync(path)) return null;
		const text = readFileSync(path, 'utf8');
		rmSync(path, { force: true });
		return text;
	} catch {
		return null;
	}
}

export function clearDraft(sessionId: string): void {
	try {
		rmSync(draftPath(sessionId), { force: true });
	} catch {
		// Ignore missing or locked files.
	}
}
