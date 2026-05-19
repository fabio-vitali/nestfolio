// Preload that guarantees process.env.TMPDIR points at an absolute, existing
// directory before any module loads. Wired via NODE_OPTIONS=--require in
// .npmrc and via jest.preset.js require().
//
// Why this exists:
//   Some parent processes (notably nx-console under WebStorm/VS Code) spawn
//   node with TMPDIR stripped or set to empty string. When TMPDIR is "",
//   os.tmpdir() also returns "" on some platforms, and any tool that does
//   path.join(os.tmpdir(), 'foo') produces the bare relative path 'foo' —
//   which then gets mkdtemp/mkdir'd in process.cwd() (the repo root).
//
//   Concretely this leaked: cdk.out<rand> (CloudAssemblyBuilder),
//   jest_<uid36> (jest haste-map), tsx-<uid> (tsx cache),
//   node-compile-cache, nx-native-file-cache-*, and 20-hex nx daemon
//   socket dirs — all of them defaulting their cache to os.tmpdir().
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const current = process.env.TMPDIR;
const ok = typeof current === 'string' && current.length > 0 && path.isAbsolute(current) && fs.existsSync(current);

if (!ok) {
  const fallback = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
  if (path.isAbsolute(fallback) && fs.existsSync(fallback)) {
    process.env.TMPDIR = fallback.endsWith(path.sep) ? fallback : fallback + path.sep;
  }
}
