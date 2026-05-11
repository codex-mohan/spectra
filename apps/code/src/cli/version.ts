import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let _version: string | undefined;

export function getVersion(): string {
  if (_version) return _version;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const require = createRequire(import.meta.url);
    // Walk up to find the package.json for this app
    const pkg = require(join(__dirname, "..", "..", "package.json"));
    _version = pkg.version ?? "0.0.0";
  } catch {
    _version = "0.0.0";
  }
  return _version!;
}
