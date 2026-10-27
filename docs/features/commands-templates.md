# Commands and templates

> Slash commands come from three layers — Markdown templates loaded from project and global command directories, built-in prompt recipes, and legacy `CmdItem` handlers — merged into one immutable registry that `/name` and the command palette resolve against.

## Source

- Domain types: `packages/code/src/command/types.ts` — `CommandDefinition`, `ResolvedCommand`, `CommandAction`, `CommandContext`, `LegacyCmdItemLike`.
- Registry: `packages/code/src/command/registry.ts` — `createRegistry()` normalizes names, applies first-wins collision suffixes, and freezes a `RegistrySnapshot`.
- Dispatcher: `packages/code/src/command/dispatcher.ts` — `dispatch()` runs optional `before`/`after` hooks and normalizes results to `CommandAction[]`.
- Templates: `packages/code/src/command/template-loader.ts` (discovery, parsing, conversion), `frontmatter.ts`, `template-renderer.ts`, `template-shell.ts`, `context-providers.ts`, `template-types.ts`.
- Built-in recipes: `packages/code/src/command/builtin-templates.ts` — `/commit`, `/review`, `/explain`, `/build-fix`.
- TUI bridge: `packages/code/src/tui/command-types.ts` — adapts `CmdItem[]` into definitions and exposes `buildCommandRegistry`/`dispatchCommand`; `packages/code/src/tui/commands.ts` — the built-in `CmdItem` table; `packages/code/src/tui/command-action-executor.ts` — applies actions.
- Collaborators:
  - `packages/code/src/tui/app.tsx` — loads templates at mount, builds the registry, orders palette entries, routes slash input.
  - `packages/code/src/tui/hooks/use-chat-submit.ts` — `handleSubmit` slash branch and action application.
  - `packages/code/src/tui/slash-commands.ts` — `slashHead`, `slashTokenAt`, `parseSlashCommand`.

## Registration / gating

- Template discovery walks upward from `process.cwd()`: at each directory `.spectra/commands` then `.claude/commands`, then finally `<config dir>/commands` (`template-loader.ts:98-120`). Files are deduplicated by normalized absolute path (case-folded on Windows).
- Merge order in `buildCommandRegistry`: template definitions, then `BUILTIN_TEMPLATE_COMMANDS`, then definitions adapted from `buildCmdItems()` (`tui/command-types.ts:80-89`). The first definition to claim a name keeps the bare invocation; later ones get `:2`, `:3`, … (`registry.ts:65-112`).
- `App` loads templates once at mount (`app.tsx:360-382`) using `loadConfig().commands?.shellExecution !== false`; reload requires a restart.
- Enabled by: always. Template shell interpolation is enabled unless `commands.shellExecution` is `false` (`services/config.ts:56-59`).
- Permission profile: template execution and prompt submission go through the normal `submitPrompt` path; shell interpolation itself is not routed through tool permissions.

## Inputs

Frontmatter is the only structured template input; everything else is body text.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `description` | `string` | no | One-line description; falls back to the path-derived name with `-`, `_`, `/` replaced by spaces. |
| `context` | YAML-style list | no | Providers to gather: only `git.status` and `git.diff`. Must be an empty scalar followed by `- ` items. |
| `agent` | `string` | no | Parsed and validated as non-empty; not consumed by command conversion. |
| `model` | `string` | no | Parsed and validated as non-empty; not consumed by command conversion. |
| `subtask` | `true` \| `false` | no | Parsed and validated; not consumed by command conversion. |

- Body placeholders: `$ARGUMENTS` (full raw argument string), `$1`…`$N` (quote-aware parts), double-brace context placeholders (for example, a `context.git.status` placeholder).
- Invocation input: `CommandContext { source: 'palette' | 'slash', args, invocation }`; templates receive `args` only.
- Options: `loadTemplateDefinitions(projectRoot, { shellExecution? })` and `templatesToCommands(templates, projectRoot, { shellExecution? })`; the default is enabled.

## Outputs

- `TemplateDefinition` per accepted file: `{ name, description, sourcePath, content, contextProviders, dialect }`.
- `CommandDefinition.execute()` returns one `submit_prompt` action on success, or an array of `show_toast` actions (`variant: 'error'`) when context, rendering, or shell interpolation produces diagnostics (`template-loader.ts:225-291`).
- The dispatcher normalizes any handler result to `CommandAction[]` and the TUI applies them in order: `submit_prompt` → `submitPrompt`, `open_dialog` → `setDialogStep`, `show_toast` → toast (`command-action-executor.ts:25-48`).
- Files: the loader and renderer write nothing; declared shell commands are arbitrary and may write.

## Flow

1. `collectMarkdownFiles` recursively reads `.md` files with entries sorted by name; missing directories are ignored (`template-loader.ts:123-149`).
2. `parseFrontmatter` requires the file to start with a closed `---` block, normalizes CRLF, rejects unknown or duplicate fields and list items outside `context`, then returns the body offset (`frontmatter.ts:30-150`).
3. `parseTemplateFile` rejects an empty body, validates the body by rendering it with empty args/context, derives the name from the path relative to `commands/`, and enforces per-segment `[a-z0-9][a-z0-9_-]*` naming with the case-insensitive flag (`template-loader.ts:152-222`).
4. Dialect comes from the source directory: `.spectra` and the global config dir use `spectra` (`$1` is the first argument); `.claude` uses `claude` (`$0` is the first argument) (`template-renderer.ts:39-73`).
5. At execution, declared providers are gathered with fixed-argument `git status --short` / `git diff --no-ext-diff` calls (`context-providers.ts:67-75`).
6. `renderTemplate` replaces `$ARGUMENTS`, then positional placeholders with quote-aware parts, appends raw args as a paragraph when no `$` placeholder exists, replaces double-brace context placeholders, and appends unused declared providers under `## Git Status` / `## Git Diff` fenced blocks (`template-renderer.ts:39-118`).
7. `interpolateShellCommands` extracts fenced ```` ```! ```` blocks and inline `` !`cmd` `` occurrences, runs them sequentially with the platform shell, and substitutes trimmed stdout. Failure returns the original text plus diagnostics (`template-shell.ts:18-76`).
8. `buildCommandDefinition` wraps the above in `execute()`, which returns `submit_prompt` with the final text (`template-loader.ts:225-291`).
9. Slash submission: `handleSubmit` requires no attachments and text starting with `/`, parses the head token, looks it up in `commandRegistry.slashNames`, dispatches, applies actions, and resets the draft only when no `submit_prompt` was produced (`use-chat-submit.ts:781-810`).
10. Palette submission: `orderPaletteCommands` moves `Templates` entries directly after the last `Agent` entry; the palette filters by title, description, and category (`app.tsx:78-92`, `:749-765`).
11. Built-in legacy items include `/model`, `/agent`, `/effort`, `/thinking-effort`, `/mcp`, `/bg`, `/memory`, `/skills`, `/thinking`, `/tools`, `/home`, `/stats`, `/context`, `/usage`, `/settings`, `/doctor`, `/debug`, `/about`, `/help`, and `/exit` with aliases `quit`/`q` (`tui/commands.ts:208-1034`).

## State / persistence

- Definitions are rebuilt in a `useMemo` over `cmdItems` and `templateDefinitions`; the snapshot itself is frozen and holds no state (`app.tsx:537`).
- Template diagnostics are toasted once per unique `kind:sourcePath:message` per process (`app.tsx:367-378`).
- There is no on-disk registry and no template result cache; context and shell commands run on every invocation.
- `collectSlashNames(items)` is exported but unused by the current app; the live registry is the authority for parsing and autocomplete.

## Security

- Shell interpolation is the only arbitrary-execution path here. It runs with the project root as cwd, the platform shell from `getPlatformInfo()`, a 10 s timeout, and a 64 KiB `maxBuffer` (`template-shell.ts:10-11`, `:55-63`). It does not consult `SecurityManager`, so `commands.shellExecution: false` is the only gate.
- Context providers use `execFile` with fixed arguments, no shell, a 10 s timeout, and 50 KiB output cap; failures become diagnostics and an empty value (`context-providers.ts:8-9`, `:67-92`).
- Template discovery reads parent directories up to the filesystem root and the global config directory, so commands can originate outside the current project.
- Names are path-derived and validated; `..` segments fail the segment regex, so a template cannot register a traversal-style name.
- Prompt text produced by a template is submitted like typed input; attachments are not supported through templates.

## Errors

| Condition | Result |
| --- | --- |
| Missing or unclosed frontmatter block | Parse diagnostic "Template must start with a closed frontmatter block"; template skipped. |
| Unknown, duplicate, or malformed field | Validation diagnostic naming the field; template skipped. |
| Context provider not `git.status`/`git.diff` | Validation diagnostic; template skipped. |
| Empty body | Validation diagnostic "Template body must not be empty"; template skipped. |
| Name segment not matching `[a-z0-9][a-z0-9_-]*` (case-insensitive) | Validation diagnostic; template skipped. |
| Undeclared double-brace context placeholder | Validation diagnostic during load; template skipped. |
| `commands.shellExecution: false` with a shell placeholder | Error toast "Template shell execution is disabled by configuration"; no prompt. |
| Shell command fails or times out | Error toast "Template shell command failed: …"; original body is returned unreplaced. |
| Git context provider fails | Error toast "Context provider … failed: …"; no prompt. |
| Slash head not in the registry | Toast "Select a slash command with tab or enter before submitting". |
| Dispatcher throws | `dispatch` runs the `after` hook then rethrows; `handleSubmit` does not catch it. |

## Limitations

- `agent`, `model`, and `subtask` are parsed and validated but discarded by `TemplateDefinition`; a template cannot select an agent, model, or subagent mode.
- Context providers are limited to `git.status` and `git.diff`.
- Shell interpolation is all-or-nothing: one failing command restores the full original text rather than substituting the successful commands.
- Slash parsing compares the typed head token exactly against the registry's normalized (lowercase) names; case is not folded at parse time, though `resolve()` itself normalizes.
- Skill names are offered only for mid-prompt `/token` completion; they are not part of the command registry, so a leading `/skillname` is not dispatched as a command.
- `/theme` and `/permissions` are registered legacy items that only emit "not implemented yet" toasts (`tui/commands.ts:946-965`).
- Legacy `/commit` and `/review` are shadowed by the built-in template recipes; both rows remain visible in the palette, with the legacy entries receiving suffixed invocations (`:2`, or `:3` when a project template already claims the same name).
- `loadTemplateDefinitions` accepts `shellExecution` but only `templatesToCommands` uses it, so the loader's own validation pass is unaffected by the flag.

## Tests

- `packages/code/src/__tests__/command-template.test.ts` — CRLF frontmatter body offsets, Claude metadata fields, `$ARGUMENTS`/`$1`/`$10`/context rendering, native vs Claude dialect discovery, project-template precedence over a builtin with a `:2` suffix, shell interpolation enabled and disabled, and bounded git context collection.
- `packages/code/src/__tests__/command-system.test.ts` — legacy `executeCommand` hook order, alias resolvability without duplicate menu entries, registry entry order (`commit`, `review`, `explain`, `build-fix`, …), dispatcher hook behavior and error reporting, and sequential application of `submit_prompt`/`open_dialog` actions.

## Related

- [tui-shell.md](tui-shell.md) — palette, slash autocomplete, and action application.
- [permissions.md](permissions.md) — why template shell execution is outside the tool permission wrapper.
- [skills.md](skills.md) — skill discovery and the mid-prompt completion source.
- [config.md](config.md) — `commands.shellExecution` loading and merge behavior.
