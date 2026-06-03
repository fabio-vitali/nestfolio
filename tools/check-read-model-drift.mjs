#!/usr/bin/env node
// check-read-model-drift.mjs — read-model ownership MANDATORY gate (WS-D).
//
// Enforces the single-writer aggregate-ownership model
// (docs/architecture/READ-MODEL-OWNERSHIP.md) across the WHOLE system: it parses
// every service's `ReadModelOwnership` augmentation into a typename->tag registry,
// scans event-processor intent-factory call sites and AppSync JS-resolver
// `__typename` writes, and errors on six drift classes:
//
//   R1 accumulate-on-projection   — a registered Projection written via accumulate()
//   R2 p1-without-version-guard   — a registered Projection<'P1'> written by a
//                                    non-versioned factory (must use projectVersioned)
//   R3 dual-writer                — a typename written by BOTH a command path
//                                    (*.fn.js __typename) AND an event-side ONGOING
//                                    intent (project/projectVersioned/accumulate/
//                                    update/updateOrRetry). record()-only event writes
//                                    are the allowed seed-by-one-event path (§6.4).
//   R4 registry-conflict          — the same typename registered with different tags WITHIN ONE service
//                                    (per-service scoped: a typename may be CommandOwned in its owner
//                                     and Projection<'P1'> in a mirror).
//   R5 unclassified-write         — an intent-factory write whose typename is neither
//                                    registered in a ReadModelOwnership augmentation NOR
//                                    listed in tools/read-model-exclusions.json. MANDATORY:
//                                    register it or add it to the exclusion registry.
//                                    (Command writes — *.fn.js __typename — are NOT gated
//                                    here; they are surfaced as non-failing INFO.)
//   R6 exclusion-conflict         — a (service, typename) both registered AND excluded.
//
// The exclusion registry (tools/read-model-exclusions.json) lists the verified
// non-governed outbox/carrier and external-feed-cache rows, each with a reason.
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

const EXCLUSIONS_FILE = 'tools/read-model-exclusions.json';

// Parse the verified-non-governed exclusion registry. Returns a Set of
// "service::typename" keys plus the raw entries. Absent file → empty (so a
// tmpdir tree with no registry degrades cleanly). Malformed entries throw.
export function parseExclusions(root) {
  let raw;
  try { raw = readFileSync(join(root, EXCLUSIONS_FILE), 'utf8'); }
  catch { return { exclusions: new Set(), entries: [] }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`${EXCLUSIONS_FILE}: invalid JSON — ${e.message}`); }
  const entries = Array.isArray(parsed) ? parsed : (parsed.exclusions ?? []);
  const exclusions = new Set();
  for (const e of entries) {
    const ok = e && typeof e.service === 'string' && e.service &&
      typeof e.typename === 'string' && e.typename &&
      typeof e.reason === 'string' && e.reason.trim();
    if (!ok) throw new Error(`${EXCLUSIONS_FILE}: each entry needs non-empty {service, typename, reason} — bad entry: ${JSON.stringify(e)}`);
    exclusions.add(`${e.service}::${e.typename}`);
  }
  return { exclusions, entries };
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

// services/<domain>/<service>/... → "<service>". Mirrors the repo layout.
function serviceOf(rel) {
  const parts = rel.split('/');
  return parts[2] ?? rel;
}

// Parse every `interface ReadModelOwnership { ... }` block under services/**,
// keyed by (service, typename) so a typename may be CommandOwned in its owning
// service and Projection<'P1'> in a mirroring service without conflict.
export function parseRegistry(root) {
  const registry = {}; // { [service]: { [typename]: { tag, file } } }
  const conflicts = [];
  for (const file of walk(join(root, 'services'))) {
    if (!file.endsWith('.ts')) continue;
    if (EXCLUDED_BASENAME_SUFFIXES.some(s => file.endsWith(s))) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch { continue; }
    if (!text.includes('interface ReadModelOwnership')) continue;
    const rel = relative(root, file).split(sep).join('/');
    const service = serviceOf(rel);
    const body = text.slice(text.indexOf('interface ReadModelOwnership'));
    const entryRe = /([A-Za-z0-9_]+)\s*:\s*(Projection<\s*'(P[123])'\s*>|CommandOwned)/g;
    let m;
    while ((m = entryRe.exec(body)) !== null) {
      const typename = m[1];
      const tag = m[3] ? m[3] : 'CommandOwned';
      const svcReg = (registry[service] ??= {});
      const existing = svcReg[typename];
      if (existing && existing.tag !== tag) {
        conflicts.push({ service, typename, tags: [existing.tag, tag], files: [existing.file, rel] });
      } else if (!existing) {
        svcReg[typename] = { tag, file: rel };
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

export function evaluate(registry, conflicts, calls, commands, exclusions = new Set()) {
  const errors = [];
  const tagOf = (service, t) => registry[service]?.[t]?.tag;
  const isProjection = (service, t) => {
    const tag = tagOf(service, t);
    return !!tag && tag.startsWith('P');
  };

  for (const c of calls) {
    const service = serviceOf(c.file);
    if (c.factory === 'accumulate' && isProjection(service, c.typename)) {
      errors.push({ rule: 'accumulate-on-projection', typename: c.typename, file: c.file, line: c.line,
        msg: `Projection '${c.typename}' written via accumulate() — projections never accumulate across events` });
    }
    if (tagOf(service, c.typename) === 'P1' && c.factory !== 'projectVersioned') {
      errors.push({ rule: 'p1-without-version-guard', typename: c.typename, file: c.file, line: c.line,
        msg: `Projection<'P1'> '${c.typename}' written via ${c.factory}() — P1 rows must use projectVersioned()` });
    }
  }

  // R3 dual-writer — per (service, typename): a command write and an event-side
  // ONGOING intent in the SAME service. record()-only seed is allowed.
  const seenCmd = new Set();
  for (const cmd of commands) {
    const service = serviceOf(cmd.file);
    const key = `${service}::${cmd.typename}`;
    if (seenCmd.has(key)) continue;
    seenCmd.add(key);
    const ongoing = calls.find(c =>
      c.typename === cmd.typename && serviceOf(c.file) === service && ONGOING_FACTORIES.has(c.factory));
    if (ongoing) {
      errors.push({ rule: 'dual-writer', typename: cmd.typename, file: ongoing.file, line: ongoing.line,
        msg: `'${cmd.typename}' written by a command (${cmd.file}:${cmd.line}) AND an event-side ${ongoing.factory}() in ${service} — dual authority; only the record()-seed pattern may coexist with a command` });
    }
  }

  for (const c of conflicts) {
    errors.push({ rule: 'registry-conflict', typename: c.typename, file: c.files.join(' / '), line: 0,
      msg: `'${c.typename}' registered with conflicting tags ${c.tags.join(' vs ')} within service ${c.service} (${c.files.join(', ')})` });
  }

  // R5 unclassified-write — an intent-factory write that is neither registered
  // nor excluded. Command writes (*.fn.js) are intentionally NOT gated here.
  for (const c of calls) {
    const service = serviceOf(c.file);
    if (registry[service]?.[c.typename]) continue;
    if (exclusions.has(`${service}::${c.typename}`)) continue;
    errors.push({ rule: 'unclassified-write', typename: c.typename, file: c.file, line: c.line,
      msg: `'${c.typename}' written via ${c.factory}() in ${service} is neither registered in a ReadModelOwnership augmentation nor listed in ${EXCLUSIONS_FILE}. Classify it (CommandOwned / Projection<'P1'|'P2'|'P3'>) or, if it is a verified non-governed outbox/carrier/external-feed row, add it to the exclusion registry.` });
  }

  // R6 exclusion-conflict — a (service, typename) both registered AND excluded.
  for (const key of exclusions) {
    const [service, typename] = key.split('::');
    if (registry[service]?.[typename]) {
      errors.push({ rule: 'exclusion-conflict', typename, file: EXCLUSIONS_FILE, line: 0,
        msg: `'${typename}' in ${service} is both registered in ReadModelOwnership AND listed in ${EXCLUSIONS_FILE} — remove one` });
    }
  }

  // INFO — unregistered command writes (gate is intent-factory-scoped; command
  // writes are surfaced for visibility but never errored). After all governed
  // command rows are registered documentarily this list is empty.
  const seen = new Set();
  const info = [];
  for (const c of commands) {
    const service = serviceOf(c.file);
    const key = `${service}::${c.typename}`;
    if (registry[service]?.[c.typename] || exclusions.has(key) || seen.has(key)) continue;
    seen.add(key);
    info.push({ typename: c.typename, file: c.file, line: c.line, factory: 'command' });
  }
  info.sort((a, b) => a.typename.localeCompare(b.typename));

  return { errors, info };
}

function main() {
  const { root } = parseArgs(process.argv);
  const { registry, conflicts } = parseRegistry(root);
  const { exclusions, entries } = parseExclusions(root);
  const calls = scanIntentCalls(root);
  const commands = scanCommandWrites(root);
  const { errors, info } = evaluate(registry, conflicts, calls, commands, exclusions);

  if (info.length) {
    console.log(`read-model-drift: ${info.length} unregistered command-written typename(s) (INFO — command writes are not gated; register documentarily if governed):`);
    for (const i of info) console.log(`  - ${i.typename}  (${i.factory}, ${i.file}:${i.line})`);
    console.log('');
  }

  if (errors.length === 0) {
    const typenameCount = Object.values(registry).reduce((n, svc) => n + Object.keys(svc).length, 0);
    console.log(`read-model-drift: OK (${typenameCount} registered typename(s), ${entries.length} excluded, 0 drift)`);
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
