#!/usr/bin/env node
/**
 * Spectra Code — TUI coding agent
 *
 * Usage: bun run src/cli.ts [--interactive]
 */
import { main } from "./main.js";

main(process.argv.slice(2));
