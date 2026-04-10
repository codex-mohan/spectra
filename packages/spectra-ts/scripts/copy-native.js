const { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } = require("fs");
const { join, extname } = require("path");

const ROOT = join(__dirname, "..", "..", "..");
const DIST_NATIVE = join(__dirname, "..", "dist", "native");
const SRC_NATIVE = join(__dirname, "..", "src", "native");

function findCargoOutput() {
  const profiles = ["release", "debug"];
  for (const profile of profiles) {
    const targetDir = join(ROOT, "target", profile);
    if (!existsSync(targetDir)) continue;
    try {
      const files = readdirSync(targetDir);
      const candidates = files.filter((f) => {
        if (!f.startsWith("spectra_napi")) return false;
        const ext = extname(f);
        return ext === ".dll" || ext === ".so" || ext === ".dylib";
      });
      for (const candidate of candidates) {
        const candidatePath = join(targetDir, candidate);
        if (existsSync(candidatePath)) return candidatePath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function cleanStaleFiles(dir) {
  if (!existsSync(dir)) return;
  try {
    const files = readdirSync(dir);
    for (const f of files) {
      if (f.startsWith("spectra_napi") && extname(f) !== ".node") {
        const filePath = join(dir, f);
        console.log(`[spectra] Removing stale file: ${filePath}`);
        unlinkSync(filePath);
      }
    }
  } catch {
    // ignore
  }
}

function copyToDir(src, destDir) {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  const dest = join(destDir, "spectra_napi.node");
  copyFileSync(src, dest);
  return dest;
}

cleanStaleFiles(DIST_NATIVE);
cleanStaleFiles(SRC_NATIVE);

const binary = findCargoOutput();
if (!binary) {
  console.error("[spectra] Native addon not found in target/. Run 'cargo build --release --package spectra-napi' first.");
  process.exit(1);
}

const distDest = copyToDir(binary, DIST_NATIVE);
console.log(`[spectra] Copied native addon: ${distDest}`);

try {
  const srcDest = copyToDir(binary, SRC_NATIVE);
  console.log(`[spectra] Copied native addon (dev): ${srcDest}`);
} catch {
  console.warn("[spectra] Could not copy to src/native/ (dev mode), continuing.");
}
