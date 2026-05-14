import { readFileSync } from "fs";
import { discoverInstructionFiles } from "../utils/paths.js";
import { getSystemPrompt } from "../utils/platform.js";

export interface ContextResult {
  systemPrompt: string;
  instructions: string[];
  files: string[];
}

export function loadContext(cwd?: string): ContextResult {
  const projectDir = cwd || process.cwd();
  const instructionFiles = discoverInstructionFiles(projectDir);

  const instructions: string[] = [];
  const files: string[] = [];

  for (const file of instructionFiles) {
    try {
      const content = readFileSync(file, "utf-8");
      instructions.push(content.trim());
      files.push(file);
    } catch { }
  }

  const systemPrompt = [
    getSystemPrompt(),
    ...instructions,
  ].join("\n\n");

  return { systemPrompt, instructions, files };
}
