# Spectra Roadmap

## 1. Custom states from tool calls (generative UI support)

Tool calls should be capable of emitting custom states during execution. This enables generative UI patterns where the tool can surface intermediate progress, status changes, or arbitrary state updates to the caller — useful for showing loading states, progress bars, or dynamic UI transitions.

- [ ] Define a `ToolState` / custom state event type in the SDK types
- [ ] Allow `execute()` to yield/push custom state events alongside the final `ToolResult`
- [ ] Surface these states through the agent event stream so callers can render them reactively
- [ ] Ensure both TypeScript (`packages/agent`) and Rust (`crates/spectra-rs`) support this

## 2. Real-time tool content streaming

Ability to stream a tool's content in real time as it is produced, rather than waiting for the full `ToolResult` before surfacing anything. This builds on the current tool call implementation to support progressive output.

- [ ] Design a streaming tool interface (e.g., `execute` returns an async iterable / stream of chunks)
- [ ] Integrate streaming tool output into the agent event loop so deltas are yielded as they arrive
- [ ] Ensure backward compatibility — non-streaming tools (current `execute` returning `ToolResult`) still work
- [ ] Implement in both TypeScript (`packages/agent`) and Rust (`crates/spectra-rs`)

## 3. Context compaction

Automatic context management that summarizes old conversation history when approaching token limits, preserving recent turns verbatim.

- [ ] Anchored summaries: incrementally update previous summary instead of rebuilding from scratch
- [ ] Async pruning pass: mark old tool outputs as compacted, protect recent 40K, never prune `skill` tool outputs
- [ ] Auto-continue after compaction ("Continue if you have next steps...")

## 4. Agent loop safety guards

Defensive mechanisms in the agent loop to prevent common failure modes. Based on patterns from OwlCoda's conversation engine.

- [ ] Narration loop detection: detect repetitive output patterns (e.g., same sentence repeated 3+ times), interrupt and prompt user
- [ ] Output bloat detection: warn when single tool output exceeds reasonable size (e.g., 50K chars), offer to truncate
- [ ] Task no-progress hard stop: if agent makes N turns with no file writes or meaningful progress, pause and ask for direction
- [ ] Convergence state machine: track whether agent is making forward progress or cycling between states
- [ ] Surface safety events (interrupt, warning, hard-stop) through the agent event stream so TUI can render them

## 5. Command system: slash invocation, templates, and plugin commands

Spectra needs one command pipeline with multiple command sources. `/` is only the invocation surface in the TUI; it must not imply that every command is hardcoded in `commands.ts` or that templates/plugins are separate execution paths.

**Core distinction:**
- **Slash invocation**: user-facing command syntax and autocomplete (`/agent`, `/review`, `/memory save`). It resolves a command name plus raw argument string.
- **Built-in command**: TypeScript command registered by Spectra core. It may open a dialog, mutate UI/session state, submit a prompt, or delegate to a template.
- **Template command**: file-backed command whose primary behavior is rendering a prompt template into a `PromptSubmitPayload` and optionally choosing agent/model/subtask execution.
- **Plugin command**: plugin-registered command whose handler may return command effects, including prompt injection, UI effects, tool/script execution requests, or a template-render request.
- **Template renderer**: shared prompt-rendering service used by template commands, built-in commands, and plugin commands. It is not itself a command type and should not own command dispatch.

**Unified command contract:**
```typescript
type CommandSource = 'builtin' | 'template' | 'plugin' | 'skill' | 'mcp';

interface CommandDefinition {
  id: string;
  name: string;
  aliases?: string[];
  description: string;
  category?: string;
  source: CommandSource;
  sourceInfo?: SourceInfo;
  argCompleter?: (args: string, ctx: ArgCompletionContext) => MaybePromise<ArgCompletion[]>;
  execute: (ctx: CommandRunContext) => MaybePromise<CommandEffect[] | void>;
}

type CommandEffect =
  | { type: 'submit_prompt'; payload: PromptSubmitPayload }
  | { type: 'spawn_subagent'; payload: PromptSubmitPayload; mode: 'read-only' | 'full' }
  | { type: 'open_dialog'; dialog: DialogStep }
  | { type: 'set_draft'; text: string; cursor?: number }
  | { type: 'toast'; message: string; variant?: ToastVariant }
  | { type: 'run_script'; script: ScriptRequest };
```

**Dispatch order:**
1. Parse slash input into `{ name, args }`.
2. Resolve against one registry containing built-ins, templates, plugins, skills, and MCP prompts.
3. If names collide, keep all commands and assign stable invocation suffixes (`/review`, `/review:2`) while showing provenance in autocomplete.
4. Run `command.before` plugin hooks.
5. Execute the selected command.
6. Apply returned command effects through centralized, permission-aware handlers.
7. Run `command.after` plugin hooks.

**Prompt-producing commands:**
- `/commit` and `/review` should be template-backed built-in commands at first: registered by core, implemented by rendering bundled templates.
- User/project templates can override or add commands without editing `commands.ts`.
- Plugin commands can inject prompts by returning `submit_prompt` / `spawn_subagent` effects or by asking the template renderer to render a named template.
- Prompt injection must pass through the same submit path used by manual chat input so message storage, attachments, model selection, permissions, compaction, and plugin hooks stay consistent.

**Script execution from commands:**
- Template files may declare required context providers (for example `git.diff`, `git.status`, `files.read`) but should not run shell directly in v1.
- Plugin commands may request scripts through `run_script`, but the effect handler must route through the same permission system and shell/tool execution telemetry as normal tool calls.
- Shell interpolation syntax such as OpenCode's `` !`cmd` `` is deferred until it can be permission-gated, audited, and displayed before execution.

**Implementation tasks:**
- [ ] Move command types from TUI-only code into a command-domain module with `CommandDefinition`, `CommandEffect`, `CommandRunContext`, and `SourceInfo`
- [ ] Replace ad hoc `CmdItem.action()` execution with centralized `executeCommand(def, ctx)` and effect application
- [ ] Add command provenance to autocomplete rows: source, source path/package, and collision suffix
- [ ] Add nested argument completion support for subcommands (`/memory save`, `/skills browse`, `/agent plan`)
- [ ] Ensure slash submit, palette submit, and plugin-triggered submit all call the same command executor
- [ ] Keep prompt autocomplete menus separate from centered modal/select dialogs; they can share list-window utilities but not command dispatch state

## 6. Plugin system

Dynamic, hook-based plugin system. Plugins extend behavior without modifying core code and must support message-level behavior, not only request/tool hooks.

**Plugin loading order (cascading precedence):**
1. Project-level: `.spectra/plugins/` (project root, highest priority)
2. User-level: `~/.spectra/plugins/` or platform config dir plugins
3. Config-defined: plugins listed in config file
4. Package plugins: npm-style plugin packages declared in config

**Plugin shape:**
```typescript
export default function activate(api: SpectraPluginAPI): void | Promise<void> {
  api.registerCommand('name', command);
  api.registerTool(tool);
  api.on('message.beforeAppend', handler);
}

interface SpectraPluginAPI {
  on<E extends PluginEventName>(event: E, handler: PluginHandler<E>): Disposable;
  registerCommand(name: string, command: PluginCommand): Disposable;
  registerTool(tool: PluginTool): Disposable;
  registerMessageRenderer(type: string, renderer: MessageRenderer): Disposable;
  renderTemplate(nameOrPath: string, args: TemplateRenderArgs): Promise<RenderedTemplate>;
  storage: PluginStorage;
  ui: PluginUi;
}
```

**Message-level support (required):**
- [ ] `message.beforeAppend` — inspect/modify/veto a user, assistant, tool, error, or custom message before it is persisted
- [ ] `message.afterAppend` — observe persisted messages for indexing, memory, telemetry, side effects, or plugin state
- [ ] `message.beforeProvider` — transform the message list before provider serialization without mutating stored history
- [ ] `message.afterProvider` — observe provider-normalized messages and token/media metadata after serialization
- [ ] `message.render` — allow custom renderers for plugin-defined message/content block types in the TUI
- [ ] `message.compact` — let plugins summarize or protect their own custom message blocks during compaction
- [ ] Message hook contexts must include stable message id, session id, parent/child session id, role, content blocks, attachments, metadata, source command/plugin, and abort signal
- [ ] Message hooks must clearly separate persistent mutations from transient provider-context mutations
- [ ] Message hooks must be ordered, timeout-bounded, and isolated so one plugin cannot corrupt history or block rendering indefinitely

**Hook points:**
- [ ] `plugin.load` / `plugin.unload` — lifecycle setup/teardown
- [ ] `command.before` / `command.after` — command execution lifecycle
- [ ] `input.beforeSubmit` — inspect/transform prompt text and attachments before command parsing or chat submit
- [ ] `agent.beforeStart` / `agent.afterEnd` — agent turn lifecycle
- [ ] `tool.beforeExecute` / `tool.afterExecute` — block/modify tool calls and observe tool results
- [ ] `provider.beforeRequest` / `provider.afterResponse` — provider transport inspection/mutation after message normalization
- [ ] `session.created` / `session.loaded` / `session.updated` — session lifecycle
- [ ] `ui.toast` / `ui.status` — UI notifications and status contributions
- [ ] `error` — plugin-aware error reporting and recovery

**Safety and isolation:**
- [ ] Validate plugin metadata and capabilities before activation
- [ ] Require explicit capabilities for filesystem, shell/script, network, message mutation, provider mutation, and custom rendering
- [ ] Route plugin script execution through the same permission/security layer as tools
- [ ] Persist plugin diagnostics with source path/package and hook name
- [ ] Add plugin timeouts and per-hook failure isolation
- [ ] Add reload support that disposes commands/tools/hooks/renderers cleanly

**Implementation:**
- [ ] Define plugin types and hook contexts in `packages/code/src/plugins`
- [ ] Plugin loader: scan directories/packages, dynamically import, validate metadata/capabilities
- [ ] Hook runner: deterministic ordering, try/catch isolation, timeout handling, diagnostics
- [ ] Command registry integration: plugin commands appear in slash autocomplete with provenance and descriptions
- [ ] Tool registry integration: plugin tools use existing `defineTool` validation and security wrappers
- [ ] Message pipeline integration: storage, provider serialization, compaction, and TUI rendering all expose message hooks
- [ ] Plugin discovery CLI: `spectra plugin list`, `spectra plugin install`, `spectra plugin remove`, `spectra plugin doctor`
- [ ] Rust SDK gets a parallel native extension design later; do not bind TS plugins into Rust

## 7. Observability middleware

Per-request metrics, cost tracking, and runtime health visibility at the HTTP proxy/transport layer.

- [ ] Request latency metrics: time-to-first-token, total duration, p50/p95/p99 aggregates
- [ ] Rate limit headers parsing: extract `X-RateLimit-*` headers from provider responses, surface to UI
- [ ] Expose metrics through agent event stream so TUI can render `/cost`, `/tokens`, `/stats` commands

## 8. Session handling overhaul

Spectra's session system is fundamentally weaker than OpenCode's. The current JSON-per-file storage, shallow fork, and missing compaction will not scale.

**Storage:**
- [ ] Schema: sessions table, messages table, parts table with foreign keys
- [ ] Cursor-based pagination for session listing

**Fork & Branch:**
- [ ] Deep copy with ID remapping (prevent collisions between forked sessions)
- [ ] Fork from specific message point (not just entire session)
- [ ] Fork count in title (e.g. "Title (fork #1)")

**Search & Filtering:**
- [ ] SQL LIKE search on title, model, agent
- [ ] Filter by directory/project scope
- [ ] Global cross-project session listing
- [ ] Pagination (don't load all sessions into memory)

**Metadata:**
- [ ] Track: summary (additions/deletions/files), model variant, thinking effort
- [ ] Session versioning for schema migrations
- [ ] Archive timestamps (time_archived)
- [ ] Share URL support

**Session list UI:**
- [ ] Paginated loading (don't load 100+ sessions at once)
- [ ] Sort by updated/created
- [ ] Show token count and cost per session

## 9. Skills system

Learned, reusable skill files that provide specialized workflows and context for specific tasks. Skills are markdown-based instruction files with YAML frontmatter, following the Claude Code format (compatible with OwlCoda and OpenCode).

**Skill format (Claude Code compatible):**
```yaml
---
name: skill-name                    # Must match directory name
description: What this does. Use when user asks to [X], [Y], [Z].  # Trigger description
when_to_use: Additional trigger phrases
allowed-tools: Read Grep Bash       # Pre-approve tools for this skill
model: claude-sonnet-4-5            # Optional model override
effort: high                        # Optional effort override
context: fork                       # Run in forked subagent (optional)
version: 0.1.0                      # Version tracking
---
```

**Directory structure:**
```
skill-name/
  SKILL.md           # Required - main instructions
  scripts/           # Optional - executable code (Python/Bash/PowerShell)
  references/        # Optional - docs loaded on demand
  examples/          # Optional - working code examples
  assets/            # Optional - templates, images
```

**Skill discovery (cascading precedence, OpenCode compatible):**
1. Project-level: `.claude/skills/*/SKILL.md` + `.agents/skills/*/SKILL.md` (project root)
2. User-level: `~/.claude/skills/*/SKILL.md` + `~/.agents/skills/*/SKILL.md` (global)
3. Config-defined: custom paths + URLs in config file

**Implementation:**
- [ ] Dynamic context injection: `` !`command` `` syntax to run shell commands before injection
- [ ] Permission system: per-skill allow/deny/ask via config

**Default skills (66 total):**

*Collaboration (10):*
- `brainstorming` — interactive Socratic method to refine ideas into designs
- `dispatching-parallel-agents` — dispatch multiple AI agents for independent problems concurrently
- `executing-plans` — execute detailed plans in batches with review checkpoints
- `finishing-a-development-branch` — complete feature dev: verify tests, present merge/PR/discard options
- `phase-prompting` — turn verified state into execution-ready prompts with wave structure
- `receiving-code-review` — handle code review feedback with technical rigor
- `requesting-code-review` — dispatch code-reviewer subagent to review implementation
- `subagent-driven-development` — execute plans by dispatching fresh subagent per task with review gates
- `using-git-worktrees` — create isolated git worktrees with smart directory selection
- `writing-plans` — create detailed bite-sized implementation plans for engineers

*Debugging (4):*
- `systematic-debugging` — four-phase debugging framework: root cause investigation before fixes
- `root-cause-tracing` — trace bugs backward through call stack to find original trigger
- `defense-in-depth` — validate at every layer data passes through to make bugs impossible
- `verification-before-completion` — run verification and confirm output before claiming success

*Testing (3):*
- `test-driven-development` — red-green-refactor: write test first, watch it fail, minimal code to pass
- `testing-anti-patterns` — never test mock behavior, never add test-only methods to production
- `condition-based-waiting` — replace arbitrary timeouts with condition polling for reliable async tests

*Problem Solving (6):*
- `when-stuck` — dispatch to the right problem-solving technique based on stuck-type
- `simplification-cascades` — find one insight that eliminates multiple components
- `collision-zone-thinking` — force unrelated concepts together for emergent innovation
- `meta-pattern-recognition` — spot patterns appearing in 3+ domains to find universal principles
- `inversion-exercise` — flip assumptions to reveal hidden constraints and alternatives
- `scale-game` — test at extremes (1000x bigger/smaller) to expose fundamental truths

*Architecture (1):*
- `preserving-productive-tensions` — preserve tensions between valid approaches instead of forcing premature resolution

*Research (1):*
- `tracing-knowledge-lineages` — trace how ideas evolved over time to find old solutions for new problems

*Prompting / Execution Patterns (3):*
- `phase-prompting` — turn verified state into execution-ready prompts with wave structure
- `round-prompting` — write focused single-round execution prompts (atomic unit of phase-prompting)
- `goal-driven-project-loop` — goal-driven execution loop: goal contract, gap selection, auto-iteration

*Deployment (5):*
- `vercel-deploy` — deploy apps to Vercel (preview by default, production on request)
- `netlify-deploy` — deploy web projects to Netlify using Netlify CLI
- `cloudflare-deploy` — deploy to Cloudflare Workers/Pages with decision trees for 40+ products
- `render-deploy` — deploy to Render via Blueprint (render.yaml) or Direct Creation (MCP)

*GitHub / CI (2):*
- `gh-fix-ci` — debug/fix failing GitHub PR checks (GitHub Actions only)
- `gh-address-comments` — address review/issue comments on open GitHub PRs

*Figma / Design (2):*
- `figma` — use Figma MCP server for design context, screenshots, variables, assets
- `figma-implement-design` — translate Figma nodes into production-ready code with 1:1 visual fidelity

*Browser / UI Testing (3):*
- `playwright` — drive real browser from terminal via playwright-cli (CLI-first automation)
- `playwright-interactive` — persistent browser/Electron interaction through js_repl for iterative UI debugging
- `screenshot` — desktop/system screenshot capture (macOS, Linux, Windows)

*Media Generation (4):*
- `imagegen` — generate/edit images via OpenAI Image API (gpt-image-1.5)
- `sora` — generate/remix Sora videos via OpenAI video API
- `speech` — text-to-speech narration via OpenAI Audio API
- `transcribe` — audio transcription with optional speaker diarization via OpenAI

*Document Generation (4):*
- `pdf` — read/create/review PDFs with rendering and layout validation
- `doc` — read/create/edit .docx documents with python-docx
- `slides` — create/edit PowerPoint decks with PptxGenJS
- `spreadsheet` — create/edit/analyze .xlsx/.csv spreadsheets with openpyxl/pandas

*Notion Integration (4):*
- `notion-meeting-intelligence` — prepare meeting materials with Notion context and tailored agendas
- `notion-research-documentation` — research across Notion and synthesize into briefs/reports
- `notion-spec-to-implementation` — turn Notion specs into implementation plans, tasks, and progress tracking
- `notion-knowledge-capture` — capture conversations/decisions into structured Notion pages

*Platform-Specific Development (4):*
- `winui-app` — bootstrap/develop WinUI 3 desktop apps with C# and Windows App SDK
- `aspnet-core` — build/review/refactor ASP.NET Core web applications
- `chatgpt-apps` — build/scaffold ChatGPT Apps SDK applications with MCP server + widget UI
- `develop-web-game` — build HTML/JS web games with Playwright-based test loop

*Documentation / Knowledge (1):*
- `openai-docs` — look up OpenAI developer docs via MCP, model selection, GPT-5.4 upgrade guidance

*Project Management (1):*
- `linear` — manage Linear issues, projects, and team workflows via Linear MCP

*Workflow / Git (1):*
- `yeet` — stage, commit, push, and open GitHub PR in one flow via gh CLI

*Observability (1):*
- `sentry` — read-only Sentry observability: inspect issues/events, summarize production errors

*Data Analysis (1):*
- `jupyter-notebook` — create/edit Jupyter notebooks for experiments or tutorials

*Security (3):*
- `security-threat-model` — repository-grounded threat modeling with trust boundaries, assets, abuse paths
- `security-best-practices` — language/framework-specific security best-practice reviews
- `security-ownership-map` — git history security ownership topology, bus factor, co-change graphs

*Meta / Using Skills (1):*
- `using-skills` — mandatory workflows for how to find, read, and use skills

## 10. Template command renderer and prompt effects

Template commands are file-backed prompt programs. They are not a separate slash-command system; they are one command source inside the unified command registry. The same renderer must also be callable from built-in commands and plugin commands, because a custom slash command may need to inject a prompt, spawn a subagent, run a permission-gated script, or combine those effects.

**Exact approach:**
1. `/` parsing only identifies command name and raw args.
2. Command resolution selects a `CommandDefinition` from the shared registry.
3. If the command is template-backed, its `execute(ctx)` calls `renderTemplate(template, ctx)`.
4. The renderer returns a `RenderedTemplate` plus requested execution metadata.
5. The command returns `submit_prompt` or `spawn_subagent` effects.
6. The central effect runner submits that payload through the same path as manual user input.

**Template source locations:**
1. Project Spectra commands: `.spectra/commands/**/*.md`
2. OpenCode compatibility commands: `.opencode/commands/**/*.md`
3. User/global Spectra commands: config dir `commands/**/*.md`
4. Config-defined commands: `commands` object in `spectra.json`
5. Bundled templates: `packages/code/src/commands/templates/**/*.md`

**Template command file format:**
```markdown
---
description: Review uncommitted changes
agent: review
model: anthropic/claude-sonnet-4-20250514
subtask: true
mode: read-only
capabilities:
  shell: false
  files: read
arguments:
  - name: scope
    description: Files, branch, or review focus
---
Review the current changes.

User scope:
$ARGUMENTS
```

**Renderer responsibilities:**
- [ ] Parse YAML frontmatter and markdown body with diagnostics that include source path and line number
- [ ] Support `$ARGUMENTS`, `$1`, `$2`, `$3`, and last-positional-rest substitution
- [ ] Append raw args to the end of the prompt only when the template declares no placeholders
- [ ] Resolve `@file` references through the same attachment/path-safety pipeline as prompt input
- [ ] Support typed context providers such as `{{git.status}}`, `{{git.diff}}`, `{{session.summary}}`, and `{{selection.text}}`
- [ ] Context providers must be explicit, permission-aware, cached per render, and visible in diagnostics
- [ ] Return `RenderedTemplate` with prompt text, attachments, metadata, sourceInfo, requested model/agent/subtask mode, and provenance
- [ ] Never mutate session state from the renderer; only command/effect execution may persist messages or open UI

**Script and shell policy:**
- [ ] Do not implement OpenCode-style inline shell expansion (`` !`cmd` ``) until permission prompts, audit output, and cancellation are wired
- [ ] Template commands may request context providers; providers can internally use safe services or permission-gated tools
- [ ] Plugin commands that need scripts must return a `run_script` effect; the central effect runner asks permissions and records output
- [ ] Script output intended for the model must become a visible message/content block or template context block, not hidden ambient state

**Built-in templates to create:**
- [ ] `commit.md` — inspect status/diff/log, detect secrets, stage only intended files, draft matching commit message, and commit with safety rules
- [ ] `review.md` — determine review target, collect relevant diff/context, inspect correctness/security/performance, and report actionable findings
- [ ] `explain.md` — explain selected code or current error with file/context references
- [ ] `test.md` — plan and run focused verification for the current change

## 11. Command-spawned subagents

Commands may start child sessions when the command's result is better isolated from the main conversation. `/review` should default to a read-only subagent; `/commit` can run inline or in a full-access subagent depending on user intent and permissions.

**Design:**
- [ ] `spawn_subagent` effect accepts rendered prompt, agent id, model override, permission profile, parent session id, and source command metadata
- [ ] Child session inherits deny rules, external path restrictions, model/provider defaults, attachments, and relevant session context from parent
- [ ] Child session title format: `"${command description} (@${agent} subagent)"`
- [ ] Parent session records a visible message linking to child session id and result summary
- [ ] Read-only mode disables write/edit/shell mutating tools even if the parent has them enabled
- [ ] Full-access mode still requires normal permission gates and cannot bypass user approvals

**Commands that need this:**
- [ ] `/review` — render review template, spawn read-only review subagent, return findings to parent
- [ ] `/commit` — render commit template; run inline for direct user command or spawn full-access subagent when requested
- [ ] Plugin commands — may request subagents through the same `spawn_subagent` effect, never through private session APIs

## 12. Commit and review command protocols

Commit/review behavior belongs in template-backed commands, not hardcoded into the shell tool. The shell tool may expose wall time, timeout, exit code, and safety hints, but command policy should live in templates plus command effects so users and plugins can override it.

**Commit protocol:**
- [ ] Inspect `git status --short`, staged diff, unstaged diff, and recent commit style
- [ ] Refuse obvious secrets or credential files unless the user explicitly overrides after warning
- [ ] Stage only files relevant to the requested change; never include unrelated local work by default
- [ ] Draft a concise message matching repository style
- [ ] Run the project-specific verification required by the template before committing
- [ ] Commit only after verification and final staged-file check
- [ ] Never amend, force push, hard reset, or skip hooks unless explicitly requested

**Review protocol:**
- [ ] Detect target: unstaged changes, staged changes, current branch, PR, selected files, or user-specified scope
- [ ] Gather only relevant files/diffs and avoid reading unrelated large artifacts
- [ ] Report correctness, regressions, security, performance, maintainability, and missing verification
- [ ] Return findings with file/line references and severity
- [ ] Avoid style-only noise unless it hides a real maintainability risk

## 13. Coding plan provider integrations

Support bundled access to popular AI coding subscription plans — giving users affordable, multi-model access without managing individual provider API keys. These plans are OpenAI/Anthropic-compatible and work with any agent that speaks those protocols.

**Why this matters:** The 2026 coding plan ecosystem (OpenCode Go/Zen, MiniMax Token Plan, GLM Coding Plan, Kimi Code Plan, Qwen Coding Plan) offers $10-120/mo subscriptions with generous quotas, but each has its own model roster, quota windows, and rate limits. Spectra should integrate these as first-class providers with smart routing and quota awareness.

**Plans to support:**

| Plan | Price | Models | Quota System | API Compatibility |
|------|-------|--------|--------------|-------------------|
| OpenCode Go | $10/mo | 14 open models (DeepSeek V4, GLM 5.1, Qwen 3.7, Kimi K2.5/K2.6, MiniMax M2.5/M2.7, MiMo-V2.5) | Dollar-equivalent: $12/5h, $30/week, $60/month | OpenAI-compatible |
| OpenCode Zen | Pay-as-you-go | 40+ models (Claude, GPT, Gemini, DeepSeek, GLM, Kimi) | Per-token billing | OpenAI + Anthropic-compatible |
| MiniMax Token Plan | $20-120/mo | M3, M2.7, M2.7-highspeed | 5h + weekly token windows, 3-7 concurrent agents | OpenAI-compatible |
| GLM Coding Plan (Zhipu) | ¥49-469/mo (~$7-65) | GLM-5/5.1, GLM-4.7, GLM-4.6 | 5h + weekly prompt windows, MCP included | OpenAI + Anthropic-compatible |
| Kimi Code Plan (Moonshot) | ¥49-699/mo (~$7-97) | Kimi K2.5, K2.6, K2.7 | 5h token quota, 7-day refresh | Anthropic-compatible |
| Qwen Coding Plan (Alibaba) | TBD | Qwen 3.6/3.7 Plus/Max | Token-based quota | OpenAI-compatible |

**Implementation:**
- [ ] Provider registry: define plan metadata (name, models, pricing, quota windows, API endpoints) in a config file or registry
- [ ] Subscription key management: store plan API keys in auth store, support multiple concurrent plans
- [ ] Quota tracker: monitor 5h/weekly/monthly usage windows per plan, expose remaining quota to UI
- [ ] Smart model router: given a task, pick the best available model across all subscribed plans based on capability, remaining quota, and cost
- [ ] Fallback chain: when one plan hits quota limits, automatically route to next available model/plan
- [ ] Plan status command: `/plans` — show all subscribed plans, models, remaining quota, reset times
- [ ] Per-plan cost tracking: aggregate token usage and dollar-equivalent cost per plan per session
- [ ] Rate limit awareness: respect 5h rolling windows, warn when approaching quota limits
- [ ] Model capability registry: map each plan's models to their context windows, strengths, and benchmarks
- [ ] Integration with existing provider system: plans register as providers in `packages/ai` registry

## 14. Multimodal input support

Enable users to attach files (images, audio, video, text, PDFs, etc.) directly in the prompt input and send them as multimodal content to LLMs. Refer to OpenCode's implementation for the UX baseline — their prompt component uses extmarks (virtual text placeholders) and a MIME-typed badge system.

**Badge display in prompt input:**
- Each attached file renders as an inline badge/pill in the prompt textarea using extmarks
- Badge format: `[Icon Label] filename` — two-segment pill with a colored icon segment + muted filename
- Icon/label per media type with distinct colors:

| Media Type | MIME Group | Badge Label | Icon | Color |
|------------|-----------|-------------|------|-------|
| Text files | `text/*` | `TXT` | `T` (document icon) | `theme.secondary` |
| Images | `image/*` | `IMG` | camera/image icon | `theme.accent` |
| PDFs | `application/pdf` | `PDF` | document icon | `theme.primary` |
| Audio | `audio/*` | `AUD` | speaker/sound icon | `theme.warning` |
| Video | `video/*` | `VID` | film/video icon | `theme.error` |
| Directories | `application/x-directory` | `DIR` | folder icon | `theme.secondary` |
| Other | fallback | MIME shortname | file icon | `theme.secondary` |

**Supported MIME types:**
- Images: `image/png`, `image/jpeg`, `image/gif`, `image/webp`
- Audio: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/flac`, `audio/aac`
- Video: `video/mp4`, `video/webm`, `video/quicktime`
- Documents: `application/pdf`, `text/plain`, `text/markdown`, `text/csv`, `text/html`, `text/css`, `text/javascript`, `application/json`, `application/xml`
- Directories: `application/x-directory`

**Attachment methods (match OpenCode patterns):**
- [ ] `@` fuzzy search — type `@` to trigger autocomplete, fuzzy-search files by path, select one
- [ ] Paste/drag file path — detect pasted file paths, read content based on MIME extension mapping
- [ ] Clipboard image paste — read system clipboard for image data (cross-platform: macOS/Linux/Windows)
- [ ] Clipboard audio/video paste — read clipboard for media file references where supported

**Provider-level multimodal message construction:**
- [ ] Anthropic Messages API: `{ type: "image", source: { type: "base64", media_type, data } }` for images; `{ type: "document", source: { type: "base64", media_type, data } }` for PDFs; audio via `{ type: "input_audio", input_audio: { data, format } }`
- [ ] OpenAI Chat Completions: `{ type: "image_url", image_url: { url: dataUrl } }` for images; `{ type: "input_audio", input_audio: { data, format } }` for audio (supported models only)
- [ ] OpenAI Responses API: `{ type: "input_image", image_url }` for images; `{ type: "input_audio", audio: { data, format } }` for audio
- [ ] Gemini: `{ inlineData: { mimeType, data } }` — supports all media types natively
- [ ] Capabilities per provider: track which providers support which media types, gracefully degrade (e.g., skip audio/video for providers that don't handle it, show a warning badge)

**Remaining implementation:**
- [ ] Attachment preview: optional thumbnail for images, duration/size metadata for audio/video in badge tooltip

**OpenCode reference files:**
- `packages/tui/src/component/prompt/index.tsx` — extmark creation, paste handling, submission
- `packages/tui/src/component/prompt/autocomplete.tsx` — `@` file search, `createFilePart()`
- `packages/tui/src/component/prompt/local-attachment.ts` — MIME detection by extension
- `packages/tui/src/routes/session/index.tsx:1353-1435` — `MIME_BADGE` map + badge rendering
- `packages/tui/src/theme/index.ts:600-621` — extmark style definitions
- `packages/llm/src/schema/messages.ts` — `MediaPart` schema
- `packages/llm/src/protocols/shared.ts` — `IMAGE_MIMES`, `validateMedia()`

## 15. Future deferred

The following are deferred until the core system is stable and functional:

- [ ] **Session branching** — deep-copy sessions like git branches, list branches, switch between them. High complexity, low urgency.
