#!/usr/bin/env node
/**
 * CLI entry point for Spectra Code.
 *
 * Run with: spectra [options] [messages...]
 * Run with: npx tsx src/cli.ts [options] [messages...]
 */
process.title = "spectra";

import { main } from "./main.js";

process.on("unhandledRejection", (err) => {
  process.stderr.write(`\x1b[31mUnhandled rejection\x1b[0m: ${err}\n`);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`\x1b[31mUncaught exception\x1b[0m: ${err.message}\n`);
  process.exit(1);
});

main(process.argv.slice(2));