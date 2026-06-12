# Spectra Roadmap

## 1. Publish `@mohanscodex/spectra-code` to npm

Make the Spectra Code package installable via npm (or other package managers) so users can add it as a dependency rather than needing the full monorepo.

- [ ] Ensure `packages/code/package.json` has correct `name`, `version`, `exports`, `files`, `bin` entries
- [ ] Verify `@mohanscodex/spectra-code` resolves and imports correctly in an isolated project (extend `test:import` to include it)
- [ ] Set up changeset release workflow to include the code package
- [ ] Document install + usage instructions for npm consumers

## 2. Custom states from tool calls (generative UI support)

Tool calls should be capable of emitting custom states during execution. This enables generative UI patterns where the tool can surface intermediate progress, status changes, or arbitrary state updates to the caller — useful for showing loading states, progress bars, or dynamic UI transitions.

- [ ] Define a `ToolState` / custom state event type in the SDK types
- [ ] Allow `execute()` to yield/push custom state events alongside the final `ToolResult`
- [ ] Surface these states through the agent event stream so callers can render them reactively
- [ ] Ensure both TypeScript (`packages/agent`) and Rust (`crates/spectra-rs`) support this

## 3. Real-time tool content streaming

Ability to stream a tool's content in real time as it is produced, rather than waiting for the full `ToolResult` before surfacing anything. This builds on the current tool call implementation to support progressive output.

- [ ] Design a streaming tool interface (e.g., `execute` returns an async iterable / stream of chunks)
- [ ] Integrate streaming tool output into the agent event loop so deltas are yielded as they arrive
- [ ] Ensure backward compatibility — non-streaming tools (current `execute` returning `ToolResult`) still work
- [ ] Implement in both TypeScript (`packages/agent`) and Rust (`crates/spectra-rs`)

## 4. Context compaction

Automatic context management that summarizes old conversation history when approaching token limits, preserving recent turns verbatim.

- [ ] Implement overflow detection: trigger when total tokens >= `usable capacity - 20K buffer`
- [ ] Head/tail split: summarize older context, preserve last 2-4 turns verbatim (25% of usable tokens, clamped 2K-8K)
- [ ] Structured summary template (Goal, Constraints, Progress, Key Decisions, Next Steps, Critical Context, Relevant Files)
- [ ] Anchored summaries: incrementally update previous summary instead of rebuilding from scratch
- [ ] Tool output truncation during compaction (2K chars max, media stripped)
- [ ] Async pruning pass: mark old tool outputs as compacted, protect recent 40K, never prune `skill` tool outputs
- [ ] Auto-continue after compaction ("Continue if you have next steps...")
- [ ] Configurable: `compaction.auto` toggle, `compaction.reserved` buffer, `compaction.preserve_recent_tokens`
- [ ] Implement in TypeScript (`packages/agent`) for Spectra Code, with Rust SDK following later

## 5. Agent loop safety guards

Defensive mechanisms in the agent loop to prevent common failure modes. Based on patterns from OwlCoda's conversation engine.

- [ ] Tool loop detection: track consecutive identical tool calls, hard-stop after threshold (e.g., 5 identical calls)
- [ ] Narration loop detection: detect repetitive output patterns (e.g., same sentence repeated 3+ times), interrupt and prompt user
- [ ] Output bloat detection: warn when single tool output exceeds reasonable size (e.g., 50K chars), offer to truncate
- [ ] Task no-progress hard stop: if agent makes N turns with no file writes or meaningful progress, pause and ask for direction
- [ ] Convergence state machine: track whether agent is making forward progress or cycling between states
- [ ] Surface safety events (interrupt, warning, hard-stop) through the agent event stream so TUI can render them

## 6. Expanded slash commands

Broaden the slash command surface to cover observability, session management, git workflows, and configuration — matching capabilities found in OwlCoda (70+ commands).

**Observability:**
- [x] `/cost` — show estimated cost for current session (opens cost dialog with detailed breakdown)
- [x] `/tokens` — show token usage breakdown (input, output, context window %)
- [x] `/stats` — session statistics (model, provider, turns, duration, tok/s, cost)
- [x] `/context` — show context window usage and remaining capacity
- [x] `/status` — system status (model, provider, MCPs, agent, tokens, cost)

**Session:**
- [ ] `/save` — explicitly save current session
- [x] `/search` — search sessions (opens session list dialog)
- [ ] `/export` — export session to JSON/Markdown
- [ ] `/history` — show conversation turn history
- [ ] `/compress` — manually trigger context compaction

**Git:**
- [ ] `/commit` — stage and commit changes with AI-generated message (requires template prompt system)
- [ ] `/review` — review uncommitted changes or current branch (requires template prompt + subagent spawning)

**Config:**
- [x] `/theme` — switch color theme
- [x] `/permissions` — view/edit tool permission settings
- [x] `/settings` — open settings panel

## 7. Plugin system

Dynamic, hook-based plugin system. Plugins extend behavior without modifying core code.

**Plugin loading order (cascading precedence):**
1. Project-level: `.spectra/plugins/` (project root, highest priority)
2. User-level: `~/.spectra/plugins/` (global config)
3. Config-defined: plugins listed in config file

**Hook points:**
- [ ] `onRequest(ctx)` — intercept/modify LLM requests before sending
- [ ] `onResponse(ctx)` — intercept/modify LLM responses after receiving
- [ ] `onToolCall(ctx)` — intercept/modify tool calls before execution
- [ ] `onError(ctx)` — handle errors from any stage
- [ ] `onLoad()` / `onUnload()` — lifecycle hooks for setup/teardown

**Plugin interface:**
```typescript
interface SpectraPlugin {
  metadata: { name: string; version: string; description?: string }
  onLoad?: () => Promise<void> | void
  onUnload?: () => Promise<void> | void
  onRequest?: (ctx: RequestHookContext) => Promise<void> | void
  onResponse?: (ctx: ResponseHookContext) => Promise<void> | void
  onToolCall?: (ctx: ToolCallHookContext) => Promise<void> | void
  onError?: (ctx: ErrorHookContext) => Promise<void> | void
}
```

**Implementation:**
- [ ] Define plugin types and hook contexts in `packages/agent`
- [ ] Plugin loader: scan directories, dynamically import, validate metadata
- [ ] Hook runner: iterate plugins per hook point with try/catch isolation
- [ ] Plugin discovery CLI: `spectra plugin list`, `spectra plugin install`
- [ ] Integrate with existing Extension trait in Rust SDK (parallel implementation)

## 8. Observability middleware

Per-request metrics, cost tracking, and runtime health visibility at the HTTP proxy/transport layer.

- [ ] Per-model cost tracking: token counts × configured pricing, cumulative per session
- [ ] Request latency metrics: time-to-first-token, total duration, p50/p95/p99 aggregates
- [ ] Rate limit headers parsing: extract `X-RateLimit-*` headers from provider responses, surface to UI
- [ ] Circuit breaker state exposure: expose open/half-open/closed state per model via `/status` or event stream
- [ ] Token usage breakdown: input, output, cache read, cache write tokens per request
- [ ] Expose metrics through agent event stream so TUI can render `/cost`, `/tokens`, `/stats` commands

## 9. Session handling overhaul

Spectra's session system is fundamentally weaker than OpenCode's. The current JSON-per-file storage, shallow fork, and missing compaction will not scale.

**Storage:**
- [ ] Migrate from JSON files to SQLite (indexed queries, pagination, cascade deletes)
- [ ] Schema: sessions table, messages table, parts table with foreign keys
- [ ] Indexed columns: project_id, parent_id, time_created, time_updated
- [ ] Cursor-based pagination for session listing

**Fork & Branch:**
- [ ] Deep copy with ID remapping (prevent collisions between forked sessions)
- [ ] Fork from specific message point (not just entire session)
- [ ] Parent-child relationship tracking via parent_id
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

## 10. Skills system

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
- [x] Skill loader: scan directories, parse YAML frontmatter, validate `name` field
- [x] Auto-tag extraction from directory category, name segments, section headers, description keywords
- [x] TF-IDF index with cosine similarity matching (zero-dependency, cached 60s TTL)
- [x] `find_skills` tool: query mode (scored results) + `all: true` fallback (full catalog)
- [x] `skill` tool: load full SKILL.md by name with `$ARGUMENTS` substitution
- [x] String substitutions: `$ARGUMENTS`, `$0`, `${SPECTRA_SKILL_DIR}`
- [x] Bundled skills: ship 65 skills with Spectra Code, resolved via `import.meta.url`
- [x] Three-layer precedence: user-defined (`~/.claude/skills/`) > project (`.claude/skills/`) > bundled
- [x] Skills hint in system prompt: "Use find_skills to discover skills"
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

## 11. Template prompt system

Commands like `/commit` and `/review` need structured prompts that are loaded from files, not hardcoded in JS. This enables maintainable, user-overridable command behavior.

**Design:**
- [ ] Template store: load `.txt` or `.md` files from `packages/code/src/commands/templates/` (bundled) + `.spectra/commands/` (user override)
- [ ] Variable substitution: `${path}` (worktree), `${ARGUMENTS}` (user input), `${diff}` (git diff), etc.
- [ ] Register templates with commands: `commands.ts` loads template text, passes as `template` property
- [ ] User override: if `.spectra/commands/review.txt` exists, use it instead of bundled version

**Templates to create:**
- [ ] `commit.txt` — git commit protocol (run git status/diff/log, analyze staged changes, draft message, commit)
- [ ] `review.txt` — code review template (determine review type, gather context, check bugs/structure/performance)

## 12. Subagent spawning from commands

Commands like `/review` need to spawn a child agent session with restricted tools (read-only for review, full access for commit).

**Design:**
- [ ] `subtask: true` flag on command definition — spawns a child session
- [ ] Child session inherits permission rules from parent (external_directory, deny rules)
- [ ] Tool restrictions: `/review` gets read-only tools (read, glob, grep, bash for git), no write/edit
- [ ] After subtask completes, inject result into parent session as context
- [ ] Child session title: `"${description} (@${agent} subagent)"`

**Commands that need this:**
- [ ] `/review` — spawns read-only subagent with review template
- [ ] `/commit` — can run inline (main agent) or spawn subagent with commit template

## 13. Commit protocol in bash tool

Embed git commit instructions directly in the bash tool's system prompt, so the agent knows the correct commit workflow without needing a dedicated command.

**Design (based on OpenCode's shell.txt):**
- [ ] Embed commit protocol in bash tool description or system prompt
- [ ] Steps: run `git status` + `git diff` + `git log` → analyze staged changes → draft message → `git add` + `git commit`
- [ ] Safety rules: never amend unless HEAD is our commit + not pushed, never force push to main, never skip hooks
- [ ] Secret detection: refuse to commit files likely containing secrets (.env, credentials.json)
- [ ] Style matching: read recent commit messages to match tone/format

### Future (deferred)

The following are deferred until the core system is stable and functional:

- [ ] **Session branching** — deep-copy sessions like git branches, list branches, switch between them. High complexity, low urgency.
