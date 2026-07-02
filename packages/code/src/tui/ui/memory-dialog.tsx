import { useEffect, useState } from 'react';
import { c } from '../theme.js';
import { readEntries, getMemoryUsage, addEntry, removeEntry, type MemoryTarget } from '../../services/memory.js';

interface MemoryDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
}

const TABS: { key: MemoryTarget; label: string }[] = [
	{ key: 'user', label: 'User' },
	{ key: 'memory', label: 'Memory' },
	{ key: 'project', label: 'Project' },
];

function isReturnKey(key: any) {
	return key.name === 'return' || key.name === 'enter' || key.sequence === '\r' || key.sequence === '\n';
}

function isBackspaceKey(key: any) {
	return key.name === 'backspace' || key.sequence === '\b' || key.sequence === '\x7f';
}

function printableKey(key: any): string | null {
	if (key.ctrl || key.meta) return null;
	if (key.name === 'space') return ' ';
	if (typeof key.name === 'string' && key.name.length === 1) return key.name;
	if (typeof key.sequence === 'string' && [...key.sequence].length === 1 && key.sequence >= ' ') return key.sequence;
	return null;
}

export function MemoryDialog({ onClose, termWidth, termHeight, registerHandler }: MemoryDialogProps) {
	const [tab, setTab] = useState<MemoryTarget>('user');
	const [entries, setEntries] = useState<string[]>([]);
	const [usage, setUsage] = useState({ used: 0, limit: 0, entries: 0 });
	const [mode, setMode] = useState<'view' | 'add' | 'remove'>('view');
	const [input, setInput] = useState('');
	const [statusMsg, setStatusMsg] = useState('');
	const [selectedIdx, setSelectedIdx] = useState(0);

	const refresh = (target: MemoryTarget) => {
		setEntries(readEntries(target));
		setUsage(getMemoryUsage(target));
		setSelectedIdx(0);
	};

	const submitAdd = () => {
		const entry = input.trim();
		if (!entry) { setStatusMsg('Entry cannot be empty'); return; }
		const result = addEntry(tab, entry);
		setStatusMsg(result.message);
		if (result.success) {
			setInput('');
			setMode('view');
			refresh(tab);
		}
	};

	useEffect(() => { refresh(tab); }, [tab]);

	useEffect(() => {
		const handler = (key: any) => {
			if (key.name === 'escape') {
				if (mode !== 'view') { setMode('view'); setInput(''); setStatusMsg(''); return; }
				onClose();
				return;
			}
			if (mode === 'view') {
				if (key.name === 'tab' || key.name === 'right') {
					const idx = TABS.findIndex((t) => t.key === tab);
					setTab(TABS[(idx + 1) % TABS.length].key);
					return;
				}
				if (key.name === 'left') {
					const idx = TABS.findIndex((t) => t.key === tab);
					setTab(TABS[(idx - 1 + TABS.length) % TABS.length].key);
					return;
				}
				if (key.name === 'a') { setMode('add'); setInput(''); setStatusMsg(''); return; }
				if (key.name === 'r' && entries.length > 0) { setMode('remove'); setStatusMsg('Select entry to remove'); return; }
				if (key.name === 'up' && selectedIdx > 0) { setSelectedIdx(selectedIdx - 1); return; }
				if (key.name === 'down' && selectedIdx < entries.length - 1) { setSelectedIdx(selectedIdx + 1); return; }
			}
			if (mode === 'add') {
				if (isReturnKey(key)) { submitAdd(); return; }
				if (isBackspaceKey(key) || key.name === 'delete') { setInput((prev) => prev.slice(0, -1)); return; }
				const text = printableKey(key);
				if (text !== null) { setInput((prev) => prev + text); setStatusMsg(''); return; }
				return;
			}
			if (mode === 'remove') {
				if (key.name === 'return' || key.name === 'enter') {
					const entry = entries[selectedIdx];
					if (!entry) return;
					const result = removeEntry(tab, entry);
					setStatusMsg(result.message);
					if (result.success) { setMode('view'); refresh(tab); }
					return;
				}
				if (key.name === 'up' && selectedIdx > 0) { setSelectedIdx(selectedIdx - 1); return; }
				if (key.name === 'down' && selectedIdx < entries.length - 1) { setSelectedIdx(selectedIdx + 1); return; }
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler, tab, mode, input, entries, selectedIdx]);

	const mw = Math.min(70, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = Math.min(24, termHeight - 2);
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = mw - 4;

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" backgroundColor={c.bgCard}>
					<box height={1} flexDirection="row" gap={2}>
						{TABS.map((t) => (
							<text key={t.key} fg={tab === t.key ? c.accent : c.dim} attributes={tab === t.key ? 1 : 0}>
								{t.label}
							</text>
						))}
					</box>
					<text fg={c.dim}>esc</text>
				</box>
				<box height={1} />
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.dim}>{usage.entries} entries · {usage.used} of {usage.limit} chars used</text>
				</box>
				<box flexDirection="column" paddingX={2} gap={0} flexGrow={1}>
					{entries.length === 0 && (
						<text fg={c.dim}>No entries. Press 'a' to add.</text>
					)}
					{entries.map((entry, i) => (
						<text key={i} fg={i === selectedIdx && mode === 'remove' ? c.error : i === selectedIdx ? c.accent : c.text}>
							{i === selectedIdx ? '▸ ' : '  '}{entry.length > innerW - 4 ? entry.slice(0, innerW - 7) + '...' : entry}
						</text>
					))}
				</box>
				{mode === 'add' && (
					<box height={2} paddingX={2} flexDirection="column">
						<text fg={c.accent}>New entry:</text>
						<box height={1} flexDirection="row">
							<text fg={c.text}>{input}</text>
							<text fg={c.accent}>█</text>
						</box>
					</box>
				)}
				{statusMsg && (
					<box height={1} paddingX={2}>
						<text fg={mode === 'remove' ? c.error : c.dim}>{statusMsg}</text>
					</box>
				)}
				<box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center">
					<text fg={c.dim}>a add · r remove · tab switch scope</text>
				</box>
			</box>
		</box>
	);
}
