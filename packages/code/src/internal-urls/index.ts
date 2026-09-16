export { ArtifactStore } from './artifact-store.js';
export { InternalUrlRouter } from './router.js';
export { internalScheme, parseInternalUrl } from './parse.js';
export type {
	InternalResource,
	InternalUrl,
	NamedResource,
	ProtocolHandler,
	ResolveContext,
	ResourceContentType,
	UrlCompletion,
	WriteContext,
} from './types.js';

import {
	AgentProtocolHandler,
	ArtifactProtocolHandler,
	HistoryProtocolHandler,
	LocalProtocolHandler,
	MemoryProtocolHandler,
	RuleProtocolHandler,
	SkillProtocolHandler,
	SpectraProtocolHandler,
} from './core-protocols.js';
import {
	IssueProtocolHandler,
	McpProtocolHandler,
	PrProtocolHandler,
	SshProtocolHandler,
	VaultProtocolHandler,
} from './external-protocols.js';
import { InternalUrlRouter } from './router.js';

export function createInternalUrlRouter(): InternalUrlRouter {
	return new InternalUrlRouter([
		new AgentProtocolHandler(),
		new ArtifactProtocolHandler(),
		new HistoryProtocolHandler(),
		new IssueProtocolHandler(),
		new LocalProtocolHandler(),
		new McpProtocolHandler(),
		new MemoryProtocolHandler(),
		new PrProtocolHandler(),
		new RuleProtocolHandler(),
		new SkillProtocolHandler(),
		new SpectraProtocolHandler(),
		new SshProtocolHandler(),
		new VaultProtocolHandler(),
	]);
}
