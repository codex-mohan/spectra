import { useRef, useEffect, useState, useCallback } from 'react';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { useKeyboard } from '@opentui/react';
import { c } from '../theme.js';
import type { PromptBarRef } from '../prompt-bar.js';
import { getDisplayIcon, getFileVisual } from '../utils/file-visuals.js';
import { detectMime } from '../utils/local-attachment.js';

export interface FileAutocompleteProps {
	draftText: string;
	promptTop?: number;
	promptLeft?: number;
	promptWidth?: number;
	termWidth: number;
	termHeight: number;
	route: 'home' | 'chat';
	promptBarRef: React.MutableRefObject<PromptBarRef | null>;
}

interface FileEntry {
	path: string;
	name: string;
	isDirectory: boolean;
	score: number;
}

interface Trigger {
	start: number;
	end: number;
	query: string;
	range?: { start: number; end: number };
}

const MAX_LIST_ROWS = 8;
const MIN_LIST_ROWS = 3;
const MENU_CHROME = 3;
const MAX_SCAN_RESULTS = 2500;
const MAX_DEPTH = 8;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.next', '__pycache__', '.venv', 'vendor']);
const IGNORED_EXTS = new Set(['.exe', '.dll', '.so', '.dylib', '.o', '.a', '.pyc', '.wasm', '.lock']);
const recentSelections: string[] = [];

// Cache project entries across @ triggers so the menu appears instantly
let cachedCwd = '';
let cachedEntries: Omit<FileEntry, 'score'>[] = [];
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000;

async function getProjectEntries(): Promise<Omit<FileEntry, 'score'>[]> {
	const cwd = process.cwd();
	const now = Date.now();
	if (cachedCwd === cwd && cachedEntries.length !== 0 && now < cacheExpiry) {
		return cachedEntries;
	}
	const out: Omit<FileEntry, 'score'>[] = [];
	await walk(cwd, '', 0, out);
	cachedCwd = cwd;
	cachedEntries = out;
	cacheExpiry = now + CACHE_TTL_MS;
	return out;
}

export function FileAutocomplete(props: FileAutocompleteProps) {
	const { draftText, promptTop, promptLeft, promptWidth, termWidth, termHeight, route, promptBarRef } = props;
	const [selected, setSelected] = useState(0);
	const [trigger, setTrigger] = useState<Trigger | null>(null);
	const scrollRef = useRef<Record<string, unknown>>(null);
	const [files, setFiles] = useState<FileEntry[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const next = findAtTrigger(draftText);
		setTrigger(next);
		setSelected(0);
	}, [draftText]);

	useEffect(() => {
		if (!trigger) {
			setFiles([]);
			return;
		}
		let cancelled = false;
		setLoading(true);

		(async () => {
			try {
				const entries = await getProjectEntries();
				if (cancelled) return;
				const ranked = entries
					.map((entry) => ({ ...entry, score: scoreEntry(entry.path, entry.name, trigger.query) }))
					.filter((entry) => entry.score < Number.POSITIVE_INFINITY)
					.sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
				if (!cancelled) setFiles(ranked.slice(0, MAX_LIST_ROWS));
			} catch {
				if (!cancelled) setFiles([]);
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => { cancelled = true; };
	}, [trigger]);

	const navigateToPath = useCallback((path: string) => {
		if (!trigger) return;
		const newText = '@' + path;
		promptBarRef.current?.setText(newText, newText.length);
		setSelected(0);
	}, [trigger, promptBarRef]);

	const confirmFile = useCallback(async (file: FileEntry) => {
		if (!trigger) return;
		const { readLocalAttachment } = await import('../utils/local-attachment.js');
		const attachment = await readLocalAttachment(file.path, trigger.range ? { textRange: trigger.range } : undefined);
		if (attachment) {
			promptBarRef.current?.addAttachment(attachment, { replaceRange: { start: trigger.start, end: trigger.end } });
			rememberSelection(file.path);
		}
		setTrigger(null);
		setFiles([]);
	}, [promptBarRef, trigger]);

	const handleSelect = useCallback(async (file: FileEntry, viaTab: boolean) => {
		if (file.isDirectory) {
			navigateToPath(file.path);
		} else if (viaTab) {
			navigateToPath(file.path);
		} else {
			await confirmFile(file);
		}
	}, [navigateToPath, confirmFile]);

	useKeyboard((key) => {
		if (!trigger) return;
		if (key.name === 'escape') {
			setTrigger(null);
			setFiles([]);
			return;
		}
		if (files.length === 0) return;
		if (key.name === 'up') {
			setSelected((p) => (p > 0 ? p - 1 : files.length - 1));
			return;
		}
		if (key.name === 'down') {
			setSelected((p) => (p < files.length - 1 ? p + 1 : 0));
			return;
		}
		if (key.name === 'tab') {
			const file = files[selected];
			if (file) void handleSelect(file, true);
			return;
		}
		if (key.name === 'return' || key.name === 'enter') {
			const file = files[selected];
			if (file) void handleSelect(file, false);
		}
	});

	if (!trigger) return null;

	const isChat = route === 'chat';
	const spaceAbove = isChat ? Math.max(0, (promptTop ?? termHeight) - MENU_CHROME - 1) : termHeight;
	const listH = Math.max(MIN_LIST_ROWS, Math.min(MAX_LIST_ROWS, files.length, spaceAbove));
	const mh = listH + MENU_CHROME;
	const menuLeft = promptLeft ?? 3;
	const menuWidth = promptWidth ?? Math.min(50, termWidth - 8);
	const menuTop = isChat ? (promptTop ?? termHeight) - mh - 1 : Math.floor(termHeight / 2) - mh - 2;

	return (
		<box
			position="absolute"
			left={menuLeft}
			top={menuTop}
			width={menuWidth}
			height={mh}
			zIndex={100}
			backgroundColor={c.bgCard}
		>
			<box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between" alignItems="center">
				<box flexDirection="row" gap={1}>
					<text fg={c.accent}>@</text>
					<text fg={c.text}>{trigger.query || 'files'}</text>
				</box>
				<text fg={c.dim}>{loading ? 'searching...' : `${files.length} results`}</text>
			</box>
			<box height={1} paddingLeft={1} paddingRight={1}>
				<text fg={c.border}>{'─'.repeat(Math.max(0, menuWidth - 2))}</text>
			</box>
			{loading && files.length === 0 && (
				<box height={1} paddingLeft={1} paddingRight={1}>
					<text fg={c.dim}>Scanning project files...</text>
				</box>
			)}
			{!loading && files.length === 0 && (
				<box height={1} paddingLeft={1} paddingRight={1}>
					<text fg={c.dim}>No matching files</text>
				</box>
			)}
			{files.length > 0 && (
				<scrollbox ref={(r: unknown) => { scrollRef.current = r as Record<string, unknown>; }} maxHeight={listH} scrollY={true} scrollbarOptions={{ visible: false }}>
					<box flexDirection="column">
						{files.map((file, i) => {
							const isSel = i === selected;
							const mime = file.isDirectory ? 'application/x-directory' : detectMime(file.path);
							const visual = getFileVisual({ filename: file.name, mime });
							return (
								<box
									key={file.path}
									height={1}
									paddingLeft={1}
									paddingRight={1}
									backgroundColor={isSel ? c.bgSelect : c.bgCard}
									flexDirection="row"
									justifyContent="space-between"
									alignItems="center"
									onMouseDown={() => { setSelected(i); void handleSelect(file, false); }}
								>
									<box flexDirection="row" gap={1}>
										<text fg={visual.color}>{getDisplayIcon({ filename: file.name, mime })}</text>
										<text fg={isSel ? c.accent : c.text}>{file.path}</text>
									</box>
									<text fg={c.dim}>{file.isDirectory ? 'dir' : visual.label}</text>
								</box>
							);
						})}
					</box>
				</scrollbox>
			)}
			<box height={1} paddingLeft={1} paddingRight={1} flexDirection="row" justifyContent="space-between">
				<text fg={c.dim}>↑↓ navigate</text>
				<text fg={c.dim}>tab/enter select · esc dismiss</text>
			</box>
		</box>
	);
}

export function findAtTrigger(text: string): Trigger | null {
	const head = text;
	const match = /(^|\s)@([^\s]*)$/.exec(head);
	if (!match) return null;
	const token = match[2] ?? '';
	const tokenStart = head.length - token.length - 1;
	const [queryPart, rangePart] = token.split('#', 2);
	return {
		start: tokenStart,
		end: head.length,
		query: (queryPart ?? '').toLowerCase(),
		range: parseLineRange(rangePart),
	};
}

function parseLineRange(value: string | undefined): { start: number; end: number } | undefined {
	if (!value) return undefined;
	const match = /^(\d+)(?:-(\d+))?$/.exec(value);
	if (!match) return undefined;
	const start = Number(match[1]);
	const end = Number(match[2] ?? match[1]);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return undefined;
	return { start, end };
}

async function walk(base: string, rel: string, depth: number, out: Omit<FileEntry, 'score'>[]): Promise<void> {
	if (depth > MAX_DEPTH || out.length >= MAX_SCAN_RESULTS) return;
	let entries;
	try {
		entries = await readdir(join(base, rel), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (out.length >= MAX_SCAN_RESULTS) return;
		if (IGNORED_DIRS.has(entry.name)) continue;
		if (entry.name.startsWith('.') && entry.name !== '.env') continue;
		const path = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			out.push({ path: `${path}/`, name: entry.name, isDirectory: true });
			await walk(base, path, depth + 1, out);
			continue;
		}
		const dot = entry.name.lastIndexOf('.');
		if (dot >= 0 && IGNORED_EXTS.has(entry.name.slice(dot).toLowerCase())) continue;
		out.push({ path, name: entry.name, isDirectory: false });
	}
}

function scoreEntry(path: string, name: string, query: string): number {
	if (!query) return 100 + recentPenalty(path);
	const lowerName = name.toLowerCase();
	const lowerPath = path.toLowerCase();
	if (lowerName === query) return recentPenalty(path);
	if (lowerName.startsWith(query)) return 10 + lowerName.length - query.length + recentPenalty(path);
	if (lowerPath.startsWith(query)) return 25 + lowerPath.length - query.length + recentPenalty(path);
	const fuzzy = fuzzyScore(lowerPath, query);
	if (fuzzy == null) return Number.POSITIVE_INFINITY;
	return 50 + fuzzy + recentPenalty(path);
}

function fuzzyScore(candidate: string, query: string): number | null {
	let score = 0;
	let last = -1;
	for (const ch of query) {
		const index = candidate.indexOf(ch, last + 1);
		if (index < 0) return null;
		score += index - last - 1;
		last = index;
	}
	return score;
}

function recentPenalty(path: string): number {
	const index = recentSelections.indexOf(path);
	return index < 0 ? 0 : -30 + index;
}

function rememberSelection(path: string): void {
	const existing = recentSelections.indexOf(path);
	if (existing >= 0) recentSelections.splice(existing, 1);
	recentSelections.unshift(path);
	recentSelections.length = Math.min(recentSelections.length, 20);
}
