import { homedir } from "node:os";
import { resolve, normalize } from "node:path";

export function resolvePath(input: string, cwd: string): string {
  let expanded = input;
  if (expanded.startsWith("~")) {
    expanded = homedir() + expanded.slice(1);
  }
  if (!resolve(expanded).startsWith("/") && !expanded.startsWith("/")) {
    expanded = resolve(cwd, expanded);
  }
  return normalize(expanded);
}

export function resolveToCwd(input: string, cwd: string): string {
  let expanded = input;
  if (expanded.startsWith("~")) {
    expanded = homedir() + expanded.slice(1);
  }
  return resolve(cwd, expanded);
}