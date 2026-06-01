#!/usr/bin/env node
// check-read-model-drift.mjs — read-model ownership freeze gate (w6, layer 4).
//
// Enforces the single-writer aggregate-ownership model
// (docs/architecture/READ-MODEL-OWNERSHIP.md) over the REGISTERED surface: it
// parses every service's `ReadModelOwnership` augmentation into a typename->tag
// registry, scans event-processor intent-factory call sites and AppSync
// JS-resolver `__typename` writes, and errors on four drift classes:
//
//   R1 accumulate-on-projection   — a registered Projection written via accumulate()
//   R2 p1-without-version-guard   — a registered Projection<'P1'> written by a
//                                    non-versioned factory (must use projectVersioned)
//   R3 dual-writer                — a typename written by BOTH a command path
//                                    (*.fn.js __typename) AND an event-side ONGOING
//                                    intent (project/projectVersioned/accumulate/
//                                    update/updateOrRetry). record()-only event writes
//                                    are the allowed seed-by-one-event path (§6.4).
//   R4 registry-conflict          — the same typename registered with different tags.
//
// Typenames written via a factory but absent from the registry are reported as a
// non-failing INFO list (visibility for read-model-ownership-producer-aggregates),
// NOT errored: registration is opt-in, and unregistered = not-yet-governed.
//
// Usage:
//   node tools/check-read-model-drift.mjs [--root <dir>]
// --root defaults to cwd (workspace root). Tests pass a tmpdir.
//
// Scope: services/**/src (excludes test dirs + *.test.ts/*.spec.ts).
// No AST dependency — string/regex scanning, matching the house style of
// tools/check-no-appsync-literals.mjs. Enforcement relies on the established
// convention that intent typenames are passed as string LITERALS.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDE_FRAGMENTS = ['node_modules', 'dist', 'cdk.out', '.worktrees', '.nx', 'coverage', 'test'];
const EXCLUDED_BASENAME_SUFFIXES = ['.test.ts', '.spec.ts'];
const FACTORY_RE =
  /(?<![.\w])(projectVersioned|updateOrRetry|project|accumulate|update|record)\s*\(\s*['"]([A-Za-z0-9_]+)['"]/g;
const TYPENAME_WRITE_RE = /__typename\s*:\s*['"]([A-Za-z0-9_]+)['"]/g;
const ONGOING_FACTORIES = new Set(['project', 'projectVersioned', 'accumulate', 'update', 'updateOrRetry']);

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
    else if (e.isFile()) yield p;
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// True if `index` falls inside a // line comment or an unclosed /* */ block.
// Lets the scanners keep whole-text (multi-line) matching while ignoring the
// illustrative factory mentions that legitimately live in doc comments.
function inComment(text, index) {
  const open = text.lastIndexOf('/*', index);
  if (open !== -1) {
    const close = text.indexOf('*/', open);
    if (close === -1 || close >= index) return true;
  }
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  if (text.slice(lineStart, index).includes('//')) return true;
  return false;
}

// Parse every `interface ReadModelOwnership { ... }` block under services/**.
export function parseRegistry(root) {
  const registry = {};
  const conflicts = [];
  for (const file of walk(join(root, 'services'))) {
    if (!file.endsWith('.ts')) continue;
    if (EXCLUDED_BASENAME_SUFFIXES.some(s => file.endsWith(s))) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch { continue; }
    if (!text.includes('interface ReadModelOwnership')) continue;
    const rel = relative(root, file).split(sep).join('/');
    const body = text.slice(text.indexOf('interface ReadModelOwnership'));
    const entryRe = /([A-Za-z0-9_]+)\s*:\s*(Projection<\s*'(P[123])'\s*>|CommandOwned)/g;
    let m;
    while ((m = entryRe.exec(body)) !== null) {
      const typename = m[1];
      const tag = m[3] ? m[3] : 'CommandOwned';
      const existing = registry[typename];
      if (existing && existing.tag !== tag) {
        conflicts.push({ typename, tags: [existing.tag, tag], files: [existing.file, rel] });
      } else if (!existing) {
        registry[typename] = { tag, file: rel };
      }
    }
  }
  return { registry, conflicts };
}

// Scan event-processor intent-factory call sites under services/**/src.
export function scanIntentCalls(root) {
  const calls = [];
  for (const file of walk(join(root, 'services'))) {
    if (!file.endsWith('.ts')) continue;
    if (EXCLUDED_BASENAME_SUFFIXES.some(s => file.endsWith(s))) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch { continue; }
    const rel = relative(root, file).split(sep).join('/');
    FACTORY_RE.lastIndex = 0;
    let m;
    while ((m = FACTORY_RE.exec(text)) !== null) {
      if (inComment(text, m.index)) continue;
      calls.push({ factory: m[1], typename: m[2], file: rel, line: lineOf(text, m.index) });
    }
  }
  return calls;
}

// Scan AppSync JS-resolver command writes (*.fn.js __typename literals).
export function scanCommandWrites(root) {
  const cmds = [];
  for (const file of walk(join(root, 'services'))) {
    if (!file.endsWith('.fn.js')) continue;
    const norm = file.split(sep).join('/');
    if (!norm.includes('/graphql/js-function/')) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch { continue; }
    const rel = relative(root, file).split(sep).join('/');
    TYPENAME_WRITE_RE.lastIndex = 0;
    let m;
    while ((m = TYPENAME_WRITE_RE.exec(text)) !== null) {
      if (inComment(text, m.index)) continue;
      cmds.push({ typename: m[1], file: rel, line: lineOf(text, m.index) });
    }
  }
  return cmds;
}

export function evaluate(registry, conflicts, calls, commands) {
  const errors = [];
  const isProjection = t => registry[t] && registry[t].tag.startsWith('P');

  for (const c of calls) {
    if (c.factory === 'accumulate' && isProjection(c.typename)) {
      errors.push({ rule: 'accumulate-on-projection', typename: c.typename, file: c.file, line: c.line,
        msg: `Projection '${c.typename}' written via accumulate() — projections never accumulate across events` });
    }
    if (registry[c.typename]?.tag === 'P1' && c.factory !== 'projectVersioned') {
      errors.push({ rule: 'p1-without-version-guard', typename: c.typename, file: c.file, line: c.line,
        msg: `Projection<'P1'> '${c.typename}' written via ${c.factory}() — P1 rows must use projectVersioned()` });
    }
  }

  const commandTypenames = new Set(commands.map(c => c.typename));
  for (const t of commandTypenames) {
    const ongoing = calls.find(c => c.typename === t && ONGOING_FACTORIES.has(c.factory));
    if (ongoing) {
      const cmd = commands.find(c => c.typename === t);
      errors.push({ rule: 'dual-writer', typename: t, file: ongoing.file, line: ongoing.line,
        msg: `'${t}' written by a command (${cmd.file}:${cmd.line}) AND an event-side ${ongoing.factory}() — dual authority; only the record()-seed pattern may coexist with a command` });
    }
  }

  for (const c of conflicts) {
    errors.push({ rule: 'registry-conflict', typename: c.typename, file: c.files.join(' / '), line: 0,
      msg: `'${c.typename}' registered with conflicting tags ${c.tags.join(' vs ')} (${c.files.join(', ')})` });
  }

  const seen = new Set();
  const info = [];
  for (const c of [...calls, ...commands]) {
    if (registry[c.typename] || seen.has(c.typename)) continue;
    seen.add(c.typename);
    info.push({ typename: c.typename, file: c.file, line: c.line, factory: c.factory ?? 'command' });
  }
  info.sort((a, b) => a.typename.localeCompare(b.typename));

  return { errors, info };
}

function main() {
  const { root } = parseArgs(process.argv);
  const { registry, conflicts } = parseRegistry(root);
  const calls = scanIntentCalls(root);
  const commands = scanCommandWrites(root);
  const { errors, info } = evaluate(registry, conflicts, calls, commands);

  if (info.length) {
    console.log(`read-model-drift: ${info.length} factory-written typename(s) not in any ReadModelOwnership registry (INFO — tracked by read-model-ownership-producer-aggregates):`);
    for (const i of info) console.log(`  - ${i.typename}  (${i.factory}, ${i.file}:${i.line})`);
    console.log('');
  }

  if (errors.length === 0) {
    console.log(`read-model-drift: OK (${Object.keys(registry).length} registered typename(s), 0 drift)`);
    process.exit(0);
  }

  console.error('read-model-drift: FAIL');
  console.error(`Found ${errors.length} ownership drift violation(s). See docs/architecture/READ-MODEL-OWNERSHIP.md.\n`);
  for (const e of errors) {
    console.error(`  [${e.rule}] ${e.file}${e.line ? ':' + e.line : ''}`);
    console.error(`    ${e.msg}`);
  }
  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
