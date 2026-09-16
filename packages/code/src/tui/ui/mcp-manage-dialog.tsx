import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';
import {
	findMcpScope,
	loadConfig,
	removeMcpServerConfig,
	saveMcpServer,
	setMcpServerEnabled,
	type McpConfig,
	type McpScope,
} from '../../services/config.js';
import {
	connectServer,
	disconnectServer,
	formatArguments,
	listConnectedServers,
	MCP_PRESETS,
	parseMcpServersJson,
	splitArguments,
	type McpPreset,
	type McpServerConfig,
} from '../../integrations/mcp/index.js';

export interface McpManageDialogProps {
	termWidth: number;
	termHeight: number;
	onClose: () => void;
	registerHandler: (fn: ((key: any) => void) | null) => void;
}

type Mode = 'list' | 'source' | 'presets' | 'json' | 'json-preview' | 'form' | 'confirm-delete';
type Source = 'stdio' | 'http' | 'json' | 'presets';
type Transport = 'stdio' | 'http';
type FieldId = 'name' | 'command' | 'args' | 'env' | 'url' | 'headers' | 'timeout';
type RowId = FieldId | 'scope';

interface ListItem {
	server: McpConfig;
	scope: McpScope;
	connected: boolean;
	tools: number;
}

const SCOPES: readonly McpScope[] = ['project', 'global'];

const EMPTY_VALUES: Record<FieldId, string> = {
	name: '',
	command: '',
	args: '',
	env: '',
	url: '',
	headers: '',
	timeout: '',
};

const FIELD_DEFS: Record<FieldId, { label: string; placeholder: string }> = {
	name: { label: 'Name', placeholder: 'filesystem' },
	command: { label: 'Command', placeholder: 'npx' },
	args: { label: 'Arguments', placeholder: '-y @modelcontextprotocol/server-filesystem "C:/Program Files/app"' },
	env: { label: 'Env', placeholder: 'KEY=VALUE, KEY2=VALUE2' },
	url: { label: 'URL', placeholder: 'https://example.com/mcp' },
	headers: { label: 'Headers', placeholder: 'Authorization=Bearer token' },
	timeout: { label: 'Timeout (ms)', placeholder: '30000' },
};

const FORM_ROWS: Record<Transport, readonly RowId[]> = {
	stdio: ['name', 'command', 'args', 'env', 'timeout', 'scope'],
	http: ['name', 'url', 'headers', 'timeout', 'scope'],
};

const SOURCES: ReadonlyArray<{ id: Source; label: string; hint: string }> = [
	{ id: 'stdio', label: 'Local process', hint: 'Runs a command on this machine' },
	{ id: 'http', label: 'Remote URL', hint: 'Connects to a hosted MCP endpoint' },
	{ id: 'json', label: 'Paste JSON', hint: 'Import an mcpServers block from a config file' },
	{ id: 'presets', label: 'Preset catalog', hint: 'Start from a known server' },
];

const PLACEHOLDER = /<[^<>]+>/;

function hasPlaceholder(value: string): boolean {
	return PLACEHOLDER.test(value);
}

function presetNeedsInput(preset: McpPreset): boolean {
	return (preset.args ?? []).some(hasPlaceholder)
		|| Object.values(preset.env ?? {}).some(hasPlaceholder);
}

function parsePairs(raw: string): Record<string, string> | undefined {
	const pairs: Record<string, string> = {};
	for (const entry of raw.split(',')) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const separator = trimmed.indexOf('=');
		if (separator <= 0) continue;
		pairs[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
	}
	return Object.keys(pairs).length > 0 ? pairs : undefined;
}

function formatPairs(pairs: Record<string, string> | undefined): string {
	return pairs ? Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join(', ') : '';
}

function serverTarget(server: McpConfig): string {
	if (server.command) return [server.command, ...(server.args ?? [])].join(' ');
	return server.url ?? '(no target)';
}

function toServerConfig(server: McpConfig): McpServerConfig {
	return {
		name: server.name,
		command: server.command ? [server.command, ...(server.args ?? [])] : undefined,
		env: server.env,
		url: server.url,
		headers: server.headers,
		enabled: server.enabled,
		timeout: server.timeout,
	};
}

function ScopeRow({ active, scope }: { active: boolean; scope: McpScope }) {
	return (
		<box height={1} flexDirection="row" gap={1}>
			<text fg={active ? c.accent : c.dim} width={14} flexShrink={0}>Scope:</text>
			<box flexDirection="row" gap={2}>
				{SCOPES.map((option) => (
					<text key={option} fg={scope === option ? c.accent : c.dim}>
						{scope === option ? '\u25C9' : '\u25CB'} {option}
					</text>
				))}
			</box>
		</box>
	);
}

export function McpManageDialog(props: McpManageDialogProps) {
	const { termWidth, termHeight, onClose, registerHandler } = props;
	const [mode, setMode] = useState<Mode>('list');
	const [refreshKey, setRefreshKey] = useState(0);
	const [listSel, setListSel] = useState(0);
	const [sourceSel, setSourceSel] = useState(0);
	const [presetSel, setPresetSel] = useState(0);
	const [transport, setTransport] = useState<Transport>('stdio');
	const [focus, setFocus] = useState<RowId>('name');
	const [values, setValues] = useState<Record<FieldId, string>>({ ...EMPTY_VALUES });
	const [scope, setScope] = useState<McpScope>('project');
	const [editing, setEditing] = useState<string | null>(null);
	const [enabled, setEnabled] = useState(true);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	const [busy, setBusy] = useState<string | null>(null);
	const [jsonText, setJsonText] = useState('');
	const [jsonServers, setJsonServers] = useState<McpConfig[]>([]);
	const [jsonSkipped, setJsonSkipped] = useState<string[]>([]);
	const jsonRef = useRef<{ plainText?: string } | null>(null);

	const items = useMemo<ListItem[]>(() => {
		const live = new Map(listConnectedServers().map((server) => [server.name, server]));
		return (loadConfig().mcp ?? []).map((server) => {
			const connected = live.get(server.name);
			return {
				server,
				scope: findMcpScope(server.name) ?? 'global',
				connected: Boolean(connected),
				tools: connected?.tools.length ?? 0,
			};
		});
	}, [refreshKey]);

	const rows = FORM_ROWS[transport];

	useEffect(() => {
		if (listSel > 0 && listSel >= items.length) setListSel(Math.max(0, items.length - 1));
	}, [items.length, listSel]);

	const resetForm = useCallback(() => {
		setValues({ ...EMPTY_VALUES });
		setFocus('name');
		setEditing(null);
		setEnabled(true);
		setError('');
	}, []);

	const connect = useCallback(async (server: McpConfig) => {
		setBusy(server.name);
		setError('');
		setNotice('');
		try {
			await disconnectServer(server.name, true).catch(() => {});
			const live = await connectServer(toServerConfig(server));
			setNotice(`${server.name} connected · ${live.tools.length} tools · ${live.resources.length} resources`);
		} catch (err) {
			setError(`${server.name}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setBusy(null);
			setRefreshKey((key) => key + 1);
		}
	}, []);

	const disconnect = useCallback(async (name: string) => {
		setBusy(name);
		setError('');
		setNotice('');
		try {
			await disconnectServer(name, true);
		} catch (err) {
			setError(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setBusy(null);
			setRefreshKey((key) => key + 1);
		}
	}, []);

	const openEditor = useCallback((item: ListItem) => {
		const server = item.server;
		setTransport(server.url && !server.command ? 'http' : 'stdio');
		setValues({
			name: server.name,
			command: server.command ?? '',
			args: formatArguments(server.args ?? []),
			env: formatPairs(server.env),
			url: server.url ?? '',
			headers: formatPairs(server.headers),
			timeout: server.timeout ? String(server.timeout) : '',
		});
		setScope(item.scope);
		setEnabled(server.enabled !== false);
		setEditing(server.name);
		setFocus('name');
		setError('');
		setNotice('');
		setMode('form');
	}, []);

	const applyPreset = useCallback((preset: McpPreset) => {
		setTransport('stdio');
		setValues({
			...EMPTY_VALUES,
			name: preset.id,
			command: preset.command,
			args: formatArguments(preset.args ?? []),
			env: formatPairs(preset.env),
		});
		setScope('project');
		setEnabled(true);
		setEditing(null);
		setFocus('name');
		setError('');
		setNotice(presetNeedsInput(preset) ? 'Replace the <placeholders> before saving' : '');
		setMode('form');
	}, []);

	const submit = useCallback(() => {
		setError('');
		const name = values.name.trim();
		if (!name) {
			setError('Name is required');
			setFocus('name');
			return;
		}
		if (!/^[A-Za-z0-9_-]+$/.test(name)) {
			setError('Name may only use letters, numbers, "-" and "_"');
			setFocus('name');
			return;
		}
		if (!editing && items.some((item) => item.server.name === name)) {
			setError(`"${name}" already exists — press e on the list to edit it`);
			setFocus('name');
			return;
		}

		const placeholderField = (['command', 'args', 'url', 'env', 'headers'] as FieldId[])
			.find((field) => hasPlaceholder(values[field]));
		if (placeholderField) {
			const token = PLACEHOLDER.exec(values[placeholderField])?.[0] ?? '<placeholder>';
			setError(`Replace ${token} in ${FIELD_DEFS[placeholderField].label}`);
			setFocus(placeholderField);
			return;
		}

		const server: McpConfig = { name, enabled };
		const timeout = Number.parseInt(values.timeout.trim(), 10);
		if (Number.isFinite(timeout) && timeout > 0) server.timeout = timeout;

		if (transport === 'stdio') {
			const command = values.command.trim();
			if (!command) {
				setError('Command is required');
				setFocus('command');
				return;
			}
			server.command = command;
			const args = splitArguments(values.args);
			if (args.length > 0) server.args = args;
			const env = parsePairs(values.env);
			if (env) server.env = env;
		} else {
			const url = values.url.trim();
			if (!url) {
				setError('URL is required');
				setFocus('url');
				return;
			}
			if (!/^https?:\/\//i.test(url)) {
				setError('URL must start with http:// or https://');
				setFocus('url');
				return;
			}
			server.url = url;
			const headers = parsePairs(values.headers);
			if (headers) server.headers = headers;
		}

		if (editing && editing !== name) {
			disconnectServer(editing, true).catch(() => {});
			removeMcpServerConfig(editing);
		}
		saveMcpServer(server, scope);
		setNotice(`${name} saved to the ${scope} config`);
		setRefreshKey((current) => current + 1);
		setMode('list');
		resetForm();
		if (enabled) connect(server);
	}, [values, transport, scope, enabled, editing, items, connect, resetForm]);

	const importJson = useCallback(() => {
		const text = jsonRef.current?.plainText ?? jsonText;
		setJsonText(text);
		const outcome = parseMcpServersJson(text);
		if (!outcome.ok) {
			setJsonServers([]);
			setJsonSkipped([]);
			setError(outcome.error);
			return;
		}
		setJsonServers(outcome.servers);
		setJsonSkipped(outcome.skipped);
		setError('');
		setFocus('scope');
		setMode('json-preview');
	}, [jsonText]);

	const importServers = useCallback(() => {
		if (jsonServers.length === 0) return;
		for (const server of jsonServers) saveMcpServer(server, scope);
		const count = jsonServers.length;
		setNotice(`Imported ${count} server${count === 1 ? '' : 's'} into the ${scope} config — press enter on a server to connect`);
		setJsonServers([]);
		setJsonSkipped([]);
		setJsonText('');
		setError('');
		setMode('list');
		setRefreshKey((current) => current + 1);
	}, [jsonServers, scope]);

	const confirmDelete = useCallback(() => {
		const item = items[listSel];
		if (!item) return;
		disconnectServer(item.server.name, true).catch(() => {});
		const removed = removeMcpServerConfig(item.server.name);
		setNotice(`${item.server.name} removed from the ${removed ?? 'global'} config`);
		setError('');
		setMode('list');
		setRefreshKey((key) => key + 1);
	}, [items, listSel]);

	const moveFocus = useCallback((delta: number) => {
		setFocus((current) => {
			const index = rows.indexOf(current);
			if (index < 0) return rows[0];
			return rows[(index + delta + rows.length) % rows.length];
		});
	}, [rows]);

	const toggleScope = useCallback(() => {
		setScope((current) => SCOPES[(SCOPES.indexOf(current) + 1) % SCOPES.length]);
	}, []);

	useEffect(() => {
		registerHandler((key: any) => {
			if (key.name === 'escape') {
				setError('');
				if (mode === 'list') {
					onClose();
					return;
				}
				if (mode === 'form') {
					setMode(editing ? 'list' : 'source');
					return;
				}
				if (mode === 'json') {
					setJsonText(jsonRef.current?.plainText ?? jsonText);
					setMode('source');
					return;
				}
				if (mode === 'json-preview') {
					setMode('json');
					return;
				}
				if (mode === 'presets') {
					setMode('source');
					return;
				}
				setMode('list');
				return;
			}

			if (key.name === 'tab') {
				const delta = key.shift ? -1 : 1;
				if (mode === 'list') {
					setListSel((current) => Math.min(Math.max(0, items.length - 1), current + delta));
					return;
				}
				if (mode === 'source') {
					setSourceSel((current) => (current + delta + SOURCES.length) % SOURCES.length);
					return;
				}
				if (mode === 'presets') {
					setPresetSel((current) => (current + delta + MCP_PRESETS.length) % MCP_PRESETS.length);
					return;
				}
				if (mode === 'form') {
					moveFocus(delta);
					return;
				}
				return;
			}

			if (mode === 'list') {
				if (key.name === 'up') {
					setListSel((current) => Math.max(0, current - 1));
					return;
				}
				if (key.name === 'down') {
					setListSel((current) => Math.min(Math.max(0, items.length - 1), current + 1));
					return;
				}
				if (key.name === 'a' || key.name === 'A') {
					resetForm();
					setTransport('stdio');
					setSourceSel(0);
					setNotice('');
					setMode('source');
					return;
				}
				const item = items[listSel];
				if (!item) return;
				if ((key.name === 'e' || key.name === 'E') && !busy) {
					openEditor(item);
					return;
				}
				if ((key.name === 'd' || key.name === 'D') && !busy) {
					setError('');
					setMode('confirm-delete');
					return;
				}
				if ((key.name === 't' || key.name === 'T') && !busy) {
					connect(item.server);
					return;
				}
				if (key.name === 'return' || key.name === 'enter') {
					if (busy) return;
					if (item.connected) {
						disconnect(item.server.name);
						return;
					}
					if (item.server.enabled === false) {
						setMcpServerEnabled(item.server.name, true);
						setRefreshKey((current) => current + 1);
						connect({ ...item.server, enabled: true });
						return;
					}
					connect(item.server);
				}
				return;
			}

			if (mode === 'source') {
				if (key.name === 'up') {
					setSourceSel((current) => Math.max(0, current - 1));
					return;
				}
				if (key.name === 'down') {
					setSourceSel((current) => Math.min(SOURCES.length - 1, current + 1));
					return;
				}
				if (key.name === 'return' || key.name === 'enter') {
					const picked = SOURCES[sourceSel].id;
					if (picked === 'json') {
						setNotice('');
						setMode('json');
						return;
					}
					if (picked === 'presets') {
						setNotice('');
						setPresetSel(0);
						setMode('presets');
						return;
					}
					setTransport(picked);
					setFocus('name');
					setMode('form');
				}
				return;
			}

			if (mode === 'presets') {
				if (key.name === 'up') {
					setPresetSel((current) => Math.max(0, current - 1));
					return;
				}
				if (key.name === 'down') {
					setPresetSel((current) => Math.min(MCP_PRESETS.length - 1, current + 1));
					return;
				}
				if (key.name === 'return' || key.name === 'enter') {
					applyPreset(MCP_PRESETS[presetSel]);
				}
				return;
			}

			if (mode === 'json') {
				if (key.ctrl && (key.name === 's' || key.name === 'S')) importJson();
				return;
			}

			if (mode === 'json-preview') {
				if (key.name === 'return' || key.name === 'enter') {
					importServers();
					return;
				}
				if (key.name === 'left' || key.name === 'right' || key.name === 'space') toggleScope();
				return;
			}

			if (mode === 'form') {
				if (key.ctrl && (key.name === 's' || key.name === 'S')) {
					submit();
					return;
				}
				// Text fields advance on their own onSubmit so a single Enter is never
				// consumed twice; only the input-less scope row is handled here.
				if (focus === 'scope') {
					if (key.name === 'return' || key.name === 'enter') {
						submit();
						return;
					}
					if (key.name === 'left' || key.name === 'right' || key.name === 'space') {
						toggleScope();
						return;
					}
				}
				return;
			}

			if (mode === 'confirm-delete' && (key.name === 'return' || key.name === 'enter')) {
				confirmDelete();
			}
		});
		return () => registerHandler(null);
	}, [
		mode, items, listSel, busy, sourceSel, presetSel, focus, rows, editing, onClose, registerHandler,
		resetForm, openEditor, applyPreset, moveFocus, toggleScope, submit, importJson, importServers,
		confirmDelete, connect, disconnect, jsonText,
	]);

	const listHeight = mode === 'list' ? 7 + Math.max(1, items.length) * 2 + (notice || error ? 2 : 0) : 0;
	const height = Math.min(Math.max(9, termHeight - 2), mode === 'list'
		? listHeight
		: mode === 'form'
			? 6 + rows.length + (error ? 1 : 0)
			: mode === 'source'
				? 6 + SOURCES.length * 2
				: mode === 'presets'
					? 6 + MCP_PRESETS.length
					: mode === 'json'
						? 18
						: mode === 'json-preview'
							? 8 + jsonServers.length * 2 + (jsonSkipped.length > 0 ? 1 : 0) + (error ? 1 : 0)
							: 8);

	const footer = mode === 'list'
		? `${'\u2191\u2193'} move · ${'\u23CE'} toggle · a add · e edit · d delete · t reconnect · esc close`
		: mode === 'source'
			? `${'\u2191\u2193'} select · ${'\u23CE'} next · esc back`
			: mode === 'presets'
				? `${'\u2191\u2193'} select · ${'\u23CE'} use preset · esc back`
				: mode === 'json'
					? '\u2303s import · esc back'
					: mode === 'json-preview'
						? `\u2190\u2192 scope · ${'\u23CE'} import ${jsonServers.length} · esc back`
						: mode === 'form'
							? 'tab next · \u21E7tab back · \u2303s save · esc back'
							: `${'\u23CE'} confirm · esc cancel`;

	const title = mode === 'list'
		? 'MCP Servers'
		: mode === 'source'
			? 'Add MCP Server'
			: mode === 'presets'
				? 'Add MCP Server · Presets'
				: mode === 'json'
					? 'Add MCP Server · Paste JSON'
					: mode === 'json-preview'
						? 'Import MCP Servers'
						: mode === 'form'
							? `${editing ? 'Edit' : 'Add'} MCP Server · ${transport === 'stdio' ? 'Local' : 'Remote'}`
							: 'Remove MCP Server';

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={72}
			height={height}
			title={title}
			titleColor={mode === 'confirm-delete' ? c.error : c.accent}
			footer={<text fg={c.dim}>{footer}</text>}
		>
			{({ innerWidth }) => (
				<box flexDirection="column" flexGrow={1} paddingX={2}>
					{mode === 'list' && (
						<box flexDirection="column" flexGrow={1}>
							{items.length === 0 ? (
								<box flexDirection="column" paddingY={1}>
									<text fg={c.dim}>No MCP servers configured.</text>
									<text fg={c.dim}>Press "a" to add one.</text>
								</box>
							) : (
								<scrollbox maxHeight={Math.max(3, height - 6)} scrollY={true} scrollbarOptions={{ visible: false }}>
									<box flexDirection="column">
										{items.map((item, index) => {
											const selected = index === listSel;
											const status = busy === item.server.name
												? { label: 'working', color: c.warn }
												: item.connected
													? { label: 'connected', color: c.accent }
													: item.server.enabled === false
														? { label: 'disabled', color: c.dim }
														: { label: 'idle', color: c.subtext };
											const glyph = busy === item.server.name ? '\u25D0' : item.connected ? '\u25CF' : '\u25CB';
											const right = item.connected
												? `${item.tools} tools · ${item.scope}`
												: item.scope;
											return (
												<box
													key={item.server.name}
													height={2}
													flexDirection="column"
													backgroundColor={selected ? c.bgSelect : undefined}
													paddingLeft={selected ? 1 : 2}
													paddingRight={1}
												>
													<box flexDirection="row" justifyContent="space-between" width={innerWidth - 1}>
														<box flexDirection="row" gap={1}>
															<text fg={status.color}>{glyph}</text>
															<text fg={selected ? c.accent : c.text}>{item.server.name}</text>
															<text fg={status.color}>[{status.label}]</text>
														</box>
														<text fg={c.dim}>{right}</text>
													</box>
													<text fg={c.dim} overflow="hidden" wrapMode="none">
														{serverTarget(item.server)}
													</text>
												</box>
											);
										})}
									</box>
								</scrollbox>
							)}
							{error ? <text fg={c.error}>{error}</text> : null}
							{notice ? <text fg={c.success}>{notice}</text> : null}
						</box>
					)}

					{mode === 'source' && (
						<box flexDirection="column">
							<text fg={c.subtext}>How should Spectra reach this server?</text>
							<box height={1} />
							{SOURCES.map((option, index) => (
								<box
									key={option.id}
									height={2}
									flexDirection="column"
									backgroundColor={index === sourceSel ? c.bgSelect : undefined}
									paddingLeft={1}
								>
									<text fg={index === sourceSel ? c.accent : c.text}>{option.label}</text>
									<text fg={c.dim}>{option.hint}</text>
								</box>
							))}
						</box>
					)}

					{mode === 'presets' && (
						<box flexDirection="column" flexGrow={1}>
							<scrollbox maxHeight={Math.max(3, height - 6)} scrollY={true} scrollbarOptions={{ visible: false }}>
								<box flexDirection="column">
									{MCP_PRESETS.map((preset, index) => {
										const selected = index === presetSel;
										return (
											<box
												key={preset.id}
												height={1}
												flexDirection="row"
												gap={1}
												backgroundColor={selected ? c.bgSelect : undefined}
												paddingLeft={1}
											>
												<text fg={selected ? c.accent : c.text}>{preset.name}</text>
												{presetNeedsInput(preset) ? <text fg={c.warn}>needs input</text> : null}
												<text fg={c.dim} overflow="hidden" wrapMode="none">{preset.description}</text>
											</box>
										);
									})}
								</box>
							</scrollbox>
						</box>
					)}

					{mode === 'json' && (
						<box flexDirection="column">
							<text fg={c.subtext}>Paste an mcpServers block, a .mcp.json, or a map of server configs.</text>
							<box height={11}>
								<textarea
									key="mcp-json"
									ref={(value: { plainText?: string } | null) => {
										jsonRef.current = value;
									}}
									initialValue={jsonText}
									placeholder={'{ "mcpServers": { "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] } } }'}
									width="100%"
									height={11}
									focused={true}
								/>
							</box>
							{error ? <text fg={c.error}>{error}</text> : null}
						</box>
					)}

					{mode === 'json-preview' && (
						<box flexDirection="column">
							<text fg={c.subtext}>{`${jsonServers.length} server${jsonServers.length === 1 ? '' : 's'} parsed`}</text>
							<scrollbox maxHeight={Math.max(3, height - 9)} scrollY={true} scrollbarOptions={{ visible: false }}>
								<box flexDirection="column">
									{jsonServers.map((server) => {
										const existing = findMcpScope(server.name);
										return (
											<box key={server.name} height={1} flexDirection="row" gap={1}>
												<text fg={c.text}>{server.name}</text>
												<text fg={existing ? c.warn : c.dim}>{existing ? `replaces ${existing}` : 'new'}</text>
												<text fg={c.dim} overflow="hidden" wrapMode="none">{serverTarget(server)}</text>
											</box>
										);
									})}
								</box>
							</scrollbox>
							{jsonSkipped.length > 0 ? <text fg={c.warn}>{`Skipped: ${jsonSkipped.join(', ')}`}</text> : null}
							<ScopeRow active scope={scope} />
							{error ? <text fg={c.error}>{error}</text> : null}
						</box>
					)}

					{mode === 'form' && (
						<box flexDirection="column">
							{rows.map((row) => {
								if (row === 'scope') return <ScopeRow key="scope" active={focus === 'scope'} scope={scope} />;
								const active = focus === row;
								const def = FIELD_DEFS[row];
								return (
									<box key={row} height={1} flexDirection="row" gap={1}>
										<text fg={active ? c.accent : c.dim} width={14} flexShrink={0}>{def.label}:</text>
										<box flexGrow={1} height={1}>
											<input
												placeholder={def.placeholder}
												value={values[row]}
												focused={active}
												onInput={(value: string) => setValues((current) => ({ ...current, [row]: value }))}
												onSubmit={() => {
													if (row === rows[rows.length - 2]) submit();
													else moveFocus(1);
												}}
											/>
										</box>
									</box>
								);
							})}
							<box height={1} />
							{error ? <text fg={c.error}>{error}</text> : null}
							{notice ? <text fg={c.success}>{notice}</text> : null}
						</box>
					)}

					{mode === 'confirm-delete' && (
						<box flexDirection="column">
							<text fg={c.text}>
								Remove "{items[listSel]?.server.name}" from the {items[listSel]?.scope} config?
							</text>
						</box>
					)}
				</box>
			)}
		</ModalFrame>
	);
}
