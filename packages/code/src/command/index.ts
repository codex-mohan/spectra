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

// Templates
export type { TemplateDefinition, TemplateDiagnostic, ContextProviderKind, TemplateFrontmatter } from './template-types.js';
export { parseFrontmatter, type FrontmatterResult } from './frontmatter.js';
export { renderTemplate, type RenderContext, type RenderResult } from './template-renderer.js';
export { gatherContext, type GatherContextResult } from './context-providers.js';
export { loadTemplateDefinitions, templatesToCommands, type LoadTemplateResult } from './template-loader.js';
