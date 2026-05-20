// Preload that guarantees process.env.TMPDIR points at an absolute, existing
// directory and pins NX_SOCKET_DIR to a short absolute path. Wired via
// NODE_OPTIONS=--require in .npmrc and via jest.preset.js require().
//
// Why this exists:
//   1. Some parent processes (notably nx-console under WebStorm/VS Code) spawn
//      node with TMPDIR stripped or set to empty string. When TMPDIR is "",
//      os.tmpdir() also returns "" on some platforms, and any tool that does
//      path.join(os.tmpdir(), 'foo') produces the bare relative path 'foo' —
//      which then gets mkdtemp/mkdir'd in process.cwd() (the repo root).
//
//   2. nx daemon's socket dir resolution also fails — and on macOS the Unix
//      socket sun_path limit (104 bytes) is easily hit by the default
//      $TMPDIR/<20-hex>/d.sock when TMPDIR is /var/folders/... See
//      https://github.com/nrwl/nx/issues/27725 — nx's own error message
//      recommends exactly this fix: "Set NX_SOCKET_DIR to a shorter path".
//      And https://github.com/nrwl/nx/issues/31720 (closed as not planned).
//
//   Concretely the symptoms were: cdk.out<rand>, jest_<uid36>, tsx-<uid>,
//   node-compile-cache/, nx-native-file-cache-*/, the 20-hex nx-daemon socket
//   dirs, and plugin<pid>-*.sock leaking into the repo root.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// (1) Sanitize TMPDIR if empty/relative/wiped.
const current = process.env.TMPDIR;
const ok = typeof current === 'string' && current.length > 0 && path.isAbsolute(current) && fs.existsSync(current);
if (!ok) {
  const fallback = fs.existsSync('/tmp') ? '/tmp' : os.tmpdir();
  if (path.isAbsolute(fallback) && fs.existsSync(fallback)) {
    process.env.TMPDIR = fallback.endsWith(path.sep) ? fallback : fallback + path.sep;
  }
}

// (2) Pin NX_SOCKET_DIR to the official nx-recommended short path. This is
// the single escape hatch that prevents both the macOS socket-path-length
// crash AND any repo-root socket leak when nx falls back from a broken tmp.
if (!process.env.NX_SOCKET_DIR) {
  process.env.NX_SOCKET_DIR = '/tmp/nx-nestfolio';
}
