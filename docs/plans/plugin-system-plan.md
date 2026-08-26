# Spectra Plugin System — Architecture and Implementation Plan

## Status

Proposed architecture for the Spectra coding harness. This document defines the TypeScript implementation first. Rust will receive an independent native design after the TypeScript contracts and lifecycle semantics are proven.

The design takes the strongest ideas from DeepSeek Harness and its Cordis runtime—dependency-driven activation, owned effects, scoped capabilities, reversible composition, and interceptable pipelines—without copying its implementation or turning Spectra into a collection of tightly coupled micro-packages.

## Objective

Build one plugin substrate that can extend Spectra without editing central composition files.

A plugin must be able to:

- provide and consume typed services;
- register tools, commands, prompt sections, message handlers, session behavior, and UI contributions;
- intercept agent, provider, command, message, and tool pipelines;
- scope contributions to the process, project, session, or agent;
- unload cleanly, including asynchronous resources;
- remain pending while required dependencies are unavailable;
- reactivate when required dependencies return;
- expose ownership and diagnostics for inspection;
- pass all privileged operations through Spectra's existing security and permission systems.

The plugin system is a construction kit. It must provide composition primitives rather than prescribe a single agent architecture.

## Why the Existing Shape Is Insufficient

Spectra already has extension points, but they are independent mechanisms:

- `packages/agent/src/agent.ts` owns a private tool map and fixed hook fields.
- `packages/code/src/tui/hooks/use-agent.ts` manually assembles tools, providers, compaction, context, security, and agent definitions.
- `packages/code/src/tools/index.ts` hardcodes built-in tools and applies security wrappers during array construction.
- MCP connections use a process-global connection map.
- custom tool loading can add tools but cannot contribute commands, prompts, policies, UI, or lifecycle behavior.
- `packages/code/src/tui/app.tsx` imports and renders feature UI directly.
- agent definitions are data records rather than scoped compositions.

These mechanisms work individually, but they do not share ownership, dependency resolution, ordering, diagnostics, or disposal. Adding another extension type currently creates another registry and another lifecycle.

## Lessons Adopted from DeepSeek Harness

### Capability ownership

Every registration belongs to the plugin instance that created it. Unloading the plugin removes its tools, hooks, services, listeners, and UI contributions together.

### Dependency-driven activation

A plugin declares hard service dependencies. It activates only when they are available. If a required provider disappears, dependants deactivate before the provider is removed. When the service returns, eligible dependants reactivate.

Load order must not be used as a substitute for dependency resolution.

### Reversible effects

All side effects are registered through an owner. Setup failure rolls back effects already collected. Disposal is single-shot, reverse ordered, and awaits asynchronous cleanup.

### Provider/consumer separation

Stable capability interfaces are independent from concrete implementations. A filesystem tool consumes a filesystem service; it does not construct or import the local filesystem provider.

### Interceptable pipelines

Policy belongs in ordered middleware or waterfall pipelines, not wrappers copied around every implementation. Tool permissions, retries, context transforms, auditing, and result transforms should compose through explicit stages.

### Scoped composition

Process-wide defaults may be shadowed by project, session, or agent-scoped registrations. Child scopes inherit from parents and dispose with their owning session or agent.

### Runtime inspection

The runtime should explain:

- which plugins are discovered, pending, active, failed, or disposed;
- which services each plugin provides and requires;
- who owns each tool, command, hook, and UI contribution;
- why a plugin is pending or failed;
- which cleanup is still in progress.

## Explicit Non-Goals

The first implementation will not include:

- model-written runtime plugins;
- a general JavaScript sandbox;
- arbitrary remote plugin installation;
- hot replacement of core application code;
- browser/host dual runtimes;
- generated reflection catalogs;
- automatic TypeScript-to-Rust plugin bridging;
- deep-merging arbitrary plugin configuration;
- a requirement to split every plugin into a separate npm package.

Dynamic model-authored code is particularly deferred. DeepSeek Harness treats that capability as equivalent to shell access, not as a security boundary. Spectra should not expose it until plugin ownership, capability validation, inspection, approval, and cleanup have been proven.

## Architectural Boundaries

### Runtime kernel

Create framework-neutral lifecycle primitives under:

```text
packages/code/src/runtime/
  context.ts
  errors.ts
  events.ts
  plugin.ts
  registry.ts
  scope.ts
  service-key.ts
  types.ts
```

The runtime kernel must not import React, OpenTUI, provider SDKs, concrete tools, the session store, or filesystem discovery code.

### Plugin host

Create discovery, manifests, capability policy, configuration, diagnostics, and application integration under:

```text
packages/code/src/plugins/
  capabilities.ts
  diagnostics.ts
  discovery.ts
  host.ts
  loader.ts
  manifest.ts
  ordering.ts
  types.ts
```

### Domain services

Domain-specific registries remain outside the kernel:

```text
packages/code/src/services/
  tool-registry.ts
  command-registry.ts
  prompt-registry.ts
  interaction-service.ts
  ui-slot-registry.ts
```

The kernel owns lifecycle and routing. Domain services own business contracts.

## Core Contracts

### Service keys

Use typed service keys rather than unrestricted string property access.

```typescript
export interface ServiceKey<T> {
  readonly id: string;
  readonly description?: string;
}

export function defineService<T>(id: string, description?: string): ServiceKey<T>;
```

Requirements:

- IDs are globally stable strings such as `spectra.tools`.
- Type identity is compile-time only; runtime identity is the stable ID.
- duplicate providers at the same scope fail unless the service explicitly supports multiple providers;
- child scopes may shadow parent providers;
- service values are not cloned or serialized by the runtime.

### Plugin definition

```typescript
export interface SpectraPlugin<TConfig = unknown> {
  readonly manifest: PluginManifest<TConfig>;
  setup(context: PluginContext, config: TConfig):
    | void
    | Disposable
    | Promise<void | Disposable>;
}

export interface PluginManifest<TConfig = unknown> {
  readonly id: string;
  readonly version?: string;
  readonly description?: string;
  readonly requires?: readonly ServiceKey<unknown>[];
  readonly optional?: readonly ServiceKey<unknown>[];
  readonly provides?: readonly ServiceKey<unknown>[];
  readonly capabilities?: readonly PluginCapability[];
  readonly configSchema?: ZodType<TConfig>;
}
```

Plugins may also be declared with a `definePlugin()` helper. The runtime stores the normalized object shape only.

### Plugin context

```typescript
export interface PluginContext {
  readonly pluginId: string;
  readonly scope: RuntimeScope;
  readonly signal: AbortSignal;

  get<T>(key: ServiceKey<T>): T | undefined;
  require<T>(key: ServiceKey<T>): T;
  provide<T>(key: ServiceKey<T>, value: T): Disposable;

  effect(setup: EffectSetup, label?: string): Disposable;
  on<E extends RuntimeEventName>(event: E, handler: RuntimeEventHandler<E>): Disposable;
  intercept<E extends WaterfallEventName>(event: E, handler: WaterfallHandler<E>, options?: InterceptorOptions): Disposable;
  mount<TConfig>(plugin: SpectraPlugin<TConfig>, config: TConfig): Promise<PluginHandle>;
}
```

`PluginContext` exposes only lifecycle-safe primitives and stable domain services. It does not expose loader internals or mutable registry maps.

### Disposal

```typescript
export interface Disposable {
  dispose(): void | Promise<void>;
}
```

Requirements:

- disposal is idempotent;
- setup effects dispose in reverse registration order;
- child plugins dispose before their parent;
- dependants deactivate before required providers;
- asynchronous disposal is awaited;
- one cleanup failure does not prevent remaining cleanup;
- all failures are recorded in plugin diagnostics;
- new effects cannot be registered after unloading begins.

## Lifecycle State Machine

```text
registered
    |
    v
 pending <--------------------+
    | required services ready |
    v                         |
 loading                      |
    | setup succeeds          |
    v                         |
 active                       |
    | dependency removed -----+
    | unload requested
    v
 unloading
    |
    +---- cleanup succeeds ---> disposed
    |
    +---- cleanup fails ------> disposed-with-errors

loading -- setup fails --> failed
failed -- retry/reload --> pending
```

State transitions must be serialized per plugin instance. Concurrent `activate()`, `reload()`, and `dispose()` calls join the same in-flight transition rather than starting duplicate work.

### Setup rollback

If setup fails after registering effects:

1. abort the plugin signal;
2. prevent further registration;
3. dispose collected effects in reverse order;
4. await all asynchronous cleanup;
5. remove unpublished services and domain contributions;
6. record the original setup error and any cleanup errors;
7. transition to `failed`.

The original setup error remains authoritative.

### Dependency loss

When a provider is removed:

1. identify active dependants in the same or descendant scopes;
2. deactivate dependants in reverse dependency order;
3. dispose the provider;
4. mark dependants pending;
5. reactivate them only after a compatible provider is visible again.

A plugin must never observe a required service disappearing while it remains active.

## Scopes

Use a hierarchy:

```text
process
  └─ project
      └─ session
          └─ agent
              └─ child-agent
```

Each scope contains registrations owned at that level and resolves services from nearest to farthest ancestor.

### Scope rules

- Process scope owns built-in infrastructure and long-lived shared providers.
- Project scope owns configuration discovered from the current repository.
- Session scope owns session-specific tools, commands, prompt contributions, and interactions.
- Agent scope owns agent-definition overlays and tool restrictions.
- Child-agent scope inherits parent policy but may narrow capabilities.
- Disposing a scope disposes its children and every owned plugin.
- A child may shadow a service but cannot mutate the parent's registration.
- Security policy may only narrow across descendants unless an explicit user approval grants more capability.

## Event and Waterfall Semantics

Two dispatch modes are required.

### Observation events

Observation events notify listeners without changing the source operation.

Examples:

- `plugin.loaded`
- `plugin.unloaded`
- `message.appended`
- `session.created`
- `session.loaded`
- `tool.completed`
- `agent.ended`

Listeners are isolated. One failure is diagnosed but does not stop peers. Critical invariant failures are represented by explicit internal errors, not ordinary plugin listeners.

### Waterfall events

Waterfalls carry a mutable decision through ordered interceptors.

Examples:

- `input.beforeSubmit`
- `message.beforeAppend`
- `message.beforeProvider`
- `agent.beforeStart`
- `provider.beforeRequest`
- `tool.beforeExecute`
- `tool.execute`
- `tool.afterExecute`
- `command.before`
- `command.after`
- `message.compact`

Each interceptor returns either:

- no decision, meaning continue unchanged;
- a replacement value;
- an explicit stop/deny decision;
- a structured error.

Ordering must be deterministic:

1. scope depth, nearest scope first for policy interception;
2. explicit numeric priority;
3. plugin discovery precedence;
4. plugin ID as the final stable tie-breaker.

No ordering may depend on object enumeration or asynchronous completion timing.

### Timeouts

Timeouts are policy, not kernel defaults for every effect.

The hook runner supports configured bounds for untrusted or third-party hooks. Core lifecycle cleanup is awaited rather than abandoned at a timeout. A timed-out hook receives an aborted signal and produces a diagnostic.

## Domain Service Contracts

### Tool registry

The tool registry becomes a service consumed by agents.

```typescript
interface ToolRegistry {
  register(tool: AgentTool, metadata: ContributionMetadata): Disposable;
  resolve(name: string, scope: RuntimeScope): AgentTool | undefined;
  list(scope: RuntimeScope): readonly RegisteredTool[];
}
```

Migration effects:

- built-in tools register through a built-in tool plugin;
- MCP registers discovered tools through the same service;
- custom tool modules become plugins or tool-only adapters;
- agent creation queries the visible registry rather than receiving a manually assembled array;
- security moves into `tool.beforeExecute` and `tool.afterExecute` interceptors;
- collisions retain all provenance and resolve by explicit precedence, never silent overwrite.

### Command registry

Commands use the unified command contract described in `TODO.md`.

Plugin commands return `CommandEffect[]`; they do not mutate TUI state directly. A centralized effect runner applies prompt submission, dialog, draft, toast, subagent, and script effects through normal security and persistence paths.

### Prompt registry

```typescript
interface PromptRegistry {
  section(section: PromptSection): Disposable;
  assemble(context: PromptAssemblyContext): Promise<AssembledPrompt>;
}
```

Prompt sections have stable names, numeric order, scope, provenance, and optional dynamic content. Assembly snapshots contributions at the start of a provider request so mid-request registration cannot change an in-flight prompt.

### Message pipeline

Required stages:

```text
input.beforeSubmit
→ message.beforeAppend
→ persistence
→ message.afterAppend
→ message.beforeProvider
→ provider serialization
→ message.afterProvider
→ rendering
```

Invariants:

- persistent transformations occur only before append;
- provider-context transformations never mutate stored history;
- observation hooks cannot rewrite messages;
- every message has a stable ID before plugin hooks run;
- hook context includes session, parent session, agent, command/plugin provenance, attachments, metadata, and abort signal;
- custom message/content types require a registered serializer, compaction policy, and renderer or a safe fallback representation.

### Interaction service

Human interactions such as `ask` and permissions should use a shared service rather than direct TUI callbacks.

```typescript
interface InteractionService {
  request<TInput, TResult>(request: InteractionRequest<TInput, TResult>): Promise<TResult>;
}
```

The TUI provides the interactive implementation. Headless mode provides a deterministic non-interactive implementation. Session disposal aborts unresolved requests.

### UI slots

UI composition is a later phase, after the host lifecycle is stable.

Initial slots:

- prompt overlay;
- input adornment;
- message content renderer;
- tool presentation;
- session header;
- status/footer item;
- dialog body.

```typescript
interface UiSlotRegistry {
  declare(slot: UiSlotDefinition): Disposable;
  register(slotId: string, contribution: UiContribution): Disposable;
  resolve(slotId: string, scope: RuntimeScope): readonly UiContribution[];
}
```

Slot declarations define cardinality, scope, props, replacement policy, and fallback behavior. Plugin UI receives props and services; it must not import or mutate `app.tsx` state directly.

## Plugin Discovery and Configuration

### Precedence

Use this order from highest to lowest:

1. project directory: `.spectra/plugins/`;
2. user config directory: `plugins/`;
3. explicit config entries;
4. installed package plugins;
5. built-in plugins.

Precedence decides collision resolution, not lifecycle activation. Required services still control activation.

### Manifest sources

Local plugins export a `SpectraPlugin`. Package plugins expose a documented package export such as `./spectra-plugin`.

Configuration example:

```json
{
  "plugins": [
    {
      "id": "company-policy",
      "package": "@example/spectra-policy",
      "enabled": true,
      "config": {
        "allowedHosts": ["api.example.com"]
      }
    }
  ]
}
```

Rules:

- configuration targets a stable plugin ID;
- one layer replaces the targeted plugin configuration as a whole;
- plugin config is validated before activation;
- unknown fields are reported according to the plugin schema;
- secrets are references to the credential store, never inline values passed through discovery metadata;
- disabled plugins remain inspectable but do not activate.

### Discovery safety

Discovery reads manifests before executing plugin modules where the package format permits it. Activation requires capability validation.

Initial local project plugins are trusted project code, comparable to project scripts. They are not sandboxed. Spectra must state this plainly and show source provenance before enabling newly discovered plugins.

## Capability Model

```typescript
type PluginCapability =
  | 'tools.register'
  | 'commands.register'
  | 'prompts.register'
  | 'messages.observe'
  | 'messages.mutate'
  | 'providers.observe'
  | 'providers.mutate'
  | 'sessions.observe'
  | 'storage.plugin'
  | 'ui.register'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'network'
  | 'process.execute';
```

Rules:

- registration APIs verify declared capabilities;
- filesystem, network, process, message mutation, provider mutation, and custom UI require explicit capabilities;
- declaring a capability does not bypass runtime permissions;
- script and shell work routes through the same permission and telemetry pipeline as model tool calls;
- child scopes inherit denial and may not widen policy silently;
- diagnostics include plugin ID, source, capability, hook, and operation.

## Diagnostics and Inspection

Add commands only after the host API exists:

```text
spectra plugin list
spectra plugin inspect <id>
spectra plugin doctor [id]
spectra plugin reload <id>
```

`list` reports source, version, scope, state, and missing dependencies.

`inspect` reports manifest, configuration source, capabilities, provided/required services, contributions, active effects, and recent diagnostics.

`doctor` validates discovery, manifests, configuration, collisions, dependency cycles, and unavailable services without activating failed plugins.

`reload` disposes the current instance fully, reloads its module, validates it, and activates a new instance. If disposal fails, replacement activation does not proceed automatically.

## Integration with the Agent SDK

The TypeScript SDK remains independently useful without the coding harness plugin host.

The first integration uses adapters:

- the harness resolves visible tools and supplies them to `Agent`;
- existing `AgentConfig` hooks delegate into runtime waterfalls;
- `Agent` does not import `packages/code`;
- the runtime does not expose private `Agent` fields;
- later SDK changes may introduce stable registry interfaces only when they are useful outside the harness.

This keeps `@mohanscodex/spectra-agent` small and prevents the application plugin system from becoming a mandatory SDK runtime.

## Rust Parity

Rust will implement equivalent semantics natively:

- trait-based plugins and service providers;
- typed service keys or explicit trait-object registries;
- owned extension handles;
- async disposal;
- deterministic event/interceptor ordering;
- agent/session scopes;
- no TypeScript runtime, bindings, FFI, or shared plugin binaries.

Parity means matching lifecycle guarantees and observable behavior, not sharing implementation.

## Migration Plan

### Phase 1 — Runtime kernel

**Target files**

- new `packages/code/src/runtime/*`
- new focused tests under `packages/code/src/__tests__/runtime/`

**Work**

1. Implement typed service keys and hierarchical scopes.
2. Implement plugin registration and lifecycle states.
3. Implement owned effects and reverse-order async disposal.
4. Implement setup rollback.
5. Implement dependency waiting, loss deactivation, and reactivation.
6. Implement observation events and waterfall interceptors.
7. Implement deterministic ordering and cycle diagnostics.
8. Expose read-only runtime inspection snapshots.

**Acceptance**

- a plugin activates only after all hard dependencies exist;
- removing a provider disposes dependants before the provider;
- restoring the provider reactivates dependants once;
- setup failure leaves no effects or services registered;
- concurrent lifecycle calls do not duplicate setup or cleanup;
- child scope disposal reaches quiescence before parent disposal completes.

### Phase 2 — Plugin host and built-in composition

**Target files**

- new `packages/code/src/plugins/*`
- `packages/code/src/cli.ts`
- `packages/code/src/services/config.ts`

**Work**

1. Define manifests, capability declarations, config validation, and diagnostics.
2. Register existing process-level infrastructure as built-in plugins.
3. Add explicit-config package loading.
4. Add project and user discovery.
5. Add list, inspect, and doctor commands.
6. Add reload only after disposal diagnostics are reliable.

**Acceptance**

- built-ins and external plugins use the same lifecycle;
- invalid configuration prevents activation with source-specific diagnostics;
- disabled plugins are visible but inactive;
- discovery precedence is deterministic;
- a failed third-party plugin does not prevent unrelated built-ins from starting.

### Phase 3 — Tool pipeline migration

**Target files**

- `packages/code/src/tools/index.ts`
- `packages/code/src/tui/hooks/use-agent.ts`
- `packages/code/src/security/index.ts`
- MCP and custom-tool integrations

**Work**

1. Introduce the tool registry service.
2. Register built-in tools through a built-in plugin.
3. Adapt custom tools and MCP tools into lifecycle-owned registrations.
4. Move permission checks, read tracking, doom-loop checks, and result handling into tool pipeline interceptors.
5. Resolve the visible tool snapshot when constructing or reconfiguring an agent.
6. Preserve existing Zod validation and tool execution events.

**Acceptance**

- removing a plugin immediately removes its tools from future turns;
- an in-flight turn uses a stable tool snapshot;
- tool collisions retain provenance and deterministic resolution;
- all tool origins pass through identical security checks;
- existing tool tests pass without alternate execution paths.

### Phase 4 — Prompt, message, provider, and interaction pipelines

**Target files**

- `packages/code/src/services/context.ts`
- `packages/code/src/services/compaction.ts`
- `packages/code/src/services/session-manager.ts`
- `packages/code/src/tui/hooks/use-chat-submit.ts`
- `packages/code/src/tui/hooks/use-agent.ts`
- ask and permission interaction paths

**Work**

1. Introduce prompt and interaction services.
2. Route ask and permission requests through the interaction service.
3. Add persistent message hooks around storage.
4. Add transient provider-context hooks before serialization.
5. Adapt compaction to the message compaction waterfall.
6. Adapt provider request/response hooks without exposing credentials by default.

**Acceptance**

- persistent and transient message transforms are observably separate;
- plugin failures cannot corrupt stored message order;
- unresolved interactions abort when their session scope disposes;
- provider hooks cannot access secrets without capability approval;
- compaction preserves custom blocks according to registered policies.

### Phase 5 — Commands and agent-scoped composition

**Target files**

- command-domain modules created by the unified command work
- `packages/code/src/agents/*`
- `packages/code/src/services/session-manager.ts`

**Work**

1. Make the command registry a service.
2. Register built-in, template, skill, MCP, and plugin commands with provenance.
3. Create one runtime scope per session and agent.
4. Express agent definitions as scoped plugin overlays.
5. Ensure subagents inherit and narrow parent security policy.

**Acceptance**

- slash and palette execution resolve through one registry;
- plugin commands use the centralized command effect runner;
- session disposal removes scoped commands, tools, prompts, and interactions;
- child agents cannot widen inherited denied capabilities;
- switching sessions does not leak scoped contributions.

### Phase 6 — OpenTUI slots

**Target files**

- new UI slot registry
- `packages/code/src/tui/app.tsx`
- message, prompt, footer, dialog, and tool presentation components

**Work**

1. Declare a small set of stable slots.
2. Move one low-risk surface, such as status/footer items, to slots first.
3. Move tool presentations and custom message renderers.
4. Move prompt overlays and dialogs only after keyboard focus and interaction ownership are specified.
5. Preserve built-in fallback renderers for unknown contributions.

**Acceptance**

- unloading a UI plugin removes its components and handlers together;
- slot cardinality and replacement rules are enforced;
- focus and keyboard ownership return to the prompt after disposal;
- unknown custom content remains readable through a safe fallback;
- `app.tsx` no longer imports every optional feature component directly.

### Phase 7 — Rust lifecycle parity

Design and implement the Rust-native equivalent only after TypeScript phases 1–4 have stable tests and no known lifecycle defects.

Do not copy TypeScript loader or dynamic module assumptions into Rust. Define parity tests from shared behavioral scenarios and implement them independently.

## Required Test Matrix

### Kernel lifecycle

- synchronous setup and cleanup;
- asynchronous setup and cleanup;
- reverse cleanup order;
- idempotent public disposer;
- setup failure after partial registration;
- cleanup failure containment;
- dependency appears after registration;
- dependency disappears while active;
- provider restoration;
- parent disposal during child loading;
- concurrent activate/dispose/reload;
- dependency cycle reporting;
- shadowed service resolution;
- scope cascade disposal.

### Domain integration

- built-in, MCP, and custom tools share one pipeline;
- tool collision precedence and provenance;
- security denial before tool body execution;
- message veto before persistence;
- transient provider transform leaves storage unchanged;
- plugin interaction aborted by session disposal;
- agent scope inheritance and narrowing;
- command effects use the normal submit path;
- UI contribution removal restores focus.

### Failure and diagnostics

- malformed manifest;
- invalid config with source location;
- undeclared capability use;
- missing dependency;
- setup exception;
- timed-out hook;
- cleanup exception;
- reload blocked by incomplete disposal;
- unrelated plugin continues after peer failure.

Tests should exercise real registries and lifecycle objects. Do not mock the kernel itself.

## Performance Constraints

- service lookup should be proportional to scope depth, not plugin count;
- active registrations should use indexed maps rather than repeated full scans;
- dependency reverse edges should make provider removal proportional to affected dependants;
- event dispatch should snapshot listener references without cloning payloads;
- prompt/tool snapshots should be created once per turn;
- diagnostics should use bounded history per plugin;
- no configuration or schema validation should run on every model token;
- lifecycle cleanup must avoid detached promises that retain disposed scopes.

## Compatibility and Cutover

Use adapters while migrating, but perform a clean cutover per subsystem:

- once tools use the registry, remove manual tool array assembly;
- once security uses the tool pipeline, remove wrapper-based duplicate checks;
- once interactions use the service, remove direct ask/permission callback plumbing;
- once commands use the registry, remove ad hoc command dispatch;
- once a UI surface uses slots, remove its direct optional-feature import.

Do not keep aliases or parallel legacy paths after all callers migrate.

## Risks and Mitigations

### Runtime becomes a service locator

Mitigation: use typed service keys, small stable interfaces, explicit manifests, and provider ownership. Business code should depend on domain interfaces, not raw runtime maps.

### Hidden ordering dependencies

Mitigation: hard requirements use service dependencies; policy order uses explicit priority; ties use documented deterministic precedence.

### Cleanup hangs application shutdown

Mitigation: abort signals begin cancellation immediately, diagnostics expose pending cleanup, and host shutdown reports stuck plugins. Cleanup is not silently abandoned because that would leak resources.

### Third-party plugins bypass permissions

Mitigation: capabilities only grant access to APIs; privileged operations still pass through security services. Local plugin code is trusted code, and the UI must show provenance.

### Scope leaks

Mitigation: sessions and agents own runtime scopes directly. Scope disposal is part of session/agent termination, not an optional caller convention.

### Core SDK becomes coupled to the coding app

Mitigation: keep the runtime in `packages/code`; integrate `Agent` through existing public configuration until a generally useful SDK abstraction is proven.

### Excess abstraction before value

Mitigation: phase 1 implements only lifecycle primitives. Migrate tools first because they provide a concrete end-to-end proof before commands, messages, and UI slots expand the surface.

## Definition of Done

The plugin system is complete when:

- built-in and external plugins share one lifecycle and diagnostics path;
- required services control activation and reactivation;
- all registrations are owned and reversibly disposed;
- tools, commands, prompts, messages, interactions, sessions, and selected UI surfaces use domain services backed by the runtime;
- process, project, session, agent, and child-agent scopes are enforced;
- plugin capabilities cannot bypass Spectra permissions;
- inspection explains every active, pending, failed, and disposed plugin;
- no migrated subsystem retains a parallel manual registry or callback path;
- lifecycle and integration tests cover rollback, dependency loss, scope disposal, and failure isolation;
- Rust parity is implemented natively or remains explicitly documented as pending without bindings or shared runtime assumptions.

## Recommended First Change

Implement only the runtime kernel and its lifecycle tests. Do not begin with directory discovery, dynamic imports, UI slots, or model-authored plugins.

The first deliverable should prove four invariants:

1. ownership;
2. dependency-driven activation;
3. rollback;
4. awaited disposal.

Every later capability depends on those invariants being boring, deterministic, and correct.
