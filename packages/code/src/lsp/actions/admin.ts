import { requireFile, type ActionContext, type ActionResult } from './types.js';

export async function runStatusAction(context: ActionContext): Promise<ActionResult> {
	const clients = context.manager.describe();
	const text = clients.length === 0
		? 'No LSP servers running.'
		: clients.map((client) => `${client.server}  ${client.root}${client.running ? '' : ' (stopped)'}`).join('\n');
	return { text, details: { action: 'status', success: true, servers: clients } };
}

export async function runReloadAction(context: ActionContext): Promise<ActionResult> {
	const before = context.manager.describe().length;
	await context.manager.shutdownAll();
	return {
		text: before === 0 ? 'No LSP servers were running.' : `Stopped ${before} LSP server(s).`,
		details: { action: 'reload', success: true, stopped: before },
	};
}

export async function runCapabilitiesAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	const managed = await context.manager.ensureClient(file);
	const json = JSON.stringify(managed.client.serverCapabilities, null, 2);
	return {
		text: json.length > 6000 ? `${json.slice(0, 6000)}\n…` : json,
		details: { action: 'capabilities', server: managed.serverId, success: true },
	};
}

export async function runRequestAction(context: ActionContext): Promise<ActionResult> {
	const file = requireFile(context.args);
	if (!context.args.query) throw new Error('request requires query = LSP method');
	let payload: unknown = {};
	if (context.args.payload) {
		try {
			payload = JSON.parse(context.args.payload);
		} catch {
			throw new Error('payload must be valid JSON');
		}
	}
	const { result, managed } = await context.manager.request(file, context.args.query, payload, context.signal);
	const json = JSON.stringify(result, null, 2);
	return {
		text: json.length > 8000 ? `${json.slice(0, 8000)}\n…` : json,
		details: { action: 'request', server: managed.serverId, success: true, method: context.args.query },
	};
}
