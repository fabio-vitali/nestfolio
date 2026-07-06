#!/usr/bin/env node
// check-typed-subjects.mjs — typed-subject convention gate (capstone).
//
// Enforces the typed-subject conventions across services + libs `src`:
//   subject-cast        (C1) — `subject … as Record<string,unknown>` / `as <PascalType>`.
//                              parseSubject(carrier, <ProducerSchema>) is the only sanctioned read.
//                              Excludes the parseSubject platform seams (by path) + registry files.
//   cross-domain-import (C2) — a services/<domain>/<svc>/src file importing
//                              @nestfolio/<otherSvc>/{contracts,events} where <otherSvc> is in a
//                              DIFFERENT domain. Cross-domain must route via the producer-domain
//                              `*-adpt/domain` re-export. Intra-domain + `*-adpt/domain` imports
//                              are fine; libs/** + apps/** have no domain (exempt). (nx can't
//                              express this — services are Nx apps, so its apps-forbidden rule
//                              blocks intra-domain imports too.)
//   subject-suffix      (C4) — a contract named `<Name>SubjectSchema` / type `<Name>Subject`
//                              in **/domain/contracts.ts or **/domain/events.ts.
//   opaque-subject           — the `opaqueSubject` identifier reintroduced anywhere in `src`.
//   inline-row          (C3) — a top-level interface/type declaring pk + sk + __typename inline
//                              (not via TableEntry<>). Heuristic regression guard.
//   subject-identity         — identity (tenantId/userId/region) read off the event SUBJECT
//                              (chain `.subject.tenantId`, destructure, or alias-then-read).
//                              Subjects are DRY — identity travels in uow.event.context. Reading
//                              it from the subject yields undefined post-DRY-migration and keys
//                              rows at Decision#undefined#… (the 2026-06-16 happy-path wedge).
//                              Boundary/external events that legitimately carry such a field use
//                              a documented exclusion.
//
// Conventions 3 (full) + 5 (context generic) remain skills/docs only.
//
// Usage: node tools/check-typed-subjects.mjs [--root <dir>]
// Scope: services/**/src + libs/**/src (excludes test dirs + *.test.ts/*.spec.ts).
// No AST dep — string/regex scanning, mirroring tools/check-read-model-drift.mjs.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exclusionsFile } from './lib/exclusions-root.mjs';

const EXCLUDE_FRAGMENTS = ['node_modules', 'dist', 'cdk.out', '.worktrees', '.nx', 'coverage', 'test'];
const EXCLUDED_BASENAME_SUFFIXES = ['.test.ts', '.spec.ts'];
const SCAN_ROOTS = ['services', 'libs'];
const EXCLUSIONS_FILE = exclusionsFile('typed-subject');

// The parseSubject carrier itself reads subject as Record by design.
const PLATFORM_SEAMS = new Set([
  'libs/event-processor/src/util/to-uow.ts',
  'libs/event-processor/src/internal/sqs-parser.ts',
  'libs/event-processor/src/engine/ingestion-engine.ts',
  'libs/event-processor/src/testing/test-harness.ts',
  'libs/event-processor/src/pipelines/broadcast-from-queue.ts',
]);

// C1 — P1: a carrier `.subject` property read consumed via `as` or a `??` nullish fallback
// (the untyped carrier-subject read). P2: any `subject`-token cast to Record<string,unknown>.
// Deliberately NOT matching `typedSubject.field as <SpecificType>` (a typed field narrowing
// on an already-parseSubject'd value — e.g. `subject.proposedTrades as Foo['bar']`).
const SUBJECT_CARRIER_RE = /\.subject\b\s*(?:as\b|\?\?)/g;
const SUBJECT_RECORD_CAST_RE = /(?<![A-Za-z0-9_])subject\b[^\n;=]*?\bas\s+Record<\s*string\s*,\s*unknown\s*>/g;
const SUBJECT_SUFFIX_RE = /export\s+(?:const\s+([A-Za-z0-9_]+SubjectSchema)\b|type\s+([A-Za-z0-9_]+Subject)\b)/g;
const OPAQUE_RE = /\bopaqueSubject\b/g;
const CROSS_DOMAIN_IMPORT_RE = /from\s+['"]@nestfolio\/([a-z0-9-]+)\/(contracts|events)['"]/g;

// subject-identity — identity (tenantId/userId/region) read off the event SUBJECT.
// DRY subjects EXCLUDE identity; it travels in the event CONTEXT (uow.event.context).
// Reading it from the subject yields `undefined` post-DRY-migration and keys rows at
// e.g. Decision#undefined#… (the 2026-06-16 happy-path-decision wedge: decision-snapshot
// keyed off subject.tenantId). Three shapes are caught:
//   (a) direct chain:  <…>.subject.tenantId
//   (b) destructure:    const { tenantId } = <…>.subject
//   (c) alias + read:   const p = <…>.subject; … p.tenantId
const IDENTITY_FIELDS = 'tenantId|userId|region';
const SUBJECT_IDENTITY_CHAIN_RE = new RegExp(`\\.subject\\.(?:${IDENTITY_FIELDS})\\b`, 'g');
const SUBJECT_IDENTITY_DESTRUCTURE_RE = new RegExp(
  `(?:const|let|var)\\s*\\{[^}=]*\\b(?:${IDENTITY_FIELDS})\\b[^}=]*\\}\\s*=\\s*[^=;\\n]*\\.subject\\b`, 'g');
const SUBJECT_ALIAS_RE = /(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*[^=;\n]*\.subject\b/g;

function parseArgs(argv) {
  let root = process.cwd();
  for (let i = 2; i < argv.length; i++) if (argv[i] === '--root') root = argv[++i];
  return { root };
}

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
    const ok = e && typeof e.rule === 'string' && e.rule &&
      typeof e.file === 'string' && e.file &&
      typeof e.reason === 'string' && e.reason.trim();
    if (!ok) throw new Error(`${EXCLUSIONS_FILE}: each entry needs non-empty {rule, file, reason} — bad: ${JSON.stringify(e)}`);
    exclusions.add(`${e.rule}::${e.file}`);
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

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

function inComment(text, index) {
  const open = text.lastIndexOf('/*', index);
  if (open !== -1) { const close = text.indexOf('*/', open); if (close === -1 || close >= index) return true; }
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  if (text.slice(lineStart, index).includes('//')) return true;
  return false;
}

// Build serviceName -> domain from the services/<domain>/<svc>/ layout.
export function buildServiceDomains(root) {
  const map = {};
  let domains;
  try { domains = readdirSync(join(root, 'services'), { withFileTypes: true }); } catch { return map; }
  for (const d of domains) {
    if (!d.isDirectory()) continue;
    let svcs;
    try { svcs = readdirSync(join(root, 'services', d.name), { withFileTypes: true }); } catch { continue; }
    for (const s of svcs) if (s.isDirectory()) map[s.name] = d.name;
  }
  return map;
}

// C3 heuristic: a top-level interface/type whose block (closes with a line starting `}`)
// declares pk + sk + __typename and does not use TableEntry.
function scanInlineRows(rel, text) {
  const lines = text.split('\n');
  const hits = [];
  const declRe = /^\s*(?:export\s+)?(?:interface\s+([A-Za-z0-9_]+)|type\s+([A-Za-z0-9_]+)\s*=)[^{]*\{\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(declRe);
    if (!m) continue;
    const name = m[1] || m[2];
    let block = lines[i];
    let j = i + 1;
    for (; j < lines.length && j < i + 200; j++) { block += '\n' + lines[j]; if (/^\}/.test(lines[j])) break; }
    const has = (k) => new RegExp('(^|\\n)\\s*' + k + '\\s*\\??:').test(block);
    if (has('pk') && has('sk') && has('__typename') && !/\bTableEntry\b/.test(block)) {
      hits.push({ rule: 'inline-row', file: rel, line: i + 1,
        msg: `row type \`${name}\` re-declares pk/sk/__typename inline — use TableEntry<Subject> (reuse the producer contract)` });
    }
  }
  return hits;
}

// subject-identity heuristic: identity fields read off the event subject (see the
// regex block above). String-scan, no AST — mirrors the rest of this gate.
export function scanSubjectIdentity(rel, text) {
  const hits = [];
  const seenLines = new Set();
  const push = (index, snippet) => {
    if (inComment(text, index)) return;
    const line = lineOf(text, index);
    if (seenLines.has(line)) return;
    seenLines.add(line);
    hits.push({ rule: 'subject-identity', file: rel, line,
      msg: `identity read off the event subject (\`${snippet.trim()}\`) — subjects are DRY; read tenantId/userId/region from uow.event.context, not the subject` });
  };
  let m;
  SUBJECT_IDENTITY_CHAIN_RE.lastIndex = 0;
  while ((m = SUBJECT_IDENTITY_CHAIN_RE.exec(text)) !== null) push(m.index, m[0]);
  SUBJECT_IDENTITY_DESTRUCTURE_RE.lastIndex = 0;
  while ((m = SUBJECT_IDENTITY_DESTRUCTURE_RE.exec(text)) !== null) push(m.index, m[0]);
  // alias + read: collect `const p = <…>.subject` aliases, then flag `p.<identity>`.
  SUBJECT_ALIAS_RE.lastIndex = 0;
  const aliases = [];
  while ((m = SUBJECT_ALIAS_RE.exec(text)) !== null) {
    if (!inComment(text, m.index)) aliases.push(m[1]);
  }
  for (const alias of aliases) {
    const aliasRe = new RegExp(`\\b${alias}\\.(?:${IDENTITY_FIELDS})\\b`, 'g');
    let am;
    while ((am = aliasRe.exec(text)) !== null) push(am.index, am[0]);
  }
  return hits;
}

export function scanFile(rel, text) {
  const hits = [];
  // C1 subject-cast: P1 (carrier .subject read with as/??) OR P2 (subject cast to Record<string,unknown>).
  const subjectCastSeen = new Set();
  for (const re of [SUBJECT_CARRIER_RE, SUBJECT_RECORD_CAST_RE]) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text)) !== null) {
      if (inComment(text, m.index)) continue;
      const line = lineOf(text, m.index);
      if (subjectCastSeen.has(line)) continue;
      subjectCastSeen.add(line);
      hits.push({ rule: 'subject-cast', file: rel, line,
        msg: `untyped subject read \`${m[0].trim()}\` — parse it with parseSubject(carrier, <ProducerSchema>) instead` });
    }
  }
  let m;
  if (rel.endsWith('/domain/contracts.ts') || rel.endsWith('/domain/events.ts') || rel.endsWith('/contracts.ts')) {
    SUBJECT_SUFFIX_RE.lastIndex = 0;
    while ((m = SUBJECT_SUFFIX_RE.exec(text)) !== null) {
      const name = m[1] || m[2];
      hits.push({ rule: 'subject-suffix', file: rel, line: lineOf(text, m.index),
        msg: `contract \`${name}\` uses a Subject suffix — name it after the clean domain/event concept (<Name>Schema / <Name>)` });
    }
  }
  OPAQUE_RE.lastIndex = 0;
  while ((m = OPAQUE_RE.exec(text)) !== null) {
    if (inComment(text, m.index)) continue;
    hits.push({ rule: 'opaque-subject', file: rel, line: lineOf(text, m.index),
      msg: `opaqueSubject reintroduced — every event has a producer schema; use parseSubject(...) (the helper was deleted in WS-3)` });
  }
  hits.push(...scanInlineRows(rel, text));
  hits.push(...scanSubjectIdentity(rel, text));
  return hits;
}

// Convention 2 — cross-domain import channel. Only for services/<domain>/<svc>/ files.
export function scanCrossDomainImports(rel, text, serviceDomains) {
  const hits = [];
  const m0 = rel.match(/^services\/([^/]+)\/([^/]+)\//);
  if (!m0) return hits;
  const fileDomain = m0[1];
  CROSS_DOMAIN_IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = CROSS_DOMAIN_IMPORT_RE.exec(text)) !== null) {
    const pkg = m[1], sub = m[2];
    const pkgDomain = serviceDomains[pkg];
    if (!pkgDomain || pkgDomain === fileDomain) continue;
    hits.push({ rule: 'cross-domain-import', file: rel, line: lineOf(text, m.index),
      msg: `cross-domain import \`@nestfolio/${pkg}/${sub}\` — route it through the producer-domain adapter \`@nestfolio/${pkgDomain}-adpt/domain\` instead (convention 2)` });
  }
  return hits;
}

export function scanTree(root) {
  const hits = [];
  const serviceDomains = buildServiceDomains(root);
  for (const sub of SCAN_ROOTS) {
    for (const file of walk(join(root, sub))) {
      if (!file.endsWith('.ts')) continue;
      if (EXCLUDED_BASENAME_SUFFIXES.some(s => file.endsWith(s))) continue;
      const rel = relative(root, file).split(sep).join('/');
      if (!rel.includes('/src/')) continue;
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      hits.push(...scanFile(rel, text));
      hits.push(...scanCrossDomainImports(rel, text, serviceDomains));
    }
  }
  return hits;
}

export function evaluate(hits, exclusions = new Set()) {
  return hits.filter(h => {
    if (h.rule === 'subject-cast' && PLATFORM_SEAMS.has(h.file)) return false;
    if (exclusions.has(`${h.rule}::${h.file}`)) return false;
    return true;
  });
}

function main() {
  const { root } = parseArgs(process.argv);
  const { exclusions, entries } = parseExclusions(root);
  const hits = scanTree(root);
  const errors = evaluate(hits, exclusions);
  if (errors.length === 0) {
    console.log(`typed-subject: OK (${hits.length} raw hit(s), ${entries.length} excluded, 0 violation(s))`);
    process.exit(0);
  }
  console.error('typed-subject: FAIL');
  console.error(`Found ${errors.length} typed-subject convention violation(s). See docs/agent-system.md + the project_event_subject_contracts dossier.\n`);
  for (const e of errors) {
    console.error(`  [${e.rule}] ${e.file}:${e.line}`);
    console.error(`    ${e.msg}`);
  }
  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
