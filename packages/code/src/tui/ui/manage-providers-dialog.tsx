import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { c } from '../theme.js';
import type { CustomProviderConfig } from '../../services/config.js';
import { getGlobalConfigDir } from '../../utils/paths.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { registerCustomProvider } from '../../services/custom-providers.js';

type DialogMode = 'list' | 'add' | 'edit' | 'delete-confirm';
type FormField = 'id' | 'name' | 'baseUrl' | 'apiKey' | 'model1' | 'model2' | 'model3';

interface FormState {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	models: string[];
}

function saveProvidersToConfig(providers: Record<string, CustomProviderConfig>) {
	const configDir = getGlobalConfigDir();
	const configPath = join(configDir, 'spectra.json');
	let cfg: Record<string, unknown> = {};
	try {
		cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
	} catch {}
	cfg.providers = providers;
	if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
	writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

export function ManageProvidersDialog(props: {
	termWidth: number;
	termHeight: number;
	providers: Record<string, CustomProviderConfig>;
	onProvidersChange: (updated: Record<string, CustomProviderConfig>) => void;
	onClose: () => void;
	registerHandler: (fn: ((key: any) => void) | null) => void;
}) {
	const { termWidth, termHeight, providers, onProvidersChange, onClose, registerHandler } = props;
	const [mode, setMode] = useState<DialogMode>('list');
	const [listSel, setListSel] = useState(0);
	const [form, setForm] = useState<FormState>({ id: '', name: '', baseUrl: '', apiKey: '', models: ['', '', ''] });
	const [formField, setFormField] = useState<FormField>('id');
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [err, setErr] = useState('');
	const [success, setSuccess] = useState('');

	const mw = Math.min(72, termWidth - 4);
	const mh = Math.min(28, termHeight - 4);
	const mt = Math.max(1, Math.floor((termHeight - mh) / 2));

	const providerEntries = useMemo(() => Object.entries(providers), [providers]);

	useEffect(() => {
		if (listSel >= providerEntries.length && providerEntries.length > 0) setListSel(providerEntries.length - 1);
	}, [providerEntries.length, listSel]);

	useEffect(() => {
		registerHandler((key: any) => {
			if (key.name === 'escape') {
				if (mode === 'add' || mode === 'edit') {
					setMode('list');
					setErr('');
					setForm({ id: '', name: '', baseUrl: '', apiKey: '', models: ['', '', ''] });
					return;
				}
				if (mode === 'delete-confirm') {
					setConfirmDeleteId(null);
					setMode('list');
					return;
				}
				onClose();
				return;
			}
			if (mode === 'list') {
				if (key.name === 'up') {
					setListSel((p) => Math.max(0, p - 1));
					return;
				}
				if (key.name === 'down') {
					setListSel((p) => Math.min(providerEntries.length - 1, p + 1));
					return;
				}
				if (key.name === 'a' || key.name === 'A') {
					startAdd();
					return;
				}
				if ((key.name === 'e' || key.name === 'E') && providerEntries.length > 0) {
					startEdit(providerEntries[listSel]?.[0]);
					return;
				}
				if ((key.name === 'd' || key.name === 'D') && providerEntries.length > 0) {
					setConfirmDeleteId(providerEntries[listSel]?.[0]);
					setMode('delete-confirm');
					return;
				}
				return;
			}
			if (mode === 'delete-confirm') {
				if (key.name === 'return' || key.name === 'enter') {
					handleDeleteConfirm();
					return;
				}
				return;
			}
			if (mode === 'add' || mode === 'edit') {
				if (key.name === 'tab') {
					const fields: FormField[] = ['id', 'name', 'baseUrl', 'apiKey', 'model1', 'model2', 'model3'];
					const idx = fields.indexOf(formField);
					setFormField(fields[(idx + 1) % fields.length]);
					return;
				}
				if (key.name === 'return' || key.name === 'enter') {
					handleSave();
					return;
				}
				if (key.name.length === 1 && !key.ctrl && !key.meta) {
					appendToField(key.name);
					return;
				}
				if (key.name === 'backspace') {
					removeFromField();
					return;
				}
			}
		});
		return () => registerHandler(null);
	}, [mode, formField, form, listSel, providerEntries, confirmDeleteId]);

	const appendToField = (char: string) => {
		setForm((prev) => {
			const next = { ...prev };
			if (formField === 'id') next.id = prev.id + char;
			else if (formField === 'name') next.name = prev.name + char;
			else if (formField === 'baseUrl') next.baseUrl = prev.baseUrl + char;
			else if (formField === 'apiKey') next.apiKey = prev.apiKey + char;
			else if (formField === 'model1') next.models = [prev.models[0] + char, prev.models[1], prev.models[2]];
			else if (formField === 'model2') next.models = [prev.models[0], prev.models[1] + char, prev.models[2]];
			else if (formField === 'model3') next.models = [prev.models[0], prev.models[1], prev.models[2] + char];
			return next;
		});
	};

	const removeFromField = () => {
		setForm((prev) => {
			const next = { ...prev };
			if (formField === 'id') next.id = prev.id.slice(0, -1);
			else if (formField === 'name') next.name = prev.name.slice(0, -1);
			else if (formField === 'baseUrl') next.baseUrl = prev.baseUrl.slice(0, -1);
			else if (formField === 'apiKey') next.apiKey = prev.apiKey.slice(0, -1);
			else if (formField === 'model1') next.models = [prev.models[0].slice(0, -1), prev.models[1], prev.models[2]];
			else if (formField === 'model2') next.models = [prev.models[0], prev.models[1].slice(0, -1), prev.models[2]];
			else if (formField === 'model3') next.models = [prev.models[0], prev.models[1], prev.models[2].slice(0, -1)];
			return next;
		});
	};

	const handleSave = () => {
		setErr('');
		if (!form.id.trim()) {
			setErr('Provider ID is required');
			return;
		}
		if (!form.baseUrl.trim()) {
			setErr('Base URL is required');
			return;
		}
		const id = form.id
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-_]/g, '-');
		const updated = { ...providers };
		const modelsObj: Record<string, { name?: string }> = {};
		for (const m of form.models) {
			if (m.trim()) modelsObj[m.trim()] = { name: m.trim() };
		}
		updated[id] = {
			name: form.name.trim() || id,
			baseUrl: form.baseUrl.trim(),
			apiKey: form.apiKey.trim() || undefined,
			models: Object.keys(modelsObj).length > 0 ? modelsObj : undefined,
			enabled: true,
		};
		registerCustomProvider(id, updated[id]);
		saveProvidersToConfig(updated);
		onProvidersChange(updated);
		setSuccess(`Provider "${id}" ${mode === 'edit' ? 'updated' : 'added'}`);
		setForm({ id: '', name: '', baseUrl: '', apiKey: '', models: ['', '', ''] });
		setFormField('id');
		setTimeout(() => {
			setMode('list');
			setSuccess('');
		}, 800);
	};

	const handleDeleteConfirm = () => {
		if (!confirmDeleteId) return;
		const updated = { ...providers };
		delete updated[confirmDeleteId];
		saveProvidersToConfig(updated);
		onProvidersChange(updated);
		setConfirmDeleteId(null);
		setMode('list');
		setSuccess(`Provider "${confirmDeleteId}" removed`);
		setTimeout(() => setSuccess(''), 1500);
	};

	const startEdit = (id: string) => {
		const cfg = providers[id];
		setForm({
			id,
			name: cfg.name || id,
			baseUrl: cfg.baseUrl || '',
			apiKey: cfg.apiKey || '',
			models: cfg.models ? Object.keys(cfg.models).concat(['', '', '']).slice(0, 3) : ['', '', ''],
		});
		setFormField('name');
		setMode('edit');
	};

	const startAdd = () => {
		setForm({ id: '', name: '', baseUrl: '', apiKey: '', models: ['', '', ''] });
		setFormField('id');
		setMode('add');
	};

	const rows: any[] = [];
	if (mode === 'list') {
		rows.push(
			<box paddingX={2} paddingTop={1} height={1} flexDirection="row" justifyContent="space-between">
				<box flexDirection="row" gap={1}>
					<text fg={c.accent}>{'>'}</text>
					<text fg={c.text}>Manage Providers</text>
				</box>
				<box flexDirection="row" height={1}>
					<text fg={c.dim}>esc close</text>
				</box>
			</box>,
			<box height={1} paddingX={2}>
				<text fg={c.border}>{'─'.repeat(mw - 4)}</text>
			</box>,
		);
		if (providerEntries.length === 0) {
			rows.push(
				<box height={2} paddingX={2} flexDirection="column" gap={1}>
					<text fg={c.dim}>No custom providers configured</text>
					<text fg={c.dim}>Press "a" to add one</text>
				</box>,
			);
		} else {
			for (let i = 0; i < providerEntries.length; i++) {
				const [id, cfg] = providerEntries[i];
				const isSel = i === listSel;
				rows.push(
					<box
						key={id}
						height={2}
						paddingX={2}
						flexDirection="column"
						gap={0}
						backgroundColor={isSel ? c.bgSelect : undefined}
					>
						<box flexDirection="row" justifyContent="space-between">
							<text fg={isSel ? c.accent : c.text} attributes={isSel ? 1 : 0}>
								{cfg.name || id}
							</text>
							<text fg={c.dim}>{id}</text>
						</box>
						<box flexDirection="row" justifyContent="space-between">
							<text fg={c.dim}>{cfg.baseUrl}</text>
							<box flexDirection="row" gap={1}>
								<text fg={c.warn}>e edit</text>
								<text fg={c.error}>d delete</text>
							</box>
						</box>
					</box>,
				);
			}
		}
		rows.push(
			<box height={1} paddingX={2}>
				<text fg={c.border}>{'─'.repeat(mw - 4)}</text>
			</box>,
			<box height={1} paddingX={2}>
				<text fg={c.accent}>a add provider</text>
			</box>,
			<box height={1} paddingX={2}>
				<text fg={c.dim}>↑↓ navigate · a add · e edit · d delete · esc close</text>
			</box>,
		);
		if (success)
			rows.push(
				<box height={1} paddingX={2}>
					<text fg={c.success}>{success}</text>
				</box>,
			);
	} else if (mode === 'delete-confirm') {
		rows.push(
			<box paddingX={2} paddingTop={1} height={1}>
				<text fg={c.error} attributes={1}>
					Delete Provider
				</text>
			</box>,
			<box height={1} paddingX={2}>
				<text fg={c.border}>{'─'.repeat(mw - 4)}</text>
			</box>,
			<box height={1} paddingX={2}>
				<text fg={c.text}>Delete "{confirmDeleteId}"? This cannot be undone.</text>
			</box>,
			<box height={1} paddingX={2} flexDirection="row" gap={2}>
				<text fg={c.error}>enter confirm</text>
				<text fg={c.dim}>esc cancel</text>
			</box>,
		);
	} else {
		const fields: { key: FormField; label: string; placeholder: string; optional?: boolean }[] = [
			{ key: 'id', label: 'Provider ID', placeholder: 'my-provider' },
			{ key: 'name', label: 'Display Name', placeholder: 'My Provider', optional: true },
			{ key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com/v1' },
			{ key: 'apiKey', label: 'API Key', placeholder: 'sk-... (optional)', optional: true },
			{ key: 'model1', label: 'Model 1', placeholder: 'model-id-1 (optional)', optional: true },
			{ key: 'model2', label: 'Model 2', placeholder: 'model-id-2 (optional)', optional: true },
			{ key: 'model3', label: 'Model 3', placeholder: 'model-id-3 (optional)', optional: true },
		];
		rows.push(
			<box paddingX={2} paddingTop={1} height={1} flexDirection="row" justifyContent="space-between">
				<text fg={c.accent} attributes={1}>
					{mode === 'add' ? 'Add Provider' : 'Edit Provider'}
				</text>
				<text fg={c.dim}>esc cancel · tab next</text>
			</box>,
			<box height={1} paddingX={2}>
				<text fg={c.border}>{'─'.repeat(mw - 4)}</text>
			</box>,
		);
		for (const f of fields) {
			const isActive = formField === f.key;
			const value =
				f.key === 'id'
					? form.id
					: f.key === 'name'
						? form.name
						: f.key === 'baseUrl'
							? form.baseUrl
							: f.key === 'apiKey'
								? form.apiKey
								: f.key === 'model1'
									? form.models[0]
									: f.key === 'model2'
										? form.models[1]
										: form.models[2];
			rows.push(
				<box key={f.key} height={1} paddingX={2} flexDirection="row" gap={1}>
					<text fg={isActive ? c.accent : c.dim} width={14}>
						{f.label}:
					</text>
					<box flexGrow={1}>
						<text fg={isActive ? c.text : c.dim}>{value || (f.optional ? f.placeholder : f.placeholder)}</text>
						{isActive && <text fg={c.accent}>▌</text>}
					</box>
				</box>,
			);
		}
		rows.push(<box height={1} />);
		if (err)
			rows.push(
				<box height={1} paddingX={2}>
					<text fg={c.error}>{err}</text>
				</box>,
			);
		if (success)
			rows.push(
				<box height={1} paddingX={2}>
					<text fg={c.success}>{success}</text>
				</box>,
			);
		rows.push(
			<box height={1} paddingX={2}>
				<text fg={c.dim}>enter save · esc cancel · tab next field</text>
			</box>,
		);
	}

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box
				position="absolute"
				left={Math.floor((termWidth - mw) / 2)}
				top={mt}
				width={mw}
				height={mh}
				backgroundColor={c.bgCard}
				flexDirection="column"
			>
				{rows}
			</box>
		</box>
	);
}
