/**
 * Main entry point for the Spectra Code CLI.
 *
 * Handles CLI argument parsing, --help/--version flags, model resolution,
 * and routing to either TUI (interactive) or print (non-interactive) mode.
 */

import { parseArgs, printHelp, printVersion } from "./cli/index.js";
import type { AgentConfig } from "@singularity-ai/spectra-agent";
import { CodeAgentApp } from "./tui/app.js";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514";

const API_MAP: Record<string, string> = {
  anthropic: "messages",
  openai: "completions",
  openrouter: "completions",
  groq: "completions",
};

function resolveModel(cliModel?: string, cliProvider?: string): AgentConfig["model"] {
  const modelId = cliModel ?? process.env.SPECTRA_MODEL ?? DEFAULT_MODEL;
  const [inferredProvider, ...nameParts] = modelId.split("/");
  const name = nameParts.join("/");

  const provider = cliProvider ?? inferredProvider ?? "anthropic";
  const api = API_MAP[provider] ?? "messages";

  return {
    id: modelId,
    name: name || modelId,
    provider,
    api,
  };
}

export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  // Report diagnostics
  for (const d of parsed.diagnostics) {
    const prefix = d.type === "error" ? "\x1b[31mError\x1b[0m" : "\x1b[33mWarning\x1b[0m";
    process.stderr.write(`${prefix}: ${d.message}\n`);
  }
  if (parsed.diagnostics.some((d) => d.type === "error")) {
    process.exit(1);
  }

  // --version
  if (parsed.version) {
    printVersion();
    process.exit(0);
  }

  // --help
  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  // Resolve model from CLI flags → env → default
  const model = resolveModel(parsed.model, parsed.provider);

  // Set working directory if specified
  if (parsed.cwd) {
    try {
      process.chdir(parsed.cwd);
    } catch {
      process.stderr.write(`\x1b[31mError\x1b[0m: Cannot change to directory: ${parsed.cwd}\n`);
      process.exit(1);
    }
  }

  // Non-interactive (print) mode
  if (parsed.print) {
    if (parsed.messages.length === 0) {
      process.stderr.write("\x1b[31mError\x1b[0m: --print mode requires at least one message argument\n");
      process.exit(1);
    }
    await runPrintMode(model, parsed.messages.join(" "), parsed);
    return;
  }

  // Interactive TUI mode (default)
  const app = new CodeAgentApp(model, {
    initialMessages: parsed.messages,
    systemPrompt: parsed.systemPrompt,
    verbose: parsed.verbose,
    apiKey: parsed.apiKey,
  });

  await app.start();
}

/**
 * Non-interactive print mode: send prompt, stream response, exit.
 */
async function runPrintMode(
  model: AgentConfig["model"],
  prompt: string,
  parsed: ReturnType<typeof parseArgs>,
): Promise<void> {
  const { Agent } = await import("@singularity-ai/spectra-agent");
  const { createAllTools, loadConfig, discoverConfigDir, buildSystemContext } = await import(
    "@singularity-ai/spectra-code"
  );

  const allTools = createAllTools(process.cwd());
  const config = await loadConfig();
  const configDir = await discoverConfigDir();
  const systemContext = configDir
    ? await buildSystemContext(process.cwd(), config.context?.priorities)
    : "";

  const systemPrompt = [
    parsed.systemPrompt ?? "You are Spectra Code, an expert coding assistant.",
    systemContext ? `\n\nProject context:\n${systemContext}` : "",
  ].join("");

  const agent = new Agent({
    model,
    systemPrompt,
    tools: allTools,
    maxTurns: 50,
    toolExecution: "parallel",
    getApiKey: (provider: string) => {
      if (parsed.apiKey) return parsed.apiKey;
      const envKey = provider.toUpperCase().replace(/-/g, "_") + "_API_KEY";
      return process.env[envKey] ?? process.env.API_KEY;
    },
  });

  try {
    const stream = agent.run(prompt);
    for await (const event of stream) {
      if (event.type === "message_update") {
        const msgEvent = event.assistantMessageEvent;
        if ("delta" in msgEvent) {
          const textDeltas = (msgEvent.delta as { content?: Array<{ type: string; text?: string }> })
            ?.content?.filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("");
          if (textDeltas) {
            process.stdout.write(textDeltas);
          }
        }
      }
    }
    process.stdout.write("\n");
  } catch (err: unknown) {
    if (err instanceof Error) {
      process.stderr.write(`\x1b[31mError\x1b[0m: ${err.message}\n`);
    }
    process.exit(1);
  }
}