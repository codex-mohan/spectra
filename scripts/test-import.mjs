import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tmpDir = mkdtempSync(join(tmpdir(), 'spectra-verify-'));

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd || root, ...opts });
}

try {
  // 1. Build
  console.log('\n=== 1. Build ===');
  run('bun run build');

  // 2. Resolve workspace:* → ^version
  console.log('\n=== 2. Resolve workspace:* ===');
  run('node scripts/resolve-workspace-deps.mjs');

  // 3. Pack tarballs
  console.log('\n=== 3. Pack tarballs ===');
  for (const pkg of ['ai', 'agent', 'app']) {
    const pkgDir = join(root, 'packages', pkg);
    run(`npm pack --pack-destination "${tmpDir}"`, { cwd: pkgDir });
  }

  // 4. Install from tarballs using npm install ./tarball.tgz syntax
  console.log('\n=== 4. Install from tarballs ===');
  const tarballs = readdirSync(tmpDir).filter(f => f.endsWith('.tgz'));
  for (const t of tarballs) {
    run(`npm install "./${t}" --legacy-peer-deps`, { cwd: tmpDir });
  }

  // 5. Write and run import test
  console.log('\n=== 5. Run import test ===');
  writeFileSync(join(tmpDir, 'verify.mjs'), [
    'import { EventStream, stream } from "@mohanscodex/spectra-ai";',
    'import { Agent, defineTool } from "@mohanscodex/spectra-agent";',
    'import { SessionManager } from "@mohanscodex/spectra-app";',
    'import { z } from "zod";',
    '',
    'new EventStream();',
    'console.assert(typeof stream === "function", "stream must be a function");',
    '',
    'const tool = defineTool({',
    '  name: "greet", description: "test",',
    '  parameters: z.object({ name: z.string() }),',
    '  execute: async ({ name }) => ({ content: [{ type: "text", text: `Hi ${name}` }] }),',
    '});',
    'console.assert(tool.name === "greet", "tool name mismatch");',
    'tool.prepareArguments({ name: "x" });',
    '',
    'new Agent({ name: "a", instructions: "i", model: "m", tools: [tool] });',
    'new SessionManager({ model: "anthropic/claude-3-haiku-20240307" });',
    '',
    'console.log("✓ All imports verified -- ready to publish");',
  ].join('\n'));
  run('node verify.mjs', { cwd: tmpDir });

  console.log('\n=== ✅ IMPORT TEST PASSED ===');
} catch (err) {
  console.error('\n=== ❌ IMPORT TEST FAILED ===', err.message);
  process.exitCode = 1;
} finally {
  console.log('\n=== 7. Clean up ===');
  try {
    execSync('git checkout packages/agent/package.json packages/app/package.json', { cwd: root, stdio: 'pipe' });
  } catch { /* ok */ }
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
    console.log('  ✓ Cleaned up');
  }
}
