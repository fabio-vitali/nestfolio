#!/usr/bin/env node
// check-service-card-drift.mjs — deterministic CLAUDE.md service-card-drift gate.
//
// Renders the machine-derivable card sections from each service's
// service.stack.ts + domain/events.ts (via the typescript compiler AST) and
// enforces that the committed card matches. `--fix` rewrites the blocks.
// Prose/intent sections are LLM-owned and never touched (the tool only ever
// reads/writes between its own `card-drift:*` markers).
//
// Mirrors tools/check-read-model-drift.mjs: exported pure functions, an
// exclusion registry, node:test tmpdir tests, an nx target + pre-commit hook.
//
// Usage: node tools/check-service-card-drift.mjs [--root <dir>] [--fix]

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const SECTION_IDS = ['event-types', 'ingress', 'egress', 'handlers', 'ddb-entities'];

const EXCLUSIONS_FILE = 'tools/service-card-exclusions.json';
const EXCLUDE_DIR_FRAGMENTS = ['node_modules', 'dist', 'cdk.out', '.nx', '.worktrees', 'coverage', 'test'];

function parseArgs(argv) {
  let root = process.cwd();
  let fix = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--fix') fix = true;
  }
  return { root, fix };
}

// Parse the exclusion registry → Set of "service::section" (or "service::*").
// Absent file → empty. Malformed entries throw.
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
      typeof e.reason === 'string' && e.reason.trim() &&
      (e.section === undefined || (typeof e.section === 'string' && SECTION_IDS.includes(e.section)));
    if (!ok) throw new Error(`${EXCLUSIONS_FILE}: each entry needs {service, reason} with optional section ∈ ${SECTION_IDS.join('|')} — bad entry: ${JSON.stringify(e)}`);
    exclusions.add(`${e.service}::${e.section ?? '*'}`);
  }
  return { exclusions, entries };
}

export function isExcluded(exclusions, service, section) {
  return exclusions.has(`${service}::*`) || exclusions.has(`${service}::${section}`);
}

// --- typescript AST helpers -------------------------------------------------

function sourceFileOf(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);
}

// Unwrap `<expr> as const` / `<expr> as T`.
function unwrapAs(node) {
  return ts.isAsExpression(node) ? unwrapAs(node.expression) : node;
}

// `eventName('WIRE')` → 'WIRE', else null.
function eventNameArg(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'eventName' && node.arguments.length >= 1 &&
      ts.isStringLiteral(node.arguments[0])) {
    return node.arguments[0].text;
  }
  return null;
}

// Property name as plain text (handles 'quoted' and bare identifiers).
function propName(prop) {
  const n = prop.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return null;
}

// Exposed only for tests (build a SourceFile without re-reading conventions).
export function _sourceFileForTest(path) { return sourceFileOf(path); }

// Walk a subtree; collect resolved wire names for every `Const.KEY` ref.
// Falls back to the bare KEY when the ref is not in `resolve` (covers the
// 288/294 key===wire convention for any cross-lib const not in this events.ts).
function collectEventRefs(node, resolve) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) &&
        /EventTypes$/.test(n.expression.text)) {
      const k = `${n.expression.text}.${n.name.text}`;
      out.add(resolve.get(k) ?? n.name.text);
    } else if (ts.isIdentifier(n) &&
        !(n.parent && ts.isPropertyAccessExpression(n.parent)) &&
        resolve.has(n.text)) {
      out.add(resolve.get(n.text));
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return [...out].sort();
}

// Find all `new <Ctor>(...)` NewExpressions in a SourceFile.
function findNewExprs(sf, ctorName) {
  const out = [];
  const visit = (n) => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === ctorName) {
      out.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// The config object literal of a construct `new Ctor(scope, id, { ...config })`.
function configObjOf(newExpr) {
  const arg = (newExpr.arguments ?? []).find(a => ts.isObjectLiteralExpression(a));
  return arg ?? null;
}

// Get a named property's initializer from an object literal.
function getProp(objLit, name) {
  if (!objLit) return null;
  for (const p of objLit.properties) {
    if (ts.isPropertyAssignment(p) && propName(p) === name) return p.initializer;
  }
  return null;
}

// Egress: each top-level key of the `eventTypes` object is an entity; collect
// every resolvable event ref in that entity's value subtree.
export function extractEgress(sf, resolve) {
  const out = [];
  for (const ne of findNewExprs(sf, 'Egress')) {
    const eventTypes = getProp(configObjOf(ne), 'eventTypes');
    if (!eventTypes || !ts.isObjectLiteralExpression(eventTypes)) continue;
    for (const prop of eventTypes.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const entity = propName(prop);
      if (!entity) continue;
      out.push({ entity, events: collectEventRefs(prop.initializer, resolve) });
    }
  }
  out.sort((a, b) => a.entity.localeCompare(b.entity));
  return out;
}

// Map of `const NAME = [ ... ]` array declarations anywhere in a SourceFile
// (top-level OR inside the class constructor, where real stacks declare them).
function localArrayConsts(sf) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) &&
        n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
      map.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

// The string id of `new Ctor(scope, 'Id', { ... })` (2nd arg).
function constructId(newExpr) {
  const a = newExpr.arguments?.[1];
  return a && ts.isStringLiteral(a) ? a.text : null;
}

// Last path segment of an `entry: join(__dirname, 'handlers', 'x.ts')` value.
function entryFilename(entryNode) {
  if (!entryNode) return null;
  let last = null;
  const visit = (n) => {
    if (ts.isStringLiteral(n) && n.text.endsWith('.ts')) last = basename(n.text);
    ts.forEachChild(n, visit);
  };
  visit(entryNode);
  return last;
}

// Resolve an `eventTypes:` value (inline array OR identifier→local const array)
// to a sorted wire set.
function resolveEventTypesValue(node, resolve, localConsts) {
  if (!node) return [];
  if (ts.isIdentifier(node) && localConsts.has(node.text)) {
    return collectEventRefs(localConsts.get(node.text), resolve);
  }
  return collectEventRefs(node, resolve);
}

export function extractIngress(sf, resolve) {
  const localConsts = localArrayConsts(sf);
  const out = [];
  for (const ne of findNewExprs(sf, 'Ingress')) {
    const cfg = configObjOf(ne);
    const label = constructId(ne) ?? '(anonymous)';
    const handler = entryFilename(getProp(cfg, 'entry'));
    const events = resolveEventTypesValue(getProp(cfg, 'eventTypes'), resolve, localConsts);
    out.push({ label, handler, events });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

// Adapter forwarding: `new Rule(this, 'Id', { eventPattern: { detailType: [...] } })`.
// detailType is an inline array or an identifier → local const array.
export function extractForwarding(sf, resolve) {
  const localConsts = localArrayConsts(sf);
  const out = [];
  for (const ne of findNewExprs(sf, 'Rule')) {
    const cfg = configObjOf(ne);
    const pattern = getProp(cfg, 'eventPattern');
    if (!pattern || !ts.isObjectLiteralExpression(pattern)) continue;
    const detailType = getProp(pattern, 'detailType');
    const events = resolveEventTypesValue(detailType, resolve, localConsts);
    if (!events.length) continue; // not an event-forwarding rule
    out.push({ label: constructId(ne) ?? '(rule)', handler: null, events });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

const FACTORY_RE = /(?<![.\w])(projectVersioned|updateOrRetry|project|accumulate|update|record)\s*\(\s*['"]([A-Za-z0-9_]+)['"]/g;

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (EXCLUDE_DIR_FRAGMENTS.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

// All handler filenames declared via `entry:` across constructs in the stack.
export function extractHandlers(sf) {
  const out = new Set();
  for (const ctor of ['Ingress', 'Egress', 'NodejsFunction']) {
    for (const ne of findNewExprs(sf, ctor)) {
      const f = entryFilename(getProp(configObjOf(ne), 'entry'));
      if (f) out.add(f);
    }
  }
  return [...out].sort();
}

// Intent-factory write typenames under a src dir (regex, mirrors read-model-drift).
export function scanWriteTypenames(srcDir) {
  const out = new Set();
  for (const file of walk(srcDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    FACTORY_RE.lastIndex = 0;
    let m;
    while ((m = FACTORY_RE.exec(text)) !== null) out.add(m[2]);
  }
  return [...out].sort();
}

export function parseStack(stackTsPath, resolve) {
  const sf = sourceFileOf(stackTsPath);
  if (!sf) return { ingress: [], egress: [], handlers: [], egressEntities: [] };
  const egress = extractEgress(sf, resolve);
  return {
    ingress: [...extractIngress(sf, resolve), ...extractForwarding(sf, resolve)]
      .sort((a, b) => a.label.localeCompare(b.label)),
    egress,
    handlers: extractHandlers(sf),
    egressEntities: egress.map(e => e.entity),
  };
}

// Full per-service model. serviceDir = services/<domain>/<service>.
export function buildModel(serviceDir) {
  const { groups, resolve } = parseEvents(join(serviceDir, 'src/domain/events.ts'));
  const stack = parseStack(join(serviceDir, 'src/service.stack.ts'), resolve);
  const writes = scanWriteTypenames(join(serviceDir, 'src'));
  const ddbEntities = [...new Set([...stack.egressEntities, ...writes])].sort();
  return { eventTypes: groups, ingress: stack.ingress, egress: stack.egress, handlers: stack.handlers, ddbEntities };
}

// Parse domain/events.ts: every `export const <Name> = { KEY: eventName('WIRE') } as const`.
export function parseEvents(eventsTsPath) {
  const groups = [];
  const resolve = new Map();
  const bareEntries = [];
  const sf = sourceFileOf(eventsTsPath);
  if (!sf) return { groups, resolve };
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isExport = (stmt.modifiers ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExport) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const constName = decl.name.text;
      const obj = unwrapAs(decl.initializer);
      // Bare top-level event const: `export const X = eventName('Y')`.
      const bareWire = eventNameArg(obj);
      if (bareWire) {
        bareEntries.push({ key: constName, wire: bareWire });
        resolve.set(constName, bareWire);
        continue;
      }
      if (!ts.isObjectLiteralExpression(obj)) continue;
      const entries = [];
      for (const prop of obj.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = propName(prop);
        const wire = eventNameArg(prop.initializer);
        if (key && wire) {
          entries.push({ key, wire });
          resolve.set(`${constName}.${key}`, wire);
        }
      }
      if (entries.length) groups.push({ constName, entries });
    }
  }
  if (bareEntries.length) {
    bareEntries.sort((a, b) => a.key.localeCompare(b.key));
    groups.push({ constName: '(top-level exports)', entries: bareEntries });
  }
  return { groups, resolve };
}

// ---------------------------------------------------------------------------
// Rendering + marker layer
// ---------------------------------------------------------------------------

const FIX_HINT = '`nx run event-processor:card-drift -- --fix`';

function renderEventTypes(model) {
  return [...model.eventTypes]
    .sort((a, b) => a.constName.localeCompare(b.constName))
    .map(g => {
      const items = [...g.entries]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(e => e.wire === e.key ? e.key : `${e.key} (${e.wire})`);
      return `- ${g.constName}: ${items.join(', ')}`;
    }).join('\n');
}

function renderInbound(list) {
  return [...list].sort((a, b) => a.label.localeCompare(b.label)).map(i => {
    const head = i.handler ? `${i.label} (${i.handler})` : i.label;
    return `- ${head}: ${i.events.join(', ')}`;
  }).join('\n');
}

function renderEgress(model) {
  return [...model.egress].sort((a, b) => a.entity.localeCompare(b.entity))
    .map(e => `- ${e.entity}: ${e.events.join(', ')}`).join('\n');
}

function renderList(items) {
  return [...items].sort().map(x => `- ${x}`).join('\n');
}

export function renderBlock(section, model) {
  switch (section) {
    case 'event-types': return renderEventTypes(model);
    case 'ingress': return renderInbound(model.ingress);
    case 'egress': return renderEgress(model);
    case 'handlers': return renderList(model.handlers);
    case 'ddb-entities': return renderList(model.ddbEntities);
    default: throw new Error(`unknown section ${section}`);
  }
}

export function wrapBlock(section, body) {
  return `<!-- card-drift:${section} (generated — ${FIX_HINT}) -->\n${body}\n<!-- /card-drift:${section} -->`;
}

// Find every card-drift block. Start marker tolerates trailing hint text.
export function locateBlocks(cardText) {
  const map = new Map();
  for (const section of SECTION_IDS) {
    const re = new RegExp(`<!--\\s*card-drift:${section}\\b[^>]*-->\\n?([\\s\\S]*?)\\n?<!--\\s*/card-drift:${section}\\s*-->`);
    const m = re.exec(cardText);
    if (m) map.set(section, { full: m[0], body: m[1].replace(/\s+$/, '') });
  }
  return map;
}
