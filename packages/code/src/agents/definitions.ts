import type { AgentTool } from "@singularity-ai/spectra-agent"

export interface AgentDefinition {
  name: string
  mode: "primary" | "subagent"
  description: string
  tools: string[]
  maxTurns: number
  temperature?: number
  prompt: string
}

export const AGENT_DEFINITIONS: Record<string, AgentDefinition> = {
  build: {
    name: "build",
    mode: "primary",
    description: "Full development agent with all tools enabled. Use for implementation, editing, and running commands.",
    tools: ["read", "write", "edit", "bash", "glob", "grep", "web_fetch", "task"],
    maxTurns: 30,
    temperature: 0,
    prompt: `## Mode: Build

You are in build mode — full development access. You have all tools available.

- Execute changes confidently using write, edit, and bash
- Read files before editing to understand context
- Run tests after making changes to verify correctness
- Prefer edit over write for small surgical changes
- Use glob and grep for discovery before reading files
- Be concise: minimal explanations, maximum action`,
  },

  plan: {
    name: "plan",
    mode: "primary",
    description: "Read-only planning and analysis. Cannot edit files or run commands. Use for designing approaches and understanding code.",
    tools: ["read", "glob", "grep", "web_fetch", "task"],
    maxTurns: 15,
    temperature: 0,
    prompt: `## Mode: Plan

You are in plan mode — read-only analysis and design. You CANNOT edit files, write code, or run commands.

- Explore the codebase using read, glob, grep, and web_fetch
- Identify patterns, dependencies, and affected areas
- Design a clear implementation plan with specific files and changes
- Break complex tasks into numbered steps
- Flag risks, edge cases, and testing strategy
- When done planning, the user will switch to build mode to execute

Do NOT make any edits. Do NOT run bash commands. Analysis and planning only.`,
  },

  debug: {
    name: "debug",
    mode: "primary",
    description: "Investigation and debugging. Can read files and run safe commands but cannot edit. Use for diagnosing issues.",
    tools: ["read", "bash", "grep", "glob"],
    maxTurns: 20,
    temperature: 0,
    prompt: `## Mode: Debug

You are in debug mode — investigation and diagnosis. You can read files and run commands, but cannot edit code.

- Reproduce the issue: run the failing command or test
- Trace the execution path using read and grep
- Inspect logs, error messages, and stack traces
- Use bash for diagnostic commands (version checks, env inspection, test runs)
- Identify the root cause with evidence
- Propose a fix — but do NOT apply it (the user will switch to build mode)

Do NOT edit files. Investigation only.`,
  },

  explore: {
    name: "explore",
    mode: "subagent",
    description: "Fast, read-only codebase explorer. Use for file search, code navigation, and answering questions about the codebase.",
    tools: ["read", "glob", "grep", "web_fetch"],
    maxTurns: 5,
    temperature: 0,
    prompt: `## Mode: Explore

You are in explore mode — fast codebase navigation. Read-only, no edits.

- Find files by glob patterns (e.g., "src/**/*.ts")
- Search code with grep for patterns, functions, classes
- Read files to understand implementations
- Answer questions about the codebase structure and patterns
- Be thorough but fast — prefer grep over reading entire files

Return your findings concisely. Do NOT edit or run commands.`,
  },
}

export const PRIMARY_AGENTS = Object.values(AGENT_DEFINITIONS)
  .filter((d) => d.mode === "primary")
  .map((d) => d.name)

export const SUBAGENTS = Object.values(AGENT_DEFINITIONS)
  .filter((d) => d.mode === "subagent")
  .map((d) => d.name)

export function getToolNamesForAgent(agentName: string): string[] {
  const def = AGENT_DEFINITIONS[agentName]
  return def ? [...def.tools] : []
}

export function filterToolsByAgent(
  allTools: AgentTool[],
  agentName: string,
): AgentTool[] {
  const allowed = getToolNamesForAgent(agentName)
  return allTools.filter((t) => allowed.includes(t.name))
}
