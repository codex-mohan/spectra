# Pitfalls Research

**Domain:** AI Agent Framework
**Researched:** 2026-04-08
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Blocking the Async Runtime

**What goes wrong:**
Agent loop hangs or throughput collapses because blocking calls block the entire runtime.

**Why it happens:**
Using `std::thread`, `thread::sleep`, or blocking file I/O in async code. Tokio uses a thread pool with limited threads; blocking blocks the executor.

**How to avoid:**
- Use `tokio::spawn` for CPU-bound work
- Use `tokio::time::sleep` instead of `thread::sleep`
- Use `tokio::fs` for file I/O
- For truly blocking FFI, use `tokio::task::spawn_blocking`

**Warning signs:**
- High latency spikes
- Low CPU utilization despite busy work
- `tokio` warnings about blocking

**Phase to address:**
Phase 1 (spectra-core) — async patterns are foundational

---

### Pitfall 2: Memory Leaks in Agent History

**What goes wrong:**
Message history grows unbounded, causing OOM in long-running agents.

**Why it happens:**
Every LLM turn appends to history, but no truncation strategy. Unbounded growth in production.

**How to avoid:**
- Implement sliding window (keep last N messages)
- Implement summarization strategy
- Provide truncation utilities
- Document memory expectations

**Warning signs:**
- Process RSS grows over time
- History length check fails
- OOM kills in production

**Phase to address:**
Phase 1 (spectra-core) — but document limits clearly

---

### Pitfall 3: Tool Schema Mismatch

**What goes wrong:**
LLM calls tool with wrong arguments, crashes, or silently fails.

**Why it happens:**
JSON schema derived from Zod/Pydantic doesn't match tool handler expectations. Validation at boundary is inconsistent.

**How to avoid:**
- Validate at dispatch boundary (before calling tool)
- Use consistent schema generation from types
- Test tool definitions round-trip through serialization
- Log schema mismatches clearly

**Warning signs:**
- Silent tool failures
- "Invalid arguments" errors from tools
- Schema validation errors in logs

**Phase to address:**
Phase 1 (spectra-core) + SDK validation layers

---

### Pitfall 4: Streaming Event Loss

**What goes wrong:**
Client disconnects but server continues processing, or events arrive out of order.

**Why it happens:**
mpsc channel dropped on disconnect. No backpressure. No ordering guarantees for concurrent events.

**How to avoid:**
- Check `send()` result on every event
- Implement proper cancellation with ` CancellationToken`
- Document ordering guarantees (or lack thereof)
- Add heartbeats for long-running tool calls

**Warning signs:**
- "Channel closed" warnings
- Client timeouts mid-stream
- Out-of-order tool results

**Phase to address:**
Phase 1 (spectra-core) — streaming is core functionality

---

### Pitfall 5: FFI Boundary Performance

**What goes wrong:**
Crossing FFI boundary is slow, defeating the purpose of Rust performance.

**Why it happens:**
Excessive serialization/deserialization at FFI boundary. Large data passed by value instead of reference.

**How to avoid:**
- Pass data by reference where possible
- Minimize serialization round-trips
- Use zero-copy buffers for streaming (Bytes)
- Profile FFI overhead during SDK development

**Warning signs:**
- TS/Python calls 10x slower than Rust
- High CPU in JS/Python process
- Memory copying in profiles

**Phase to address:**
Phase 3/4 (SDKs) — performance validation

---

### Pitfall 6: Panic Propagation

**What goes wrong:**
Panic in tool or user code crashes the agent loop.

**Why it happens:**
No catch_unwind around user callbacks. Unwind across FFI boundaries is UB.

**How to avoid:**
- Catch panics at tool dispatch boundary
- Convert panics to typed errors
- Never unwind across FFI boundaries
- Document panic safety requirements for tools

**Warning signs:**
- "panicked at" messages in logs
- Segfaults when tools fail
- Uncaught exceptions in Python tools

**Phase to address:**
Phase 1 (spectra-core) — error handling patterns

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Clone everything | Simplicity | Memory bloat | Never in hot paths |
| unwrap() in code | Fewer lines | Panics in prod | Never in library |
| Global state | Easy access | Testing nightmare | Never |
| Stringly-typed errors | Fast | No handling | Never |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Anthropic API | Wrong Content--Type | application/json with JSON body |
| OpenAI API | Wrong endpoint | /v1/chat/completions streaming |
| Rate limits | No backoff | Exponential backoff with jitter |
| API keys | Hardcoded | Environment variables only |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded history | OOM | Sliding window | >1000 turns |
| Sync file I/O | Blocking | tokio::fs | Any file tool |
| Large tool schemas | Token bloat | Minimal schemas | >20 tools |
| No connection pool | Connection overhead | reqwest pool | >10 agents |

## Security Mistakes

Domain-specific security issues.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Arbitrary code exec | RCE | Sandboxing tools |
| API key exposure | Account compromise | Never log keys |
| Unvalidated tool args | Injection | Schema validation |
| Prompt injection | Data exfil | Input sanitization |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Agent loop:** Often missing cancellation handling — verify ctrl-c works
- [ ] **Tool dispatch:** Often missing error conversion — verify errors are typed
- [ ] **Streaming:** Often missing backpressure — verify handles slow clients
- [ ] **SDK bindings:** Often missing async iteration — verify async for works
- [ ] **Error display:** Often missing source chain — verify miette renders

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| OOM from history | MEDIUM | Restart, implement truncation, truncate now |
| Panic crash | HIGH | Catch in wrapper, convert to error, restart |
| FFI deadlock | HIGH | Kill process, profile FFI boundary |
| Rate limit hit | LOW | Backoff, retry with delay |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Async blocking | Phase 1: spectra-core | tokio::spawn used, no blocking |
| Memory leaks | Phase 1: spectra-core | Memory profiling, history limits |
| Schema mismatch | Phase 1: spectra-core | Round-trip validation tests |
| Streaming loss | Phase 1: spectra-core | Disconnect tests |
| FFI perf | Phase 3/4: SDKs | Benchmark vs Rust baseline |
| Panic propagation | Phase 1: spectra-core | Catch_unwind tests |

## Sources

- tokio async runtime documentation
- Rust FFI guidelines
- napi-rs best practices
- PyO3 anti-patterns

---
*Pitfalls research for: AI Agent Framework*
*Researched: 2026-04-08*
