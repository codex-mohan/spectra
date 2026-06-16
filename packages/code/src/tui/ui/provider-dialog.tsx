import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { c } from '../theme.js';
import { write, type ApiCredential } from '../../services/auth-store.js';
import { listProviders, getModels } from '@mohanscodex/spectra-ai';
import { loadConfig } from '../../services/config.js';
import { PROVIDER_META, resolveMetaKey, getApiKeyDesc } from '../utils/provider-meta.js';

// ── Shared select list ──

function SelectDialog(props: {
	items: { id: string; name: string; desc: string; cat?: string }[];
	placeholder: string;
	onSelect: (id: string, name: string) => void;
	onCancel: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler: (fn: ((key: any) => void) | null) => void;
}) {
	const { items, placeholder, onSelect, onCancel, termWidth, termHeight, registerHandler } = props;
	const mw = Math.min(64, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = Math.min(22, termHeight - 4);
	const mt = Math.max(1, Math.floor((termHeight - mh) / 2));
	const listH = mh - 5;
	const [filter, setFilter] = useState('');
	const [sel, setSel] = useState(0);
	const scrollRef = useRef<any>(null);

	const filtered = useMemo(() => {
		const q = filter.toLowerCase();
		if (!q) return items;
		return items.filter((i) => i.name.toLowerCase().includes(q) || i.id.includes(q) || i.desc.includes(q));
	}, [filter, items]);

	useEffect(() => {
		if (!scrollRef.current || !filtered[sel]) return;
		const el = scrollRef.current;
		if (typeof el.scrollChildIntoView === 'function') {
			el.scrollChildIntoView(filtered[sel].id);
		} else {
			const child = el.getChildren?.()?.find?.((ch: any) => ch.id === filtered[sel].id);
			if (child) {
				const y = child.y - (el.y || 0);
				if (y >= (el.height || listH)) el.scrollBy?.(y - (el.height || listH) + 1);
				if (y < 0) el.scrollBy?.(y);
			}
		}
	}, [sel, filtered, listH]);

	useEffect(() => {
		registerHandler((key: any) => {
			if (key.name === 'escape') {
				onCancel();
				return;
			}
			if (key.name === 'return' || key.name === 'enter') {
				if (filtered.length > 0) {
					onSelect(filtered[sel].id, filtered[sel].name);
					return;
				}
				return;
			}
			if (key.name === 'up') {
				setSel((p) => (p > 0 ? p - 1 : filtered.length - 1));
				return;
			}
			if (key.name === 'down') {
				setSel((p) => (p < filtered.length - 1 ? p + 1 : 0));
				return;
			}
			if (key.name === 'backspace') {
				setFilter((p) => p.slice(0, -1));
				setSel(0);
				return;
			}
			if (key.name.length === 1 && !key.ctrl && !key.meta) {
				setFilter((p) => p + key.name);
				setSel(0);
				return;
			}
		});
		return () => registerHandler(null);
	}, [filtered, sel, onSelect, onCancel, registerHandler]);

	// Build rows — items are pre-sorted by category so each header appears once.
	const rows: any[] = [];
	let prevCat = '';
	for (let i = 0; i < filtered.length; i++) {
		const it = filtered[i];
		const cat = it.cat || '';
		if (cat && cat !== prevCat) {
			if (prevCat) rows.push(<box key={`gap-${cat}`} height={1} backgroundColor={c.bgCard} />);
			prevCat = cat;
			rows.push(
				<box key={`cat-${cat}`} height={1} paddingLeft={2} backgroundColor={c.bgCard}>
					<text fg={c.warn} attributes={1}>
						{cat}
					</text>
				</box>,
			);
		}
		rows.push(
			<box
				key={it.id}
				id={it.id}
				height={1}
				paddingX={1}
				backgroundColor={i === sel ? c.bgSelect : c.bgCard}
				flexDirection="row"
				justifyContent="space-between"
				alignItems="center"
			>
				<text fg={i === sel ? c.accent : c.text} overflow="hidden" wrapMode="none" flexGrow={1} paddingLeft={1}>
					{it.name}
				</text>
				<text fg={c.dim} flexShrink={0}>
					{it.desc}
				</text>
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
			>
				<box
					paddingX={2}
					paddingTop={1}
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
					height={1}
				>
					<box flexDirection="row" gap={1}>
						<text fg={c.accent}>{'>'}</text>
						<text fg={c.text}>{filter || placeholder}</text>
					</box>
					<box flexDirection="row" height={1}>
						<text fg={c.dim}>esc</text>
					</box>
				</box>
				<box height={1} />
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(mw - 4)}</text>
				</box>
				<scrollbox
					ref={(r: any) => {
						scrollRef.current = r;
					}}
					paddingX={1}
					maxHeight={listH}
					scrollY={true}
					scrollbarOptions={{ visible: false }}
				>
					<box flexDirection="column">
						{rows.length === 0 ? (
							<box height={1} paddingX={1} backgroundColor={c.bgCard}>
								<text fg={c.dim}>No matches</text>
							</box>
						) : (
							rows
						)}
					</box>
				</scrollbox>
				<box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="center">
					<text fg={c.dim}>
						{'\u2191\u2193'} navigate · {'\u23CE'} select · esc close
					</text>
				</box>
			</box>
		</box>
	);
}

// ── API key input ──

function ApiKeyDialog(props: {
	providerName: string;
	providerId: string;
	onSubmit: (key: string) => void;
	onCancel: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler: (fn: ((key: any) => void) | null) => void;
}) {
	const { providerName, providerId, onSubmit, onCancel, termWidth, termHeight, registerHandler } = props;
	const mw = Math.min(64, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = 10;
	const mt = Math.max(1, Math.floor((termHeight - mh) / 2));
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);
	const [err, setErr] = useState('');
	const keyDoneRef = useRef(false);

	useEffect(() => {
		registerHandler((key: any) => {
			if (key.name === 'escape' && !keyDoneRef.current) {
				onCancel();
				return;
			}
		});
		return () => registerHandler(null);
	}, [onCancel, registerHandler]);

	const handleSubmit = (value: string) => {
		const val = String(value).trim();
		if (!val || keyDoneRef.current) return;
		keyDoneRef.current = true;
		setBusy(true);
		try {
			write(providerId, { type: 'api', key: val } as ApiCredential);
			setDone(true);
			setTimeout(() => onSubmit(val), 400);
		} catch (e) {
			setErr(String(e));
			setBusy(false);
			keyDoneRef.current = false;
		}
	};

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box
				position="absolute"
				left={ml}
				top={mt}
				width={mw}
				height={mh}
				backgroundColor={c.bgCard}
				padding={2}
				flexDirection="column"
				gap={1}
			>
				<text fg={c.accent} attributes={1}>
					{providerName} API Key
				</text>
				<text fg={c.dim}>{getApiKeyDesc(providerId, providerName)}</text>
				<box flexDirection="row" alignItems="center" gap={1}>
					<text fg={c.accent}>›</text>
					<box flexGrow={1}>
						<input
							key="apikey-input"
							placeholder="sk-..."
							onSubmit={(v) => handleSubmit(String(v))}
							focused={true}
						/>
					</box>
				</box>
				{done && <text fg={c.success}>✓ Saved</text>}
				{busy && !done && <text fg={c.dim}>Saving...</text>}
				{err && <text fg={c.error}>{err}</text>}
			</box>
		</box>
	);
}

// ── Manual model ID input ──

function ModelInputDialog(props: {
	providerName: string;
	onSubmit: (modelId: string) => void;
	onCancel: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler: (fn: ((key: any) => void) | null) => void;
}) {
	const { providerName, onSubmit, onCancel, termWidth, termHeight, registerHandler } = props;
	const mw = Math.min(64, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = 8;
	const mt = Math.max(1, Math.floor((termHeight - mh) / 2));

	useEffect(() => {
		registerHandler((key: any) => {
			if (key.name === 'escape') {
				onCancel();
			}
		});
		return () => registerHandler(null);
	}, [onCancel, registerHandler]);

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box
				position="absolute"
				left={ml}
				top={mt}
				width={mw}
				height={mh}
				backgroundColor={c.bgCard}
				padding={2}
				flexDirection="column"
				gap={1}
			>
				<text fg={c.accent} attributes={1}>
					{providerName} — Enter Model ID
				</text>
				<text fg={c.dim}>Type the exact model ID and press Enter</text>
				<box flexDirection="row" alignItems="center" gap={1}>
					<text fg={c.accent}>›</text>
					<box flexGrow={1}>
						<input
							key="model-id-input"
							placeholder="e.g. claude-sonnet-4-5"
							onSubmit={(v) => {
								const val = String(v).trim();
								if (val) onSubmit(val);
							}}
							focused={true}
						/>
					</box>
				</box>
				<text fg={c.dim}>enter confirm · esc cancel</text>
			</box>
		</box>
	);
}

// ── Root ──

export interface ProviderDialogProps {
	termWidth: number;
	termHeight: number;
	onModelSelected: (modelId: string, providerId: string) => void;
	onClose: () => void;
	keyHandlerRef: { current: ((key: any) => void) | null };
}

type Step =
	| { phase: 'provider-list' }
	| { phase: 'api-key'; id: string; name: string }
	| { phase: 'model-select'; id: string; name: string }
	| { phase: 'model-input'; id: string; name: string };

export function ProviderDialog(props: ProviderDialogProps) {
	const { termWidth, termHeight, onModelSelected, onClose, keyHandlerRef } = props;
	const [step, setStep] = useState<Step>({ phase: 'provider-list' });
	const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);

	const registerHandler = useCallback(
		(fn: ((key: any) => void) | null) => {
			keyHandlerRef.current = fn;
		},
		[keyHandlerRef],
	);

	if (step.phase === 'provider-list') {
		const cfg = loadConfig();
		const customProviders = cfg.providers || {};

		// Build the builtin list from the registry, resolving each registry ID to
		// a canonical metadata key. Deduplicate so that `openai-completions` and
		// `openai-responses` both fold into a single "OpenAI" row.
		const seenMetaKeys = new Set<string>();
		const builtinItems = listProviders()
			.reduce<{ id: string; name: string; desc: string; cat: string }[]>((acc, registryId) => {
				const metaKey = resolveMetaKey(registryId);
				const meta = PROVIDER_META[metaKey];
				if (!meta || seenMetaKeys.has(metaKey)) return acc;
				seenMetaKeys.add(metaKey);
				// Use the canonical metaKey as the provider ID for API-key storage and
				// model lookup; openai-completions and openai-responses both map to "openai".
				acc.push({
					id: metaKey,
					name: meta.name,
					desc: meta.desc,
					cat: meta.popular ? 'Popular' : 'Providers',
				});
				return acc;
			}, [])
			// Sort so all Popular entries come first — prevents multiple section headers.
			.sort((a, b) => {
				if (a.cat === b.cat) return 0;
				return a.cat === 'Popular' ? -1 : 1;
			});

		const customItems = Object.entries(customProviders).map(([id, cfg]) => ({
			id,
			name: cfg.name || id,
			desc: cfg.baseUrl,
			cat: 'Custom',
		}));

		const items = [...builtinItems, ...customItems];
		return (
			<SelectDialog
				items={items}
				placeholder="Search providers..."
				termWidth={termWidth}
				termHeight={termHeight}
				onSelect={(id, name) => setStep({ phase: 'api-key', id, name })}
				onCancel={onClose}
				registerHandler={registerHandler}
			/>
		);
	}

	if (step.phase === 'api-key') {
		const cfg = loadConfig();
		const customCfg = cfg.providers?.[step.id];
		if (customCfg?.apiKey) {
			getModels(step.id).then((m) => {
				if (m.length > 0) {
					setModels(m);
					setStep({ phase: 'model-select', id: step.id, name: step.name });
				} else if (customCfg.models) {
					const customModels = Object.entries(customCfg.models).map(([id, meta]) => ({
						id,
						name: meta.name || id,
					}));
					setModels(customModels);
					setStep({ phase: 'model-select', id: step.id, name: step.name });
				} else {
					setStep({ phase: 'model-select', id: step.id, name: step.name });
				}
			});
			return null;
		}
		if (models === null) {
			getModels(step.id).then((m) => setModels(m));
		}
		return (
			<ApiKeyDialog
				providerName={step.name}
				providerId={step.id}
				termWidth={termWidth}
				termHeight={termHeight}
				onSubmit={() => setStep({ phase: 'model-select', id: step.id, name: step.name })}
				onCancel={onClose}
				registerHandler={registerHandler}
			/>
		);
	}

	if (step.phase === 'model-select') {
		const cfg = loadConfig();
		const customCfg = cfg.providers?.[step.id];
		const metaKey = resolveMetaKey(step.id);
		const providerMeta = PROVIDER_META[metaKey];

		let items: { id: string; name: string; desc: string; cat: string }[];
		if (models && models.length > 0) {
			// Models fetched live from the registry (API or local DB).
			items = models.map((m) => ({ id: m.id, name: m.name, desc: '', cat: 'Models' }));
		} else if (customCfg?.models) {
			// Models defined in the user's custom provider config.
			items = Object.entries(customCfg.models).map(([id, meta]) => ({
				id,
				name: meta.name || id,
				desc: '',
				cat: 'Models',
			}));
		} else if (providerMeta?.defaultModels && providerMeta.defaultModels.length > 0) {
			// Curated fallback list from provider-meta (e.g. opencode-zen).
			items = providerMeta.defaultModels.map((m) => ({ id: m.id, name: m.name, desc: '', cat: 'Models' }));
		} else {
			// Nothing known — route to free-form model ID input.
			return (
				<ModelInputDialog
					providerName={step.name}
					termWidth={termWidth}
					termHeight={termHeight}
					onSubmit={(modelId) => {
						onModelSelected(modelId, step.id);
						onClose();
					}}
					onCancel={onClose}
					registerHandler={registerHandler}
				/>
			);
		}

		// Append an "Enter manually" option at the bottom of any model list
		// so users can always type a custom/newer model ID.
		const manualEntry = { id: '__manual__', name: 'Enter model ID manually…', desc: '', cat: '' };

		return (
			<SelectDialog
				items={[...items, manualEntry]}
				placeholder="Search models..."
				termWidth={termWidth}
				termHeight={termHeight}
				onSelect={(id) => {
					if (id === '__manual__') {
						setStep({ phase: 'model-input', id: step.id, name: step.name });
					} else {
						onModelSelected(id, step.id);
						onClose();
					}
				}}
				onCancel={onClose}
				registerHandler={registerHandler}
			/>
		);
	}

	if (step.phase === 'model-input') {
		return (
			<ModelInputDialog
				providerName={step.name}
				termWidth={termWidth}
				termHeight={termHeight}
				onSubmit={(modelId) => {
					onModelSelected(modelId, step.id);
					onClose();
				}}
				onCancel={() => setStep({ phase: 'model-select', id: step.id, name: step.name })}
				registerHandler={registerHandler}
			/>
		);
	}

	return null;
}
