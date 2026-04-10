const { existsSync, mkdirSync, copyFileSync, readdirSync } = require("fs");
const { dirname, join } = require("path");

const NATIVE_DIR = join(__dirname, "..", "native");
const RELEASE = false;

const profile = RELEASE ? "release" : "debug";
const targetDir = join(__dirname, "..", "..", "..", "target", profile);

function findNativeBinary() {
  const arches = [
    "x86_64-pc-windows-msvc",
    "aarch64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
  ];

  for (const arch of arches) {
    const nativePath = join(targetDir, arch, "libspectra_napi.node");
    if (existsSync(nativePath)) return nativePath;

    const dllPath = join(targetDir, arch, "spectra_napi.dll");
    if (existsSync(dllPath)) return dllPath;
  }

  const debugTargetDir = join(__dirname, "..", "..", "..", "target", "debug");
  const debugBins = readdirSync(debugTargetDir).filter((f) =>
    f.includes("spectra_napi")
  );
  for (const bin of debugBins) {
    const binPath = join(debugTargetDir, bin);
    if (existsSync(binPath)) return binPath;
  }

  return null;
}

if (!existsSync(NATIVE_DIR)) {
  mkdirSync(NATIVE_DIR, { recursive: true });
}

const binary = findNativeBinary();
if (binary) {
  const ext = process.platform === "win32" ? ".dll" : ".node";
  const dest = join(NATIVE_DIR, `spectra_napi${ext}`);
  copyFileSync(binary, dest);
  console.log(`[spectra] Copied native addon: ${dest}`);
} else {
  console.warn(
    `[spectra] Native addon not found in ${targetDir}. Run 'cargo build --package spectra-napi' first.`
  );
}
