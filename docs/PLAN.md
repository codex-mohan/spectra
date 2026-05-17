# Spectra Documentation Restructuring Plan

> Generated: 2026-05-17 | Status: Phase 0 in progress

---

## Executive Summary

Spectra's current docs are bare-bones code snippets with zero guidance. This plan restructures the entire documentation site following the **Diátaxis framework** (Tutorials → How-to → Concepts → Reference) used by FastAPI, LangChain, Django, and other top-tier projects, plus adds **LLM/coding-agent friendly** layers (`llms.txt`, skills, AGENTS.md).

---

## Current State Problems

1. No language separation — TS and Rust mixed without clear boundaries
2. No "why" explanations — no comparison to LangChain/CrewAI/Vercel AI SDK
3. No troubleshooting — zero guidance when things go wrong
4. No real-world examples — only toy examples (weather, 2+2)
5. No tips/warnings — VitePress callouts (`:::tip`, `:::warning`) not used
6. No environment setup — no mention of API keys, `.env`, prerequisites
7. API reference is bare — just type signatures, no usage examples
8. No LLM-friendly content — no `llms.txt`, no `.md` mirrors, no `robots.txt`

---

## Proposed Directory Structure

```
docs/
├── index.md                          # Landing page (complete rewrite)
├── public/
│   ├── llms.txt                      # Curated LLM navigation index
│   └── robots.txt                    # AI crawler permissions
├── .vitepress/
│   └── config.ts                     # Updated nav + sidebar + llms plugin
│
├── getting-started/                  # NEW: Dedicated onboarding section
│   ├── introduction.md               # What is Spectra, comparison table
│   ├── installation.md               # TS and Rust install guides
│   ├── quickstart.md                 # Build your first agent in 5 minutes
│   └── project-structure.md          # Monorepo layout, SDK independence
│
├── typescript/                       # NEW: TypeScript-specific docs
│   ├── overview.md                   # TS SDK architecture
│   ├── agent.md                      # Expanded from current guide/agent.md
│   ├── tools.md                      # Expanded from current guide/tools.md
│   ├── providers.md                  # Expanded from current guide/providers.md
│   ├── events.md                     # Expanded from current guide/events.md
│   ├── sessions.md                   # Expanded from current guide/sessions.md
│   └── orchestration.md              # Expanded from current guide/orchestration.md
│
├── rust/                             # NEW: Rust-specific docs
│   ├── overview.md                   # Rust SDK architecture
│   ├── getting-started.md            # Installation, Cargo setup, env vars
│   ├── agent.md                      # AgentBuilder, prompt(), event loop
│   ├── tools.md                      # Tool trait impl, ToolRegistry
│   ├── providers.md                  # LlmClient trait, clients
│   ├── events.md                     # StreamEvent, ContentDelta, EventChannel
│   └── extensions.md                 # Extension trait, middleware hooks
│
├── guides/                           # NEW: How-to guides (goal-oriented)
│   ├── adding-a-provider.md          # Custom LLM provider registration
│   ├── tool-design-patterns.md       # Best practices for writing tools
│   ├── error-handling.md             # Retry patterns, fallbacks, error types
│   ├── prompt-engineering.md         # System prompt tips, few-shot examples
│   ├── multi-agent-patterns.md       # Delegation, parallel execution
│   ├── streaming-ui.md               # Rendering streaming text in a UI
│   ├── session-management.md         # Choosing a store, production setup
│   └── deployment.md                 # Docker, serverless, production config
│
├── recipes/                          # NEW: Real-world copy-paste examples
│   ├── weather-agent.md              # Simple tool-using agent
│   ├── web-search-agent.md           # Agent with web search tool
│   ├── rag-agent.md                  # RAG with file reading tool
│   ├── multi-agent-research.md       # Researcher + Writer + Coder delegation
│   ├── chatbot-with-sessions.md      # Persistent chatbot with session store
│   └── rate-limited-api.md           # Production API with rate limiting + SSE
│
├── concepts/                         # NEW: Explanation / conceptual docs
│   ├── agent-loop.md                 # How the agent loop works
│   ├── streaming-architecture.md     # SSE parsing, delta accumulation
│   ├── ts-vs-rust.md                 # Side-by-side comparison
│   ├── tool-dispatch.md              # How tools are resolved, validated, executed
│   └── event-system.md               # Broadcast vs generator patterns
│
├── reference/                        # Renamed from "api" — full API reference
│   ├── typescript/
│   │   ├── agent.md
│   │   ├── define-tool.md
│   │   ├── event-stream.md
│   │   ├── types.md
│   │   ├── session-manager.md
│   │   ├── session-engine.md
│   │   ├── rate-limiter.md
│   │   ├── worker-pool.md
│   │   ├── agent-registry.md
│   │   └── circuit-breaker.md
│   └── rust/
│       ├── agent-builder.md
│       ├── llm-client.md
│       ├── tool.md
│       ├── messages.md
│       ├── events.md
│       ├── extension.md
│       ├── error.md
│       └── model-registry.md
│
├── troubleshooting/                  # NEW: FAQ + debugging
│   ├── common-issues.md              # Symptoms → causes → solutions
│   ├── debugging.md                  # Tracing, log levels, event inspection
│   └── faq.md                        # Frequently asked questions
│
└── contribute/                       # NEW: Contributor docs
    ├── setup.md                      # Dev environment, bun, cargo, tests
    ├── adding-providers.md           # How to add a new LLM provider
    ├── coding-standards.md           # Conventions, lint, pre-commit checklist
    └── architecture-decisions.md     # Why independent SDKs, no FFI
```

**Existing files to migrate/remove:**
- `guide/` → content moved to `getting-started/`, `typescript/`, `guides/`
- `api/` → content moved to `reference/`
- `guide/rust.md` → content moved to `rust/`

---

## VitePress Config Changes

```typescript
import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";

export default defineConfig({
  title: "Spectra",
  description: "Minimal, ultra-fast, multi-language AI agent framework",
  base: "/spectra/",
  lastUpdated: true,
  cleanUrls: true,
  vite: {
    plugins: [
      llmstxt({
        domain: "https://codex-mohan.github.io/spectra",
        generateLLMsTxt: true,
        generateLLMsFullTxt: true,
        generateLLMFriendlyDocsForEachPage: true,
      }),
    ],
  },
  themeConfig: {
    sidebar: {
      "/getting-started/": [
        { text: "Introduction", link: "/getting-started/introduction" },
        { text: "Installation", link: "/getting-started/installation" },
        { text: "Quickstart", link: "/getting-started/quickstart" },
        { text: "Project Structure", link: "/getting-started/project-structure" },
      ],
      "/typescript/": [
        { text: "Overview", link: "/typescript/overview" },
        { text: "Agent", link: "/typescript/agent" },
        { text: "Tools", link: "/typescript/tools" },
        { text: "Providers", link: "/typescript/providers" },
        { text: "Events", link: "/typescript/events" },
        { text: "Sessions", link: "/typescript/sessions" },
        { text: "Orchestration", link: "/typescript/orchestration" },
      ],
      "/rust/": [
        { text: "Overview", link: "/rust/overview" },
        { text: "Getting Started", link: "/rust/getting-started" },
        { text: "Agent", link: "/rust/agent" },
        { text: "Tools", link: "/rust/tools" },
        { text: "Providers", link: "/rust/providers" },
        { text: "Events", link: "/rust/events" },
        { text: "Extensions", link: "/rust/extensions" },
      ],
      "/guides/": [
        { text: "Adding a Provider", link: "/guides/adding-a-provider" },
        { text: "Tool Design Patterns", link: "/guides/tool-design-patterns" },
        { text: "Error Handling", link: "/guides/error-handling" },
        { text: "Prompt Engineering", link: "/guides/prompt-engineering" },
        { text: "Multi-Agent Patterns", link: "/guides/multi-agent-patterns" },
        { text: "Streaming UI", link: "/guides/streaming-ui" },
        { text: "Session Management", link: "/guides/session-management" },
        { text: "Deployment", link: "/guides/deployment" },
      ],
      "/recipes/": [
        { text: "Weather Agent", link: "/recipes/weather-agent" },
        { text: "Web Search Agent", link: "/recipes/web-search-agent" },
        { text: "RAG Agent", link: "/recipes/rag-agent" },
        { text: "Multi-Agent Research", link: "/recipes/multi-agent-research" },
        { text: "Chatbot with Sessions", link: "/recipes/chatbot-with-sessions" },
        { text: "Rate-Limited API", link: "/recipes/rate-limited-api" },
      ],
      "/concepts/": [
        { text: "Agent Loop", link: "/concepts/agent-loop" },
        { text: "Streaming Architecture", link: "/concepts/streaming-architecture" },
        { text: "TypeScript vs Rust", link: "/concepts/ts-vs-rust" },
        { text: "Tool Dispatch", link: "/concepts/tool-dispatch" },
        { text: "Event System", link: "/concepts/event-system" },
      ],
      "/reference/": [
        {
          text: "TypeScript",
          items: [
            { text: "Agent", link: "/reference/typescript/agent" },
            { text: "defineTool", link: "/reference/typescript/define-tool" },
            { text: "EventStream", link: "/reference/typescript/event-stream" },
            { text: "Types", link: "/reference/typescript/types" },
            { text: "SessionManager", link: "/reference/typescript/session-manager" },
            { text: "SessionEngine", link: "/reference/typescript/session-engine" },
            { text: "RateLimiter", link: "/reference/typescript/rate-limiter" },
            { text: "WorkerPool", link: "/reference/typescript/worker-pool" },
            { text: "AgentRegistry", link: "/reference/typescript/agent-registry" },
            { text: "CircuitBreaker", link: "/reference/typescript/circuit-breaker" },
          ],
        },
        {
          text: "Rust",
          items: [
            { text: "AgentBuilder", link: "/reference/rust/agent-builder" },
            { text: "LlmClient", link: "/reference/rust/llm-client" },
            { text: "Tool", link: "/reference/rust/tool" },
            { text: "Messages", link: "/reference/rust/messages" },
            { text: "Events", link: "/reference/rust/events" },
            { text: "Extension", link: "/reference/rust/extension" },
            { text: "Error", link: "/reference/rust/error" },
            { text: "ModelRegistry", link: "/reference/rust/model-registry" },
          ],
        },
      ],
      "/troubleshooting/": [
        { text: "Common Issues", link: "/troubleshooting/common-issues" },
        { text: "Debugging", link: "/troubleshooting/debugging" },
        { text: "FAQ", link: "/troubleshooting/faq" },
      ],
      "/contribute/": [
        { text: "Setup", link: "/contribute/setup" },
        { text: "Adding Providers", link: "/contribute/adding-providers" },
        { text: "Coding Standards", link: "/contribute/coding-standards" },
        { text: "Architecture Decisions", link: "/contribute/architecture-decisions" },
      ],
    },
    nav: [
      { text: "Guide", link: "/getting-started/introduction" },
      { text: "TypeScript", link: "/typescript/overview" },
      { text: "Rust", link: "/rust/overview" },
      { text: "Guides", link: "/guides/adding-a-provider" },
      { text: "Recipes", link: "/recipes/weather-agent" },
      { text: "Reference", link: "/reference/typescript/agent" },
    ],
  },
});
```

---

## Page Content Patterns

### Landing Page (`index.md`)
- Hero: name, tagline, actions
- "Why Spectra?" — comparison table vs LangChain, CrewAI, Vercel AI SDK
- Feature cards with icons
- Code preview — side-by-side TS + Rust snippets
- "Who is this for?" callout
- Quick links to TS docs, Rust docs, Recipes

### Guide Pages (How-to)
Each follows:
1. **Goal statement** — "This guide shows you how to..."
2. **Prerequisites** — what you need
3. **Step-by-step** with explained code
4. `:::tip` / `:::warning` callouts
5. **Full working example**
6. **Next steps** links

### Recipe Pages
Each includes:
1. **What it does** — one-line description
2. **When to use it** — use case
3. **Prerequisites** — API keys, dependencies
4. **Full source code** — copy-paste ready
5. **How it works** — explanation
6. **Customization tips**

### Reference Pages
Each includes:
1. **Purpose** — one-line "what this is"
2. **Signature** — syntax-highlighted code
3. **Parameters table** — name, type, default, description
4. **Usage example** — realistic, not minimal
5. **Related** — links to guides, concepts

---

## LLM / Coding Agent Layer

### 1. vitepress-plugin-llms (Installed ✅)
Auto-generates on every `docs:build`:
- `/llms.txt` — curated index (~2-5KB)
- `/llms-full.txt` — all content in one file (~50-200KB)
- `/guide/getting-started.md` — clean markdown per page

### 2. Manual llms.txt (Created ✅)
`docs/public/llms.txt` — hand-curated with better descriptions than auto-generated. Follows llmstxt.org spec:
- H1 heading
- Blockquote summary
- H2 sections with descriptive links
- `## Optional` section for secondary content

### 3. robots.txt (Created ✅)
`docs/public/robots.txt` — allows AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended)

### 4. AGENTS.md (Enhanced)
Project-root `AGENTS.md` already exists. Enhance with:
- Quick reference for coding agents
- "When a developer asks about Spectra" workflow
- Common patterns (agent creation, tool definition, streaming)
- Environment variable reminders

### 5. SKILL.md for Spectra Development
`.opencode/skills/spectra-dev/SKILL.md` — loaded by coding agents when working on Spectra code:
- Project structure overview
- Build/test commands
- Conventions (no unsafe, independent SDKs, Zod validation)

---

## Implementation Phases

| Phase | Tasks | Files | Status |
|-------|-------|-------|--------|
| **Phase 0** — LLM Readiness | Install plugin, configure, llms.txt, robots.txt, AGENTS.md, skill | 6 files | In progress |
| **Phase 1** — Foundation | Landing page, getting-started (4 pages), config.ts nav update | 6 files | Pending |
| **Phase 2** — TypeScript | 7 pages (overview + 6 SDK pages) | 7 files | Pending |
| **Phase 3** — Rust | 7 pages (overview + 6 SDK pages) | 7 files | Pending |
| **Phase 4** — Concepts | 5 conceptual explanation pages | 5 files | Pending |
| **Phase 5** — Guides | 8 how-to guides | 8 files | Pending |
| **Phase 6** — Recipes | 6 real-world examples | 6 files | Pending |
| **Phase 7** — Reference | 18 API reference pages (10 TS + 8 Rust) | 18 files | Pending |
| **Phase 8** — Support | 3 troubleshooting + 4 contribute pages | 7 files | Pending |

**Total: ~72 files** across 9 phases.

---

## Key Design Decisions

1. **Language separation**: TS and Rust get their own top-level sections (`/typescript/`, `/rust/`) — no mixing
2. **Reference renamed from api**: `reference/` is clearer for developers
3. **Old guide/ and api/ directories**: Content migrated, old dirs removed after migration
4. **VitePress callouts**: Use `:::tip`, `:::warning`, `:::danger` throughout
5. **LLM-only content**: Use `<llms-only>` tags for agent-specific instructions
6. **No auto-generated API reference**: Hand-written for better developer experience (unlike typedoc/rustdoc)
7. **Recipes separate from guides**: Recipes = copy-paste examples, Guides = how-to instructions

---

## Files Already Created (Phase 0)

- [x] `docs/.vitepress/config.ts` — updated with llms plugin
- [x] `docs/public/llms.txt` — curated LLM navigation index
- [ ] `docs/public/robots.txt` — AI crawler permissions
- [ ] `AGENTS.md` — enhanced with coding agent instructions
- [ ] `.opencode/skills/spectra-dev/SKILL.md` — Spectra development skill

---

## Notes for Next Session

- Plugin `vitepress-plugin-llms` v1.12.2 installed in `docs/package.json`
- Domain: `https://codex-mohan.github.io/spectra` (update if custom domain changes)
- Each page should use `:::tip` / `:::warning` callouts where appropriate
- TypeScript examples use `@singularity-ai/spectra-ai` and `@singularity-ai/spectra-agent`
- Rust examples use `spectra-rs` and `spectra-http` crates
- Never mix TS and Rust code on the same page — use language-specific sections
- Old `docs/guide/` and `docs/api/` directories should be deleted after all content is migrated
