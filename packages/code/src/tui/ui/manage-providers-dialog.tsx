import { useState, useMemo, useEffect, useCallback } from 'react';
import { c } from '../theme.js';
import type { CustomProviderConfig } from '../../services/config.js';
import { getGlobalConfigDir } from '../../utils/paths.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { registerCustomProvider } from '../../services/custom-providers.js';

type DialogMode = 'list' | 'add' | 'edit' | 'delete-confirm';
type FormField = 'id' | 'name' | 'baseUrl' | 'apiKey' | 'model1' | 'model2' | 'model3';

const FORM_FIELDS: FormField[] = ['id', 'name', 'baseUrl', 'apiKey', 'model1', 'model2', 'model3'];

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
	const [formField, setFormField] = useState<FormField>('id');
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [err, setErr] = useState('');
	const [success, setSuccess] = useState('');

	const [fieldValues, setFieldValues] = useState<Record<FormField, string>>({
		id: '',
		name: '',
		baseUrl: '',
		apiKey: '',
		model1: '',
		model2: '',
		model3: '',
	});

	const mw = Math.min(72, termWidth - 4);
	const mh = Math.min(28, termHeight - 4);
	const mt = Math.max(1, Math.floor((termHeight - mh) / 2));

	const providerEntries = useMemo(() => Object.entries(providers), [providers]);

	useEffect(() => {
		if (listSel >= providerEntries.length && providerEntries.length > 0) setListSel(providerEntries.length - 1);
	}, [providerEntries.length, listSel]);

	const resetForm = useCallback(() => {
		setFieldValues({ id: '', name: '', baseUrl: '', apiKey: '', model1: '', model2: '', model3: '' });
		setFormField('id');
		setErr('');
	}, []);

	const handleSave = useCallback(() => {
		setErr('');
		if (!fieldValues.id.trim()) {
			setErr('Provider ID is required');
			return;
		}
		if (!fieldValues.baseUrl.trim()) {
			setErr('Base URL is required');
			return;
		}
		const id = fieldValues.id
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-_]/g, '-');
		const updated = { ...providers };
		const modelsObj: Record<string, { name?: string }> = {};
		for (const m of [fieldValues.model1, fieldValues.model2, fieldValues.model3]) {
			if (m.trim()) modelsObj[m.trim()] = { name: m.trim() };
		}
		updated[id] = {
			name: fieldValues.name.trim() || id,
			baseUrl: fieldValues.baseUrl.trim(),
			apiKey: fieldValues.apiKey.trim() || undefined,
			models: Object.keys(modelsObj).length > 0 ? modelsObj : undefined,
			enabled: true,
		};
		registerCustomProvider(id, updated[id]);
		saveProvidersToConfig(updated);
		onProvidersChange(updated);
		setSuccess(`Provider "${id}" ${mode === 'edit' ? 'updated' : 'added'}`);
		resetForm();
		setTimeout(() => {
			setMode('list');
			setSuccess('');
		}, 800);
	}, [fieldValues, mode, providers, onProvidersChange, resetForm]);

	const handleDeleteConfirm = useCallback(() => {
		if (!confirmDeleteId) return;
		const updated = { ...providers };
		delete updated[confirmDeleteId];
		saveProvidersToConfig(updated);
		onProvidersChange(updated);
		setConfirmDeleteId(null);
		setMode('list');
		setSuccess(`Provider "${confirmDeleteId}" removed`);
		setTimeout(() => setSuccess(''), 1500);
	}, [confirmDeleteId, providers, onProvidersChange]);

	useEffect(() => {
		registerHandler((key: any) => {
			if (key.name === 'escape') {
				if (mode === 'add' || mode === 'edit') {
					setMode('list');
					resetForm();
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
					resetForm();
					setMode('add');
					return;
				}
				if ((key.name === 'e' || key.name === 'E') && providerEntries.length > 0) {
					const id = providerEntries[listSel]?.[0];
					const cfg = providers[id];
					setFieldValues({
						id,
						name: cfg.name || id,
						baseUrl: cfg.baseUrl || '',
						apiKey: cfg.apiKey || '',
						model1: cfg.models ? Object.keys(cfg.models)[0] || '' : '',
						model2: cfg.models ? Object.keys(cfg.models)[1] || '' : '',
						model3: cfg.models ? Object.keys(cfg.models)[2] || '' : '',
					});
					setFormField('name');
					setMode('edit');
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
		});
		return () => registerHandler(null);
	}, [mode, listSel, providerEntries, confirmDeleteId, providers, onClose, registerHandler, resetForm, handleDeleteConfirm]);

	const setFieldValue = useCallback((field: FormField, value: string) => {
		setFieldValues((prev) => ({ ...prev, [field]: value }));
	}, []);

	const focusNext = useCallback(() => {
		setFormField((prev) => {
			const idx = FORM_FIELDS.indexOf(prev);
			return FORM_FIELDS[(idx + 1) % FORM_FIELDS.length];
		});
	}, []);

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
		rows.push(<box flexGrow={1} />);
		rows.push(
			<box height={1} paddingX={2}>
				<text fg={c.border}>{'─'.repeat(mw - 4)}</text>
			</box>,
			<box height={1} flexDirection="row" justifyContent="center" marginY={1}>
				<text fg={c.dim}>↑↓ navigate · a add · e edit · d delete · esc close</text>
			</box>,
		);
		if (success)
			rows.push(
				<box height={1} flexDirection="row" justifyContent="center">
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
			<box flexGrow={1} />,
			<box height={1} flexDirection="row" justifyContent="center" gap={3}>
				<text fg={c.error}>enter confirm</text>
				<text fg={c.dim}>esc cancel</text>
			</box>,
		);
	} else {
		const fieldDefs: { key: FormField; label: string; placeholder: string; optional?: boolean }[] = [
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
		for (const f of fieldDefs) {
			const isActive = formField === f.key;
			rows.push(
				<box key={f.key} height={1} paddingX={2} flexDirection="row" gap={1} alignItems="center">
					<text fg={isActive ? c.accent : c.dim} width={14} flexShrink={0}>
						{f.label}:
					</text>
					<box flexGrow={1} height={1}>
						<input
							key={`field-${f.key}`}
							placeholder={f.placeholder}
							value={fieldValues[f.key]}
							focused={isActive}
							onInput={(v: string) => setFieldValue(f.key, v)}
							onSubmit={() => {
								if (f.key === 'model3') handleSave();
								else focusNext();
							}}
						/>
					</box>
				</box>,
			);
		}
		rows.push(<box flexGrow={1} />);
		if (err)
			rows.push(
				<box height={1} flexDirection="row" justifyContent="center">
					<text fg={c.error}>{err}</text>
				</box>,
			);
		if (success)
			rows.push(
				<box height={1} flexDirection="row" justifyContent="center">
					<text fg={c.success}>{success}</text>
				</box>,
			);
		rows.push(
			<box height={1} marginBottom={1} flexDirection="row" justifyContent="center">
				<text fg={c.dim}>tab next field · enter save · esc cancel</text>
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
