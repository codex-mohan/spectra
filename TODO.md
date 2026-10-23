# Spectra Roadmap

## 1. Context compaction

Automatic context management that summarizes old conversation history when approaching token limits, preserving recent turns verbatim.

- [ ] Async pruning pass: mark old tool outputs as compacted, protect recent 40K, never prune `skill` tool outputs
- [ ] Auto-continue after compaction ("Continue if you have next steps...")

## 2. Agent loop safety guards

Defensive mechanisms in the agent loop to prevent common failure modes. Based on patterns from OwlCoda's conversation engine.

- [ ] Narration loop detection: detect repetitive output patterns (e.g., same sentence repeated 3+ times), interrupt and prompt user
- [ ] Output bloat detection: warn when single tool output exceeds reasonable size (e.g., 50K chars), offer to truncate
- [ ] Task no-progress hard stop: if agent makes N turns with no file writes or meaningful progress, pause and ask for direction
- [ ] Convergence state machine: track whether agent is making forward progress or cycling between states
- [ ] Surface safety events (interrupt, warning, hard-stop) through the agent event stream so TUI can render them

## 3. Command system: slash invocation, templates, and plugin commands

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

## 4. Plugin system

Detailed architecture, lifecycle invariants, integration boundaries, migration phases, tests, and acceptance criteria: [Plugin System Architecture and Implementation Plan](docs/plans/plugin-system-plan.md).

**Implementation sequence:**
- [ ] Build the framework-neutral runtime kernel: typed services, scopes, owned effects, dependency activation, rollback, and awaited disposal
- [ ] Add plugin manifests, capabilities, discovery, configuration validation, diagnostics, and inspection commands
- [ ] Migrate built-in, MCP, and custom tools to one lifecycle-owned tool registry and interceptor pipeline
- [ ] Add prompt, message, provider, compaction, and human-interaction services with persistent/transient mutation boundaries
- [ ] Move built-in, template, skill, MCP, and plugin commands into one command registry and effect runner
- [ ] Create process, project, session, agent, and child-agent scopes with inherited, narrowing security policy
- [ ] Introduce stable OpenTUI slots after host lifecycle and keyboard/focus ownership are proven
- [ ] Remove each legacy manual registry, wrapper, callback, or direct optional-feature import after its subsystem migrates
- [ ] Implement equivalent Rust lifecycle semantics natively after the TypeScript contracts stabilize; no bindings, FFI, or shared runtime

## 5. Observability middleware

Per-request metrics, cost tracking, and runtime health visibility at the HTTP proxy/transport layer.

- [ ] Request latency metrics: time-to-first-token, total duration, p50/p95/p99 aggregates
- [ ] Rate limit headers parsing: extract `X-RateLimit-*` headers from provider responses, surface to UI
- [ ] Expose metrics through agent event stream so TUI can render `/cost`, `/tokens`, `/stats` commands

## 6. Session handling overhaul

Spectra's session system now uses SQLite-backed sessions and messages, but normalization, pagination, branching, search, metadata, and archival still need production-grade designs.

**Storage:**
- [ ] Add a normalized parts table with foreign keys for message content blocks
- [ ] Cursor-based pagination for session listing

**Fork & Branch:**
- [ ] Deep copy with ID remapping (prevent collisions between forked sessions)
- [ ] Fork from specific message point (not just entire session)
- [ ] Fork count in title (e.g. "Title (fork #1)")

**Search & Filtering:**
- [ ] SQL LIKE search on title, model, agent
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

## 7. Skills system

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

## 8. Template command renderer and prompt effects

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

## 9. Command-spawned subagents

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

## 10. Commit and review command protocols

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

## 11. Coding plan provider integrations

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

## 12. Multimodal input support

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

## 13. Oh My Pi reference adoption

Reference checkout: `C:\Users\wwwmo\reference-projects\oh-my-pi`.

**Tool parity candidates:**
- [ ] Tool registry: separate always-on tools from gated/hidden tools, with settings-based activation
- [ ] Tool discovery: BM25 search over hidden tools so agents can activate specialized tools mid-session
- [ ] Cross-harness MCP discovery: load and normalize MCP server definitions from project/user `.codex`, `.claude`, `.opencode`, and other supported harness/app config locations; merge by server name with explicit Spectra precedence, preserve source provenance, and never modify foreign configuration files
- [ ] Code intelligence: add LSP tool support for diagnostics, references, rename, code actions, symbols, hover, and definitions
- [ ] Debugger integration: add DAP tool support for launch/attach, breakpoints, stepping, stack, scopes, variables, and evaluation
- [ ] Browser automation: add Puppeteer/CDP tab control for web and desktop-app automation
- [ ] Background job tool: async shell/task handles with wait/cancel and completion injection
- [ ] IRC coordination: short live messages between parent and child agents
- [ ] Output artifacts: persist truncated tool output behind stable `artifact://` references
- [ ] Internal URL schemes: resolve `agent://`, `artifact://`, `issue://`, `pr://`, `skill://`, and related schemes through read/search-shaped tools
- [ ] Image tools: inspect images with vision models and generate/edit images via configured image providers
- [ ] Memory tools: split durable memory into retain, recall, reflect, edit/learn/manage flows instead of one generic memory tool
- [ ] Checkpoint/rewind: conversation-state collapse points for pruning exploratory context while keeping a report
- [ ] Replace string-match edit with hashline-style anchored patching: `[path#tag]`, tight line ops, content-hash freshness checks, and fresh tags after every edit
- [ ] Record file snapshots from read/search output so edit anchors prove the model saw the target lines
- [ ] Add stale-edit recovery: replay intended edits against cached snapshots and 3-way merge onto current file only when anchors safely remap
- [ ] Add syntax-aware block operations for whole functions/classes/Markdown sections, backed by tree-sitter where available
- [ ] Preflight multi-file/multi-section edits before writing so parse/stale/no-op failures do not partially apply
- [ ] Integrate edit writes with LSP formatting/diagnostics and surface deferred diagnostics in the transcript
- [ ] Add no-op edit loop detection so repeated byte-identical patches become hard failures instead of silent cycles
- [ ] Startup/onboarding polish: animated ASCII splash, gradient logo/welcome card, provider setup wizard scenes, and animated provider sign-in feedback

**Subagent orchestration and recovery (research from Oh My Pi):**

Spectra already accepts structured `tasks[]`, starts background child sessions, tracks `running | completed | error | cancelled`, and accepts `task_id` for extensions or a follow-up run. However, `tasks[]` is currently combined into one prompt for one child rather than fanning out to independent agents. The parent has no model-facing live status or timed wait tool, and `runSubagent()` creates a fresh `Agent` for each call, so passing a previous `task_id` does not restore the child's actual conversation. Background runs also mark a returned `SubagentResult.error` as completed when the runner does not throw.

Oh My Pi's `task` tool fans out one child per assignment, returns stable agent/job IDs, exposes live progress and a concise transcript, and retains finished agents as `idle` before parking and reviving them from saved sessions. Its `job` tool provides immediate snapshots plus a bounded poll that wakes on the **first** watched job to settle or on timeout. Its `irc` tool lets the parent inspect peers and send messages to running or parked agents. Spectra should support an explicit **wait-for-all** mode in addition to first-completion polling, because the requested parent pause should end as soon as every watched child settles, even if the timer has not expired.

- [ ] Fan out each `tasks[]` item as an independent child with its own stable ID, role, assignment, session, result, and bounded concurrency; preserve shared `context` without merging assignments into one child prompt
- [ ] Make subagent instructions a validated, documented contract: shared goal/constraints/context, then per-child target/change/acceptance/reporting; show each specialist role in the child prompt and status view
- [ ] Add a model-facing status/list tool for parent-owned children showing queued/running/idle/parked/completed/failed/cancelled state, current activity, elapsed time, recent progress, errors, and links to saved transcripts/results while children are still running
- [ ] Add a cancellable timed wait tool for selected child IDs (or all current children), with a live status snapshot and a bounded timeout; support both `first` and `all` completion conditions
- [ ] In `all` mode, race the timer against the **last** watched child settling: cancel the remaining timer and resume the parent immediately when all children have completed, failed, or been cancelled; return a snapshot on timeout without stopping any child
- [ ] Deliver background completion/failure to the parent exactly once, including results that finish while the parent is paused; prevent duplicate delivery when a wait call already consumed those results
- [ ] Persist enough child state to resume the same conversation and tool context after success or recoverable failure, including process restart; distinguish retryable network/provider interruption from hard cancellation and avoid replaying already completed side effects
- [ ] Let the parent steer a running child and follow up with an idle or parked child by ID; queue mid-run instructions safely, revive parked children on demand, and report a clear terminal reason when revival is impossible
- [ ] Keep lifecycle transitions and UI status consistent across crashes, aborts, timeout, and restart; ensure an error result cannot be recorded as successful completion
- [ ] Verify concurrent fan-out, mid-run inspection, first/all wait semantics (including all-finish-before-timeout), timeout without cancellation, single result delivery, and faithful resume after a simulated transient network failure

**Reference files (subagent orchestration):**
- `packages/coding-agent/src/prompts/tools/task.md` — delegation guidance and structured context/assignment contract
- `packages/coding-agent/src/task/index.ts`, `task/executor.ts`, `task/parallel.ts` — fan-out, child execution, progress, and concurrency
- `packages/coding-agent/src/tools/job.ts`, `async/job-manager.ts` — list/poll/cancel, early wake on first settlement, timed wait, completion delivery
- `packages/coding-agent/src/tools/irc.ts`, `registry/agent-registry.ts`, `registry/agent-lifecycle.ts` — live peer state, messaging, parking, and revival
- `docs/tools/task.md`, `docs/tools/job.md`, `docs/tools/irc.md` — behavior and important lifecycle limits

**Mid-turn rule enforcement (TTSR — time-traveling stream rules):**

Rules today are static: they load into the system prompt once and are never checked again. Oh My Pi turns the same markdown-plus-frontmatter files into an armed policy engine that fires while the model is still writing, which catches a violation at the moment it is produced instead of after the file is on disk.

- [ ] Rule files: accept `condition` regexes, `astCondition` ast-grep patterns (edit/write streams only), `scope` tokens (`text`, `thinking`, `tool:edit(*.ts)`), and a per-rule `interruptMode` of `never | prose-only | tool-only | always`
- [ ] Rule providers: merge project rules over a lowest-priority bundled defaults provider, preserve source provenance, and offer a switch that drops every bundled rule
- [ ] Streaming matcher: evaluate conditions against assistant text deltas, thinking deltas, and tool-argument deltas, exposing both incremental `checkDelta` and full-buffer `checkSnapshot`
- [ ] Interrupting enforcement: abort and rewind the stream on a match so the violating output never lands, then inject `<system-interrupt reason="rule_violation" rule="…" path="…">`
- [ ] Non-interrupting enforcement: let the tool run and attach `<system-reminder reason="rule_violation" rule="…" path="…">` to that tool's result through the after-tool-call hook
- [ ] Injection provenance: every injected notice must state that it is the harness enforcing project rules and not untrusted content, so file content and worker output can never be mistaken for a rule
- [ ] Fire-once bookkeeping: mark a rule as injected, restore injected names on session resume so a rule does not nag every turn, and allow deliberate re-reminding after a message gap
- [ ] Reachability precomputation: skip rules that cannot fire in the current scope or have no ast conditions, so the streaming hot path stays cheap
- [ ] Path and glob scoping: match rule `globs` against the file paths in the tool call, not only against the argument text
- [ ] Emit rule interruption as its own agent event so the TUI can show what was blocked and which rule blocked it

**Reference files (mid-turn rule enforcement):**
- `packages/coding-agent/src/capability/rule.ts` — `Rule` contract, frontmatter, condition/scope/interruptMode parsing
- `packages/coding-agent/src/capability/rule-buckets.ts` — provider priority and the bundled-rules switch
- `packages/coding-agent/src/export/ttsr.ts` — `TtsrManager`: delta/snapshot matching, scope and glob resolution, injected bookkeeping, buffer reset
- `packages/coding-agent/src/prompts/system/ttsr-tool-reminder.md` — non-interrupting notice template
- `packages/coding-agent/src/prompts/system/ttsr-interrupt.md` — interrupting notice template
- `packages/coding-agent/src/session/agent-session.ts` — stream matching hook, after-tool-call folding, abort/retry/resume
- `packages/coding-agent/src/discovery/builtin-rules/` — bundled default rules

**Subscription and quota tracking from Oh My Pi:**
- [ ] Normalize provider usage into `UsageReport`, `UsageLimit`, `UsageWindow`, `UsageAmount`, and `UsageScope` types
- [ ] Add usage providers for OpenAI Codex, OpenCode Go, Claude/Anthropic, Gemini CLI, GitHub Copilot, Kimi Code, MiniMax Code, GLM/Z.AI, and Alibaba/Qwen plans
- [ ] Track OpenCode Go with observed request cost windows: `$12/5h`, `$30/week`, `$60/month`
- [ ] Track OpenAI Codex `/wham/usage` windows, plan type, additional limits such as Spark, and saved reset credits
- [ ] Store usage snapshots and render `usage --history` trends by provider/account/window
- [ ] Record per-request cost history for providers without upstream usage APIs
- [ ] Rank and rotate multiple credentials by live usage: prefer less-used windows, avoid exhausted accounts, respect retry/reset times
- [ ] Parse usage-limit errors separately from transient 429s so exhausted accounts rotate instead of retry-looping
- [ ] Surface usage in CLI/TUI with redacted account identities, status bars, reset times, and aggregate capacity
- [ ] Thread service-tier settings through model requests: OpenAI `auto/default/flex/scale/priority`, Anthropic `priority`, Google `flex/priority`

**Reference files:**
- `packages/coding-agent/src/tools/builtin-names.ts` — built-in tool names and legacy aliases
- `packages/coding-agent/src/tools/index.ts` — tool registry, gated tools, task/tool session contract
- `packages/coding-agent/src/tool-discovery/tool-index.ts` — hidden tool search index
- `packages/ai/src/usage.ts` — normalized usage schema
- `packages/ai/src/auth-storage.ts` — credential ranking, rotation, usage cache, usage-limit handling
- `packages/ai/src/usage/openai-codex.ts` — OpenAI Codex usage windows and reset credits
- `packages/ai/src/usage/opencode-go.ts` — OpenCode Go observed spend windows
- `packages/coding-agent/src/cli/usage-cli.ts` — usage CLI, redaction, status bars, history rendering
- `packages/coding-agent/src/config/service-tier.ts` — per-family service-tier settings

## 14. Future deferred

The following are deferred until the core system is stable and functional:

- [ ] **Session branching** — deep-copy sessions like git branches, list branches, switch between them. High complexity, low urgency.

## 15. Model catalog and cost accuracy (planned)

Reference implementation studied in full: `C:\Users\wwwmo\reference-projects\oh-my-pi` (catalog generation, discovery protocols, model registry, credentials, pricing). This section is self-contained so another session can execute it without re-doing the research.

**Status:** Phase 0 shipped. Phases 1–8 planned.

### Why

Three user-visible failures drove this plan:

1. Codex showed stale models because the pinned client version was never sent to `/codex/models` (fixed) and because `packages/ai` serves stale `dist/`.
2. The model list depends entirely on a regenerated bundle plus an on-demand fetch with silent fallback — wrong or missing rows are invisible.
3. The status-bar cost is inaccurate: cache tokens are never priced, pricing is provider-blind, and cost is recomputed in the UI instead of stored.

### Current state (file:line evidence)

| Area | Today | File |
|---|---|---|
| Bundled catalog | `{id,name,contextWindow}` only | `packages/ai/src/models.ts`, `packages/ai/scripts/generate-models.ts` |
| Provider contract | `discoverModels` returns `{models}` or throws | `packages/ai/src/registry.ts:9-29` |
| Runtime cache | scope key + `authoritative`, no TTL, writes on failure | `packages/code/src/services/model-catalog.ts:424-506` |
| Resolution | on demand, silent fallback to bundle | `packages/code/src/services/model-service.ts:96-125` |
| Context window | bundled-only lookup | `packages/code/src/tui/utils/model-config.ts:68-84` |
| Pricing | global id-keyed table, last provider wins, fuzzy prefix match | `packages/ai/src/pricing.ts:25-94` |
| Cost display | recomputed in UI from `input/output` only | `packages/code/src/tui/hooks/use-chat-submit.ts:578`, `packages/code/src/tui/utils/session-messages.ts:42-54`, `packages/code/src/tui/app.tsx:232-239` |
| Subagent cost | sums `usage.cost`, never set → always 0 | `packages/agent/src/subagent.ts:97-107` |
| Package resolution | `packages/ai` exports `dist/`; stale builds are invisible | `packages/ai/package.json` |

### Target architecture

- `packages/ai` stays pure: discovery protocols, normalization, cost math, row shape.
- `packages/code` owns state: registry layers, SQLite cache, credentials, UI.
- One row owns identity, transport, limits, capabilities, and cost.
- Cost is computed once at provider finalization into `usage.cost`, persisted with the message, and only summed downstream.
- Every fallback is visible: cached age, auth state, discovery error.

### Phases

#### Phase 0 — Cost correctness (shipped)

- [x] Extend `Model` with `cost?: ModelCost` (`maxTokens` already existed). Bundled rows stay lean: the runtime provider-scoped table supplies cards until Phase 1 adds cost to generated rows.
- [x] `pricing.ts`: provider-scoped lookup (`provider\0model`, `openai-codex`→`openai` and `opencode-zen`→`opencode` aliases), hardcoded table last, fuzzy `startsWith` matching removed.
- [x] `calculateUsageCost(model, usage)` prices input/output/cacheRead/cacheWrite; OpenAI `inputUncached` split; `longContext.inputThreshold` promotion (service-tier multiplier deferred).
- [x] `Usage.inputUncached` added; OpenAI completions/responses set `prompt_tokens − cached_tokens`, Anthropic leaves it undefined because `input` already excludes cache.
- [x] Every provider sets `usage.cost` at finalization, on both success and error paths.
- [x] UI reads the stored cost: `use-chat-submit` and `session-messages` no longer reprice; session reload is stable.
- [x] Status bar shows `Free` only for `pricingStatus === 'free'`; unknown renders nothing; `session-stats-dialog` matches.
- [ ] Cache cost breakdown in `session-stats-dialog` (needs per-component sums plumbed).
- [x] `usage-store` records `cacheReadTokens`/`cacheWriteTokens` and includes them in token totals and windows.

**Phase 0 notes:** legacy messages without `usage.cost` aggregate as `$0` (no retroactive repricing); bundled rows still lack cost until Phase 1; the pricing table loads once per process and is not refreshed.

**Acceptance:** Anthropic cache-heavy fixture priced correctly; OpenAI cached tokens billed at cache rate; session reload keeps identical cost; subagent cost non-zero; unknown model shows `—`.

#### Phase 1 — Row shape + discovery contract

- [ ] Row: `{id,name,api?,baseUrl?,contextWindow?,maxTokens?,reasoning?,input?,supportsTools?,cost?}`
- [ ] `discoverModels` returns `{models} | null | []` (`null` = failed, `[]` = authoritative empty)
- [ ] `DiscoveryHttpError(status, url)` + `isAuthRejection`
- [ ] Shared normalizer: tolerant envelope, field precedence (`max_model_len` → `context_length` → limits → native → bundled → default), output-cap clamp, modalities, non-chat kind routing
- [ ] Update all in-tree `discoverModels` and `register-builtins` wrappers

**Acceptance:** tri-state tests, envelope variants, no throw on 404.

#### Phase 2 — Runtime model registry

- [ ] New `packages/code/src/services/model-registry.ts`: bundled → cache → live; authoritative prunes bundled chat rows only
- [ ] Strategies `offline | online-if-uncached | online`; fetch TTL 2 h, non-authoritative retry 5 min, freshness computed at read
- [ ] Cache schema v2: `{scope_key, provider_id, account_id, base_url, models, fetched_at, authoritative, materialization_policy, models_hash}`; write only on successful fetch; on failure keep prior rows and mark non-authoritative
- [ ] Per-provider `ProviderDiscoveryState {status, stale, fetchedAt, source, error}`
- [ ] Startup hydrate → background refresh → UI re-read; coalesce per provider; 15 s timeout
- [ ] `model-service.ts` becomes a thin adapter; delete catch-all fallback

**Acceptance:** offline cold start renders cached rows; failure preserves rows and reports status; picker opens with zero network.

#### Phase 3 — Credentials and multi-account

- [ ] `auth-store` accepts `Credential | Credential[]` (backwards-compatible read); account key = `accountId ?? email`
- [ ] Two-tier keys: `peek` (no refresh, skips expired OAuth) and `get` (single-flight refresh, 60 s skew, persist rotation)
- [ ] Discovery escalation: peek empty + stored OAuth → refresh; log and fall back on failure
- [ ] Multi-account for `openai-codex`: enumerate, fetch per account, union by id, skip 401/403 accounts, abort on transient failure; `accountAccess` → `ChatGPT-Account-Id`
- [ ] `unauthenticated` status when a non-keyless provider has no credential

**Acceptance:** expired Codex token discovers live models; revoked account skipped; transient failure keeps prior catalog.

#### Phase 4 — Provider coverage

- [ ] Generic OpenAI-compatible normalizer + `filterModel`/`transformModel` hooks; collapse duplicated wrappers
- [ ] Anthropic `/v1/models` (`x-api-key` vs Bearer, beta headers, maxTokens 8192)
- [ ] Gemini native `/v1beta/models` (pagination, `generateContent`)
- [ ] Ollama native `/api/tags` + `/api/show`; llama.cpp `/models` + `/props` (`-1` sentinel); LM Studio `/api/v0/models`
- [ ] LiteLLM rich endpoints → `/v1/models` fallback; proxy `supported_endpoint_types`
- [ ] Copilot tiered billing + `-1m` sibling (only if the provider ships)

**Acceptance:** fixture test per protocol; no hand-rolled `/models` fetches left.

#### Phase 5 — Catalog generation hygiene

- [ ] Provider table as typed data (`providerId`, `defaultModel`, `envVars`, `discovery`, `seedRows`, `bundle: always|fallback|empty|never`)
- [ ] Ordered generator phases: models.dev → endpoint discovery (reuse runtime normalizers) → seeds → previous snapshot → derive → dedupe → **sort** → write
- [ ] `--provider <id>` partial regeneration; hard error on empty slice
- [ ] Authoritative-empty non-authoritative; `stale` results are failures; retired-provider list
- [ ] Dist freshness guard (CI/build check or `prepack`) so stale `dist/` cannot ship
- [ ] Parity test: two consecutive regens are byte-identical

**Acceptance:** double regen = no diff; `--provider openai-codex` touches one block; CI fails on stale dist.

#### Phase 6 — UI / CLI surface

- [ ] `spectra models ls|find|refresh|<provider> [--json] [--kind]`
- [ ] Picker/dialog: cached age, `needs sign-in`, discovery error, provider status dots
- [ ] `models doctor`: credential, cache age, discovery result, actionable fix
- [ ] Status bar: cost breakdown in stats, context % from registry row, `~` when estimated

**Acceptance:** command tests; actionable error for a bad key; picker never blocks.

#### Phase 7 — Request-time consistency

- [ ] `lookupContextWindow` reads the registry row (cache/live first), bundled only as fallback
- [ ] `compaction` and `contextUsage` consume the same row (`contextWindow`, `maxTokens`)
- [ ] Post-discovery rebind when the window changed + warning drain
- [ ] Model selection validates against the registry with an actionable error

**Acceptance:** live window drives % and compaction threshold.

#### Phase 8 — Validation and rollout

- [ ] Test matrix: per-provider discovery fixtures, cache policy, credential refresh, cost math, session restore, CLI
- [ ] Perf: cached read < 10 ms for 200 rows; background refresh never blocks first paint
- [ ] Docs (`docs/public/llms.txt`, provider docs) + changesets per phase
- [ ] Rollout 0 → 1 → 2 → 3 → (4 in slices) → 5 → 6 → 7; each phase independently revertible

### Non-goals

KDL/compat rule engine; 77 provider-specific mappers; Cursor/Devin protobuf transports; Factory Droid flag discovery; GitLab GraphQL; `models.yml` user discovery config; multi-account beyond Codex until requested.

### Risks

| Risk | Mitigation |
|---|---|
| Provider forgets `usage.cost` → silent 0 | per-provider test asserting a paid fixture has cost > 0 |
| Usage semantics drift | explicit `inputUncached`, provider assertions |
| Cache schema migration | version bump; old rows ignored, not deleted |
| Background refresh races UI | single in-flight promise per provider |
| Row bloat in `models.ts` | ~10 fields; measure size before/after |

### Pitfalls discovered during research (do not repeat)

- `packages/ai` resolves through `dist/` — always rebuild before testing runtime behavior, or add a freshness guard.
- Codex `/codex/models` is **version-gated**: `client_version` and `version` header pinned to `0.159.0`; a stale pin silently hides newer SKUs.
- OpenAI `usage.input` **includes** cached tokens; Anthropic excludes them. Pricing `input` as reported overcharges OpenAI cached tokens and undercharges Anthropic cache reads.
- `pricing.ts` is id-only: models.dev iteration makes the last provider win for a shared model id; bidirectional `startsWith` can bind a different SKU.
- `isFreeModel` returns `true` when pricing is unknown — never display "Free" from a missing card.
- React effect cleanup keyed on a prop identity (`registerHandler` from `app.tsx`) can abort in-flight work; re-registering must not cancel.
- `models.ts` regeneration is order-unstable (Map iteration) — sort before emit or diffs churn.

### Reference pointers (oh-my-pi)

- `packages/catalog/scripts/generate-models.ts` — source strata, bundle policy, partial regen
- `packages/catalog/src/provider-models/descriptors.ts` — provider descriptor shape
- `packages/catalog/src/discovery/codex.ts` — client_version, `-wm` twins, context floors
- `packages/catalog/src/model-manager.ts` — strategies, TTLs, `{models, stale, source}` result
- `packages/catalog/src/model-cache.ts` — cache schema, side freshness row, fingerprints
- `packages/coding-agent/src/config/model-registry.ts` — layers, refresh, status, background
- `packages/coding-agent/src/config/model-discovery.ts` — configured-provider protocols
- `packages/coding-agent/src/config/model-provider-discovery.ts` — credential-scoped discovery, multi-account union
- `packages/coding-agent/src/cli/models-cli.ts` — CLI surface and JSON contract
- `packages/coding-agent/src/config/model-resolver.ts` — matching engine
- `packages/ai/src/auth/cascade.ts` — peek vs get credential precedence

### Next action

Phase 1: widen the model row (`api`, `baseUrl`, `maxTokens`, `reasoning`, `input`, `cost`) and return `{models} | null | []` from `discoverModels` so "authoritative empty" is expressible. Phase 0's remaining item (cache cost breakdown in the stats dialog) is optional and can ride along.

### Already shipped (do not redo)

- `6365cdf` `ai(fix)` send the pinned client version when discovering Codex models
- `962f17b` `ai(chore)` regenerate model catalog (Codex 5 → 8 models)
- `0a4db17` `code(fix)` stop the OAuth dialog from cancelling its own login on re-render
- `f13dd1e` `code(fix)` dual-loopback OAuth callback, abort frees port 1455, exchange retry, pixel callback page
