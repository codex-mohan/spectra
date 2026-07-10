// ---------------------------------------------------------------------------
// Command domain — barrel exports.
// ---------------------------------------------------------------------------

// Types
export type { CommandSource, CommandSourceInfo, CommandAction, CommandResult } from './types.js';
export type { CommandContext, ArgCompletion, CommandDefinition, ResolvedCommand, LegacyCmdItemLike } from './types.js';

// Registry
export { createRegistry, type RegistrySnapshot } from './registry.js';

// Dispatcher
export { dispatch, adaptLegacyCmdItem, type DispatcherResult, type DispatcherHooks } from './dispatcher.js';
