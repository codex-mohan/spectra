/**
 * CLI argument parsing for Spectra Code.
 *
 * Inspired by pi-mono's cli/args.ts — hand-rolled parser (no yargs dependency)
 * that returns a typed Args object. Unknown flags produce diagnostics rather
 * than hard errors so extensions can add their own later.
 */

export interface Args {
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  continue?: boolean;
  help?: boolean;
  version?: boolean;
  print?: boolean;
  noSession?: boolean;
  verbose?: boolean;
  cwd?: string;
  /** Positional messages to send on startup */
  messages: string[];
  diagnostics: Array<{ type: "warning" | "error"; message: string }>;
}

export function parseArgs(argv: string[]): Args {
  const result: Args = {
    messages: [],
    diagnostics: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;

      case "--version":
      case "-v":
        result.version = true;
        break;

      case "--print":
      case "-p":
        result.print = true;
        break;

      case "--continue":
      case "-c":
        result.continue = true;
        break;

      case "--no-session":
        result.noSession = true;
        break;

      case "--verbose":
        result.verbose = true;
        break;

      case "--provider":
        if (i + 1 < argv.length) {
          result.provider = argv[++i];
        } else {
          result.diagnostics.push({ type: "error", message: "--provider requires a value" });
        }
        break;

      case "--model":
        if (i + 1 < argv.length) {
          result.model = argv[++i];
        } else {
          result.diagnostics.push({ type: "error", message: "--model requires a value" });
        }
        break;

      case "--api-key":
        if (i + 1 < argv.length) {
          result.apiKey = argv[++i];
        } else {
          result.diagnostics.push({ type: "error", message: "--api-key requires a value" });
        }
        break;

      case "--system-prompt":
        if (i + 1 < argv.length) {
          result.systemPrompt = argv[++i];
        } else {
          result.diagnostics.push({ type: "error", message: "--system-prompt requires a value" });
        }
        break;

      case "--cwd":
        if (i + 1 < argv.length) {
          result.cwd = argv[++i];
        } else {
          result.diagnostics.push({ type: "error", message: "--cwd requires a value" });
        }
        break;

      default:
        if (arg.startsWith("--")) {
          // Unknown flag — record but don't hard-fail
          result.diagnostics.push({ type: "warning", message: `Unknown option: ${arg}` });
        } else if (arg.startsWith("-") && arg.length > 1) {
          result.diagnostics.push({ type: "error", message: `Unknown option: ${arg}` });
        } else {
          result.messages.push(arg);
        }
        break;
    }
  }

  return result;
}
