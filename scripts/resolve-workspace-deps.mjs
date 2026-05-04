import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const packagesDir = join(root, 'packages');
const entries = readdirSync(packagesDir, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const pkgPath = join(packagesDir, entry.name, 'package.json');
  if (!existsSync(pkgPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  if (pkg.private) continue;

  const version = pkg.version;
  let changed = false;

  for (const depsKey of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[depsKey];
    if (!deps) continue;
    for (const [key, val] of Object.entries(deps)) {
      if (val === 'workspace:*' || val.startsWith('workspace:')) {
        deps[key] = `^${version}`;
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  ✓ ${pkg.name}: workspace:* → ^${version}`);
  }
}
