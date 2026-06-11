import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkgPath = fileURLToPath(import.meta.resolve('@mohanscodex/spectra-code/package.json'));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
export const VERSION = pkg.version;
