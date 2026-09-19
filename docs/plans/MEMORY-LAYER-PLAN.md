# Memory Layer + Skills Fix — Implementation Plan

Reference: hermes-agent's bounded file-based memory (`MEMORY.md` + `USER.md`).
No embeddings, no RAG, no graph, no vector DB. Bounded markdown with explicit tool access.

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

## Part B — Explicit Evolving Skills

Automatic end-of-turn synthesis has been removed. Completing a normal task no longer
launches a hidden model or creates a skill candidate.

The primary agent can call `propose_skill` after a completed task demonstrates a
repeatable, multi-step procedure. The tool requires:

- A stable name, description, and concrete trigger condition
- Instruction-quality Markdown containing steps, verification, and pitfalls
- At least two concrete observations showing that the workflow is reusable
- `action: evolve` plus the exact stored id when improving a learned skill

Every proposal enters the `/skills` pending tab and requires user approval. Proposal
identity is normalized, repeated proposals update the existing pending entry, and
approval/rejection is idempotent. Creates that collide by name or content with bundled,
user, project, or learned skills are rejected. The deprecated `autoSynthesize` and
`confirmBeforeSave` config fields are accepted for compatibility but ignored.

---

## Part C — Hermes-Style File Memory

### C.1 — Storage

Two scopes, both bounded markdown, `§`-delimited entries:

| File | Path | Scope | Char cap |
|---|---|---|---|
| `MEMORY.md` | `{getGlobalDataDir()}/memory/MEMORY.md` | User-global (agent notes) | ~2200 |
| `USER.md` | `{getGlobalDataDir()}/memory/USER.md` | User-global (user profile) | ~1375 |
| `PROJECT.md` | `{cwd}/.spectra/memory/PROJECT.md` | Project-scoped | ~2200 |

**Access rule:** Global (`MEMORY.md` + `USER.md`) and project (`PROJECT.md`) remain
durable stores accessed through the `memory` tool. They are not eagerly copied into
the stable system prompt. This keeps unrelated personal or project facts out of every
request and avoids invalidating the provider's stable prompt prefix after memory writes.

**Quality mechanisms (from hermes):**
- Atomic writes: temp file + `fs.rename` (never partial state on disk)
- File lock on read-modify-write (`.lock` file, exclusive lock)
- Dedup on add (exact entry match rejected)
- Char cap enforcement: reject writes that exceed cap, return current usage stats
- External drift detection: before mutation, re-read file under lock; if content can't
  round-trip through the parser (external edit detected), refuse + save `.bak.<timestamp>`
- Threat pattern scan on write and tool read (injection/exfiltration patterns); blocked
  entries remain on disk for user inspection but are not returned as trusted context

### C.2 — `memory` tool (`packages/code/src/tools/memory.ts`)

```
name: "memory"
description: "Add, replace, remove, or read persistent memory entries on demand. Use
  'memory' for agent notes, 'user' for user profile facts, and 'project' for
  project-specific knowledge."
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

### C.3 — On-demand memory context

Memory files are not injected into the stable system prompt or loaded automatically at
agent creation. Agents use the `memory` tool when the current task requires durable
facts. Writes become visible to subsequent tool reads immediately without mutating the
active request, canonical conversation history, or provider prompt prefix.

Project instructions such as `AGENTS.md` remain stable system context. Agent-mode
instructions use request-only `ContextMessage` values. Memory is intentionally separate
from both layers.

### C.4 — Config schema (`packages/code/src/services/config.ts:17-33`)

Add to `SpectraConfig`:
```ts
memory?: {
  enabled?: boolean;        // default true — expose memory tool access
  projectScope?: boolean;   // default true — allow .spectra/memory/PROJECT.md access
};
skills?: {
  autoSynthesize?: boolean;     // deprecated and ignored
  confirmBeforeSave?: boolean;  // deprecated and ignored
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

**Skill policy — existing `settings` command:**
- `commands.ts:664-673` has `slashName: 'settings'`, `cat: 'Config'`
- The `Skills` section reports that creation uses explicit proposals and review is
  always required. There is no automatic-synthesis or silent-save toggle.

---

## Implementation Order

1. **Part A** — Fix AGENTS.md loading (3 files, prerequisite, smallest blast radius)
2. **Part C.1 + C.2 + C.3** — Memory storage + tool + injection (the core feature)
3. **Part C.4 + C.5** — Config schema + `/memory` command + settings panel section
4. **Part B** — Explicit proposal tool + deduplicated review queue (completed)

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
| `packages/code/src/tools/propose-skill.ts` | B (explicit proposal tool) |
| `packages/code/src/services/pending-skills.ts` | B (identity-based review queue) |
| `packages/code/src/services/skill-store.ts` | B (stable ids and validated persistence) |
| `packages/code/src/tui/ui/skills-dialog.tsx` | B (transactional review actions) |

## Explicitly Rejected

- Vector RAG / embeddings / semantic retrieval — fragile, probabilistic, infra-heavy
- Knowledge graph / cross-session preference graph — costly to maintain
- Multi-tier cognitive architecture — overengineered
- Automatic background extraction on every `agent_end` — write-error risk too high
- Reusing compaction summaries as memory — they're lossy and session-scoped
