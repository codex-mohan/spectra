# Memory Layer + Skills Fix — Implementation Plan

Reference: hermes-agent's bounded file-based memory (`MEMORY.md` + `USER.md`).
No embeddings, no RAG, no graph, no vector DB. Bounded markdown + a tool + frozen-snapshot injection.

---

## Part A — Fix AGENTS.md Loading (Prerequisite)

The TUI and ACP paths read only `${cwd}/AGENTS.md` inline, ignoring the full walker
`discoverInstructionFiles` (`paths.ts:89`) which checks 4 filenames across parent dirs
and config dirs. A memory layer built on a broken instruction loader inherits its gaps.

### Changes

| File | Lines | Change |
|---|---|---|
| `packages/code/src/tui/hooks/use-agent.ts` | 130-137, 144 | Replace inline `${cwd}/AGENTS.md` read with `loadContext()`; use `context.systemPrompt` in the array-join |
| `packages/code/src/tui/hooks/use-agent.ts` | 326-333, 340 | Same fix (duplicate block B in `createSessionFactory`) |
| `packages/code/src/integrations/acp/server.ts` | 127-136 | Already calls `loadContext()` on line 127 but discards the result — use `context.systemPrompt` instead of the inline read |

### Verification
- Place a test `CLAUDE.md` in a parent dir of a test project → confirm it loads in TUI
- Place `.spectra/instructions/test.md` → confirm it loads
- ACP path: confirm `context.systemPrompt` is used, not the inline read

---

## Part B — Fix Evolving Skills (Quality Gate + Opt-In)

Current state: zero quality filtering. `skill-synth.ts:103` takes raw user input as the
skill name verbatim. Eligibility is 3 tool calls + 6 messages (trivially met). Silent
synthesis after every run (`use-chat-submit.ts:417`). Three junk skills already on disk
with `useCount: 0`, one with a typo (`"imporve"`).

### B.1 — Struggle-detector synthesis gate (`packages/agent/src/skill-synth.ts`)

Replace the quantitative eligibility (`MIN_TOOL_CALLS=3`, `MIN_MESSAGES=6`) with a
**qualitative struggle detector**. A skill is synthesized ONLY when the agent genuinely
struggled with something technical.

**Eligible (ALL must be true):**
- At least 1 **transformative** tool call (`write`, `edit`, `bash`, `shell`, `task`) — read-only sessions never qualify
- Struggle signal — at least ONE of:
  - Error → retry: a tool call failed, then the agent changed approach and retried toward the same goal
  - ≥2 failed attempts toward the same goal (e.g., two edits that didn't match, then a third that did)
  - User correction: user message after an assistant message that redirects or corrects ("no, do it this way", "that's wrong", "actually...")
- Technical topic: the procedure extracted mentions APIs, libraries, methods, commands, config, or non-obvious workflows

**Reject (ANY triggers rejection):**
- Name is the raw first user message (copy of input — a real skill name is a synthesis, not a copy)
- Name <4 words OR starts with interrogative/pleading words: `/^(what|how|why|when|where|who|can you|could you|would you|please|i want|i need)\b/i`
- Procedure is the generic fallback (`"1. Analyze the task requirements\n2. Implement the solution\n3. Verify the result"`)
- Only read-only tools used (`read`, `glob`, `grep` with no transformative tool)
- Session is trivial/conversational (no transformative tool call)

**Dedup:** raise `findSimilarSkill` threshold from 0.3 → 0.7 (`skill-store.ts`).

### B.2 — Configurable user opt-in (`packages/code/src/tui/hooks/use-chat-submit.ts:417-458`)

Read config from `SpectraConfig.skills`:
- `autoSynthesize: false` → skip synthesis entirely (no work done)
- `confirmBeforeSave: true` (default) → prompt in TUI: `"Learned a new skill: [name]. Save? (y/n)"` — never silent
- `confirmBeforeSave: false` → silent save (current behavior, opt-in only)

### B.3 — Cleanup existing junk

On first load after this change, prune evolving skills where `useCount === 0` AND
`origin === 'learned'` AND age > 7 days. Log pruned skill IDs. (One-time migration in
`skill-store.ts` `loadAllEvolvingSkills` path or a dedicated `pruneStaleSkills()` called
at agent init.)

---

## Part C — Hermes-Style File Memory

### C.1 — Storage

Two scopes, both bounded markdown, `§`-delimited entries:

| File | Path | Scope | Char cap |
|---|---|---|---|
| `MEMORY.md` | `{getGlobalDataDir()}/memory/MEMORY.md` | User-global (agent notes) | ~2200 |
| `USER.md` | `{getGlobalDataDir()}/memory/USER.md` | User-global (user profile) | ~1375 |
| `PROJECT.md` | `{cwd}/.spectra/memory/PROJECT.md` | Project-scoped | ~2200 |

**Combining rule:** Global (`MEMORY.md` + `USER.md`) and project (`PROJECT.md`) are BOTH
injected into the system prompt — **merged, not override**. On a conflict on the same
topic, project-scoped takes precedence for that project (more specific wins). Global
still loads for everything else. Same pattern as AGENTS.md.

**Quality mechanisms (from hermes):**
- Atomic writes: temp file + `fs.rename` (never partial state on disk)
- File lock on read-modify-write (`.lock` file, exclusive lock)
- Dedup on add (exact entry match rejected)
- Char cap enforcement: reject writes that exceed cap, return current usage stats
- External drift detection: before mutation, re-read file under lock; if content can't
  round-trip through the parser (external edit detected), refuse + save `.bak.<timestamp>`
- Threat pattern scan on write AND on load (injection/exfiltration patterns) — blocked
  entries replaced with `[BLOCKED: ...]` in the system prompt snapshot but kept on disk
  for user inspection

### C.2 — `memory` tool (`packages/code/src/tools/memory.ts`)

```
name: "memory"
description: "Add, replace, remove, or read persistent memory entries. Memory is
  loaded into context at the start of each session. Use 'memory' target for agent
  notes, 'user' for user profile facts, 'project' for project-specific knowledge."
parameters: {
  target: "memory" | "user" | "project",
  action: "add" | "replace" | "remove" | "read" | "list",
  entry?: string,        // for add/remove
  replacement?: string,  // for replace
}
```

- Enforces char cap, rejects duplicates, atomic+locked writes, drift detection
- SecurityManager-wrapped like other tools (`tools/index.ts:38-161` path-safety for
  `PROJECT.md` writes — must stay within `{cwd}/.spectra/memory/`)
- Registered in `builtinTools` (`tools/index.ts:26-34`)
- Available to `build`, `plan`, `debug` agents; NOT to `explore` (read-only subagent)

### C.3 — Frozen-snapshot injection

Load `MEMORY.md` + `USER.md` + `PROJECT.md` once at agent creation, inject as a segment
in the system-prompt array-join. **Writes persist to disk immediately but do NOT mutate
the live system prompt until next session** (preserves prefix cache — hermes's frozen
snapshot pattern).

**Injection sites** (same 3 as Part A, now using `loadContext()`):

| File | Line | Change |
|---|---|---|
| `packages/code/src/tui/hooks/use-agent.ts` | 144 | Add memory segment to the array-join after `context.systemPrompt` |
| `packages/code/src/tui/hooks/use-agent.ts` | 340 | Same (duplicate block B) |
| `packages/code/src/integrations/acp/server.ts` | 136 | Same |

Format injected:
```
<memory>
## User Profile
<USER.md content>

## Memory
<MEMORY.md content>

## Project Context
<PROJECT.md content>
</memory>
```

### C.4 — Config schema (`packages/code/src/services/config.ts:17-33`)

Add to `SpectraConfig`:
```ts
memory?: {
  enabled?: boolean;        // default true
  projectScope?: boolean;   // default true — load .spectra/memory/PROJECT.md
};
skills?: {
  autoSynthesize?: boolean;     // default true — run synthesis at all
  confirmBeforeSave?: boolean;  // default true — prompt before persisting
};
```

### C.5 — Command palette placement

The palette groups commands via a `cat` field on each `CmdItem` in
`packages/code/src/tui/commands.ts`. Existing groups: `Session`, `Display`, `Provider`,
`Agent`, `Navigation`, `System`, `Observability`, `Git`, `Config`.

**`/memory` — new command:**
- `cat: 'Agent'` — memory is an agent knowledge capability, alongside MCP (agent's tool
  extensions) and background-tasks (agent's async work). The agent reads and writes
  memory; the `/memory` command lets the user view/manage what the agent knows.
- `label: 'Memory'`, `slashName: 'memory'`
- `desc: 'View and manage persistent memory'`
- Placed in the `Agent` group block (after `background-tasks` at `commands.ts:295-313`,
  before the `Navigation` group at `:314`)
- Opens a dialog (`dialogStep: { type: 'memory' }`) to view/add/remove entries, show
  usage vs char cap, list blocked entries
- Add `{ type: 'memory' }` to the `setDialogStep` union type (`commands.ts:31-48`)

**Skill confirmation toggle — extend existing `settings` command:**
- `commands.ts:664-673` has `slashName: 'settings'`, `cat: 'Config'`
- Add a `"Skills"` section to the settings dialog panel exposing:
  - `autoSynthesize` toggle (on/off)
  - `confirmBeforeSave` toggle (on/off)
- No new command — `settings` is already the right home in `Config` alongside
  `theme`/`permissions`

---

## Implementation Order

1. **Part A** — Fix AGENTS.md loading (3 files, prerequisite, smallest blast radius)
2. **Part C.1 + C.2 + C.3** — Memory storage + tool + injection (the core feature)
3. **Part C.4 + C.5** — Config schema + `/memory` command + settings panel section
4. **Part B** — Skills quality gate + opt-in + junk cleanup (fixes the broken system)

Part A is prerequisite because Part C.3 injection touches the same 3 files — fixing
them first means memory injection slots into already-correct prompt assembly.

---

## Files Touched (Summary)

| File | Part |
|---|---|
| `packages/code/src/tui/hooks/use-agent.ts` | A, C.3 |
| `packages/code/src/integrations/acp/server.ts` | A, C.3 |
| `packages/code/src/services/context.ts` | A (already correct, no change needed) |
| `packages/code/src/tools/memory.ts` | C.2 (new file) |
| `packages/code/src/tools/index.ts` | C.2 (register memory tool) |
| `packages/code/src/services/config.ts` | C.4 (add memory + skills config fields) |
| `packages/code/src/tui/commands.ts` | C.5 (`/memory` command + settings panel) |
| `packages/agent/src/skill-synth.ts` | B.1 (struggle detector) |
| `packages/agent/src/skill-store.ts` | B.1 (raise threshold) + B.3 (prune) |
| `packages/code/src/tui/hooks/use-chat-submit.ts` | B.2 (opt-in confirmation) |

## Explicitly Rejected

- Vector RAG / embeddings / semantic retrieval — fragile, probabilistic, infra-heavy
- Knowledge graph / cross-session preference graph — costly to maintain
- Multi-tier cognitive architecture — overengineered
- Automatic background extraction on every `agent_end` — write-error risk too high
- Reusing compaction summaries as memory — they're lossy and session-scoped
