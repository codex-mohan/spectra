# Skills

> Skills are `SKILL.md` procedure packages discovered from Spectra, Claude, and Agents directories, exposed to the model through `find_skills`/`skill`, and extended at runtime by user-approved evolving skills under `~/.spectra/skills`.

## Source

- Format and discovery: `packages/agent/src/skill.ts` — `SkillMetadata` (line 4), `readSkillFile` (line 45), `parseSkillFrontmatter` (line 102), tag extraction (line 164), TF-IDF index (`buildIndex` line 270, `matchSkills` line 308), `discoverSkills` (line 363), catalog formatting (lines 426-445), `substituteVariables` (line 447), `loadSkillContent` (line 459).
- Tools: `packages/agent/src/tool/skill.ts` — `createSkillTool` (line 5), `createFindSkillsTool` (line 53).
- Catalog merge: `packages/code/src/services/skill-catalog.ts` — `loadAllSkills` (line 12), `invalidateSkillCatalog` (line 31).
- Evolving store: `packages/code/src/services/skill-store.ts` — `isValidSkillId` (line 43), `normalizeSkillId` (line 47), `getEvolvingSkillId` (line 59), `saveEvolvingSkill` (line 79), `loadEvolvingSkill` (line 90), `loadAllEvolvingSkills` (line 107), `incrementUseCount` (line 136), `evolveSkill` (line 145), `forkSkill` (line 163).
- Proposals: `packages/code/src/services/pending-skills.ts` (in-memory queue), `packages/code/src/tools/propose-skill.ts` (`propose_skill`, line 25).
- UI: `packages/code/src/tui/ui/skills-dialog.tsx`; entry command `packages/code/src/tui/commands.ts:826-859`.
- Tool registration: `packages/code/src/tools/index.ts` — `proposeSkillTool` in `createBuiltinTools` (line 47), `discoverAndCreateSkillTools` (line 316).

## Registration / gating

- `propose_skill` is a builtin tool for every agent, and is exempt from permission checks (`tools/index.ts:62`, `SKIP_PERMISSION_CHECK`).
- `find_skills` and `skill` are added only when the merged catalog is non-empty (`tools/index.ts:323-337`); `use-agent.ts:130-136` calls `discoverAndCreateSkillTools` and swallows discovery failures.
- Agents can deny tools: `debug`, `explore`, `plan`, and the hidden `title` agent list `propose_skill` in `disallowedTools` (`packages/code/src/agents/definitions/`).
- When skills exist, a one-sentence hint is appended to the system prompt telling the model to use `find_skills` then `skill` (`use-agent.ts:151-154`, `490-493`). The catalog itself is not injected; `buildAvailableSkillsBlock` is exported but unused by the app.
- Permission profile: none. `skill` and `find_skills` are appended as raw `AgentTool`s after the security-wrapped builtins (`use-agent.ts:138`), so they never reach the permission wrapper; `propose_skill` is explicitly exempt.

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `SKILL.md` frontmatter `name` | `string` | yes | Catalog key; a skill without a name is ignored. |
| `description` / `when_to_use` | `string` | no | Joined for catalog and match text. |
| `allowed-tools` / `disallowed-tools` | space-separated list | no | Parsed into metadata only; not enforced by the skill tools. |
| `model`, `effort`, `context`, `version` | `string` | no | Parsed into metadata only; not carried into stored evolving metadata. |
| `skill` tool `name` | `string` | yes | Must match a catalog name exactly. |
| `skill` tool `args` | `string` | no | Replaces `$ARGUMENTS` and `$0` in the body. |
| `find_skills` `query` | `string` | no | TF-IDF query; `all: true` lists everything. |
| `propose_skill` `action` | `'create' \| 'evolve'` | yes | Evolve requires `existingSkillId`. |
| `propose_skill` `name` / `description` / `whenToUse` | `string` | yes | 3-80, 12-240, 12-400 characters. |
| `propose_skill` `content` | `string` | yes | At least 120 characters of Markdown. |
| `propose_skill` `evidence` | `string[]` | yes | 2-5 observations, 8-300 characters each. |

## Outputs

- `skill` returns `<skill_content name="…">` with frontmatter stripped, variables substituted, a `file://` base directory, and a `<skill_files>` list.
- `find_skills` returns `<skill_catalog count="…">`, `<skill_matches query="…" count="…">`, or a "no matches" message followed by the full catalog.
- `propose_skill` returns text only: `Added pending …` / `Updated pending …` / `The same proposal is already pending: …`, or an error result.
- Approving a proposal writes `<home>/skills/<id>/metadata.json` and `<home>/skills/<id>/SKILL.md`.
- Loading an evolving skill increments `useCount` and `updatedAt` in its `metadata.json` (`tools/index.ts:324-336`).

## Flow

1. `loadAllSkills` merges three sources in order: bundled `<package>/skills`, evolving `~/.spectra/skills`, then `discoverSkills()` for user/project directories; later entries overwrite earlier ones by `name` (`skill-catalog.ts:16-27`).
2. `discoverSkills` scans `~/.claude/skills`, `~/.agents/skills`, `~/.spectra/skills`, then project `.claude/skills`, `.agents/skills`, `.spectra/skills`, then any `customPaths`; project entries therefore win over user entries (`skill.ts:363-392`).
3. A directory without `SKILL.md` is treated as a category and its immediate subdirectories are scanned once (`skill.ts:402-412`).
4. Frontmatter is parsed line-by-line between `---` fences; matching single or double quotes are stripped (`skill.ts:102-140`).
5. Tags are derived from the directory category, name segments, heading words, description, and `whenToUse`, capped at 30 (`skill.ts:164-199`).
6. `find_skills` builds a TF-IDF index once per tool instance and returns the top 10 matches at a 0.03 cosine threshold (`tool/skill.ts:53-131`).
7. `skill` loads the body, removes frontmatter, substitutes `$ARGUMENTS`, `$0`, and `${SPECTRA_SKILL_DIR}`, and reports the base directory plus relative files (`skill.ts:447-472`).
8. `propose_skill` normalizes the name into an id, rejects unknown evolve targets, identity collisions with any catalog skill, duplicate canonical content in the catalog, and duplicate content already pending (`propose-skill.ts:37-80`).
9. Valid proposals enter the in-memory queue keyed by id (create) or `existingSkillId` (evolve), replacing an existing entry while preserving `createdAt` (`pending-skills.ts:17-37`).
10. `/skills` opens the dialog on the pending tab (`/skills browse` opens All); `a`/`y` approves, `r`/`d` rejects (`commands.ts:855-858`, `skills-dialog.tsx:60-100`).
11. Approving a create checks the id is unused, writes version 1 metadata with `origin: 'learned'`, then removes the proposal; approving an evolve calls `evolveSkill`, which bumps `version` and sets `origin: 'evolved'` (`skills-dialog.tsx:65-84`, `skill-store.ts:145-161`).
12. Every mutation calls `invalidateSkillCatalog()` and reloads both tabs (`skills-dialog.tsx:32-39`).

## State / persistence

- Evolving skills live at `$SPECTRA_HOME/skills/<id>` (default `~/.spectra/skills`), each with `metadata.json` and `SKILL.md` (`skill-store.ts:23-41`).
- Metadata fields: `id`, `name`, `description`, `whenToUse`, `tags`, `useCount`, `version`, `parentId`, `createdAt`, `updatedAt`, `origin`.
- Valid ids match `^[a-z0-9][a-z0-9-]{1,79}$`; `normalizeSkillId` lowercases, replaces separators with `-`, collapses repeats, trims dashes, and truncates to 80 characters.
- The merged catalog is cached process-wide until `invalidateSkillCatalog()`; the TF-IDF index has its own 60-second cache in `getSkillIndex` (`skill.ts:337-360`).
- Pending proposals are held only in a module-level `Map` (`pending-skills.ts:15`); nothing is written until approval.

## Security

- Skill discovery only reads directories under the home directory, project ancestors, and the bundled package path; `getEvolvingSkillId` additionally requires the skill directory's parent to equal the evolving skills dir (`skill-store.ts:59-70`).
- `saveEvolvingSkill` rejects ids failing the regex before touching the filesystem, so a proposal cannot escape the skills directory (`skill-store.ts:80`).
- Approved content is written verbatim as Markdown; skills are instructions, not executable code.
- `propose_skill` declares `reads: false, writes: false`; approval is the only write path.
- Skill bodies and file lists are returned to the model, so a skill can reference arbitrary relative paths inside its own directory.

## Errors

| Condition | Result |
| --- | --- |
| `skill` name not in catalog | `Skill "<name>" not found. Available skills: …`, `isError: true` |
| `find_skills` with no query and no `all` | Instruction to pass a query or `all: true` |
| `find_skills` with no matches | "No skills matched …" plus the full catalog |
| Proposal name normalizes to fewer than two characters | `The skill name does not produce a valid stable id.` |
| `action: evolve` without `existingSkillId` | `existingSkillId is required when action is evolve.` |
| Evolve target not a stored evolving skill | `Cannot evolve unknown learned skill: <id>` |
| Create collides with a saved skill | `A skill with this identity already exists…` or `A learned skill with this identity already exists… Propose an evolve action instead.` |
| Identical procedure already saved | `This procedure is already saved as <name>.` |
| Identical procedure already pending | `The same procedure is already pending as <name>.` |
| Fewer than two evidence items | Zod validation failure (`Invalid arguments`) |
| Approve an id that already exists on disk | `Skill already exists: <id>` toast |
| Invalid id passed to the store | `Invalid skill id: <id>` |

## Limitations

- `allowed-tools`, `disallowed-tools`, `model`, `effort`, and `context` are parsed but never applied when a skill is loaded; only agent definitions filter tools.
- Pending proposals do not survive a process restart, and there is no persistent review queue.
- Skill approval always writes to the user-level evolving directory; a project-scoped learned skill cannot be created from the dialog.
- `loadAllSkills` is cached for the process, and `find_skills` indexes once per tool instance, so external skill edits stay invisible until a mutation or restart invalidates the catalog.
- `substituteVariables` replaces `${SPECTRA_SKILL_DIR}` twice with the same value and does not support `$SPECTRA_SKILL_DIR`.
- `loadSkillContent` strips frontmatter only when the fence uses LF endings; CRLF files keep the frontmatter in the loaded body.
- Duplicate detection compares lowercased, whitespace-collapsed content, so cosmetic edits defeat it.
- `forkSkill` is exported but no UI or tool calls it.

## Tests

- `packages/agent/src/__tests__/skill.test.ts` — frontmatter parsing for LF/CRLF/mixed endings, quote stripping, missing frontmatter, nested category discovery, project `.spectra` precedence over compatible directories, and tag extraction.
- `packages/code/src/__tests__/skill-store.test.ts` — save/load round-trip, `useCount` increments by stored id, loading all evolving skills with ids, evolve preserving `useCount`, id normalization, invalid-id rejection before filesystem access, and missing-skill lookup.
- `packages/code/src/__tests__/pending-skills.test.ts` — upsert by stable identity with `createdAt` preservation, evolve deduplication by stored id, idempotent approval and rejection.
- `packages/code/src/__tests__/propose-skill.test.ts` — evidence minimums, added-then-updated proposals, and create collisions with a saved skill.
- No test covers the skills dialog, `find_skills` ranking, or `skill` variable substitution.

## Related

- `docs/features/tool-registry.md` — builtin tool assembly and permission exemption list.
- `docs/features/agent-loop.md` — system prompt assembly and tool exposure.
- `docs/features/memory-tool.md` — the other cross-session persistence surface.
- `docs/features/commands-templates.md` — `/skills` palette entry and arg completion.
- `docs/features/config.md` — deprecated `skills.autoSynthesize` and `skills.confirmBeforeSave` keys.
