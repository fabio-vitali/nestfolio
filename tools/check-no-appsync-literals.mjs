#!/usr/bin/env node
// check-no-appsync-literals.mjs — Pillar 3 build-time gate.
// Fails the build if frontend app or shell-tier lib source contains a
// literal AppSync / amazonaws.com URL. Charter §7 R6 routes everything
// through relative CloudFront paths.
//
// Usage:
//   node tools/check-no-appsync-literals.mjs [--root <dir>]
//
// --root defaults to the current working directory (workspace root). Tests
// pass a tmpdir.
//
// Scope:
//   - apps/**/*.{ts,html,json,js,mjs}
//   - libs/shell/**, libs/frontend-deps/**, libs/ui/** (same extensions)
// Excluded path fragments:
//   - node_modules, dist, cdk.out, .worktrees, .nx, coverage
// Excluded files:
//   - csp.txt (intentionally lists the Cognito host as a charter exception)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FORBIDDEN = /(appsync-api|appsync-realtime-api|\.amazonaws\.com)/;
const EXTS = new Set(['.ts', '.html', '.json', '.js', '.mjs']);
const EXCLUDE_FRAGMENTS = ['node_modules', 'dist', 'cdk.out', '.worktrees', '.nx', 'coverage'];
const SCOPED_DIRS = [
  'apps',
  'libs/shell',
  'libs/frontend-deps',
  'libs/ui',
];
// csp.txt intentionally lists the Cognito connect-src allowlist — charter-approved exception.
// apps/nestfolio-host/src/index.html is a generated artifact (emitted by prepare-index from
// index.html.tmpl + csp.txt) that also carries the same Cognito allowlist.
const EXCLUDED_BASENAMES = new Set(['csp.txt']);
const EXCLUDED_REL_PATHS = new Set(['apps/nestfolio-host/src/index.html']);

function parseArgs(argv) {
  let root = process.cwd();
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
  }
  return { root };
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (EXCLUDE_FRAGMENTS.some(f => e.name === f)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) {
      if (EXCLUDED_BASENAMES.has(e.name)) continue;
      const dot = e.name.lastIndexOf('.');
      const ext = dot >= 0 ? e.name.slice(dot) : '';
      if (EXTS.has(ext)) yield p;
    }
  }
}

function scan(scopedRoot, root) {
  const hits = [];
  for (const file of walk(scopedRoot)) {
    const rel = relative(root, file).split(sep).join('/');
    if (EXCLUDED_REL_PATHS.has(rel)) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(FORBIDDEN);
      if (m) hits.push({ file: rel, line: i + 1, match: m[0], snippet: lines[i].trim().slice(0, 200) });
    }
  }
  return hits;
}

function main() {
  const { root } = parseArgs(process.argv);
  const allHits = [];
  for (const rel of SCOPED_DIRS) {
    const dir = join(root, rel);
    let exists = false;
    try { exists = statSync(dir).isDirectory(); }
    catch {}
    if (!exists) continue;
    allHits.push(...scan(dir, root));
  }

  if (allHits.length === 0) {
    console.log('check-no-appsync-literals: OK (0 hits)');
    process.exit(0);
  }

  console.error('check-no-appsync-literals: FAIL');
  console.error(`Found ${allHits.length} forbidden literal(s) in app/shell-tier source.`);
  console.error('Charter §7 R6: route through relative CloudFront paths (/graphql/<domain>, /realtime/<domain>, /mfe/<key>/*).\n');
  for (const h of allHits) {
    console.error(`  ${h.file}:${h.line}  [${h.match}]`);
    console.error(`    ${h.snippet}`);
  }
  process.exit(1);
}

main();
