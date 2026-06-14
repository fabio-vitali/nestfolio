# Service-Card Drift Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic gate that renders the machine-derivable sections of every service's `CLAUDE.md` card from `service.stack.ts` + `domain/events.ts` and fails CI when the committed card drifts from the rendered truth.

**Architecture:** A pure-Node ESM tool, `tools/check-service-card-drift.mjs`, parses each service's stack + events via the existing `typescript` compiler AST, renders five marker-delimited blocks (`event-types`, `ingress`, `egress`, `handlers`, `ddb-entities`), and compares them to the committed card. `--fix` rewrites the blocks in place. It mirrors the shape of `tools/check-read-model-drift.mjs` (exported pure functions, `node:test` tmpdir tests, an exclusion registry, an `event-processor:*` nx target, and a pre-commit check).

**Tech Stack:** Node ESM, `typescript` (~5.9.3, already a devDependency) compiler API, `node:test`, nx run-commands target, bash pre-commit hook.

**Spec:** `docs/superpowers/specs/2026-06-14-service-card-drift-gate-design.md`

---

## Data model (used across tasks)

These shapes are produced/consumed by the functions below. Keep names exact.

```text
parseEvents(eventsTsPath) → {
  groups:  [ { constName: string, entries: [ { key: string, wire: string } ] } ],   // for the event-types block
  resolve: Map<string,string>                                                        // "ConstName.KEY" → wire
}

parseStack(stackTsPath, resolve) → {
  ingress:       [ { label: string, handler: string|null, events: string[] } ],      // Ingress constructs + forwarding Rules
  egress:        [ { entity: string, events: string[] } ],
  handlers:      string[],                                                            // handler filenames
  egressEntities:string[]                                                             // Egress entity keys (feed ddb-entities)
}

scanWriteTypenames(srcDir) → string[]                                                 // intent-factory write typenames

buildModel(serviceDir) → {
  eventTypes:  groups,
  ingress:     [...],
  egress:      [...],
  handlers:    string[],
  ddbEntities: string[]                                                               // egressEntities ∪ write typenames, sorted-unique
}

SECTION_IDS = ['event-types','ingress','egress','handlers','ddb-entities']
renderBlock(section, model) → string                                                 // BODY only, no markers
wrapBlock(section, body) → string                                                    // body wrapped in start/end markers
locateBlocks(cardText) → Map<section, { full:string, body:string }>
parseExclusions(root) → { exclusions:Set<"service::section">, entries:[...] }
evaluate(services, exclusions) → { errors:[{service,section,kind,detail}], fixes:[{cardPath,newText}] }
```

Block format (start marker tolerant of any trailing hint text; only the BODY is compared on check):

```text
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- FundingEvent: DEPOSIT_DETECTED, DEPOSIT_FAILED, DEPOSIT_REQUESTED, ...
- NormalizedEvent: ORDER_CANCELLED, ORDER_ESCALATED, ORDER_FILLED, ...
<!-- /card-drift:egress -->
```

---

## Task 1: Tool skeleton + constants + exclusion-registry parser

**Files:**
- Create: `tools/check-service-card-drift.mjs`
- Create: `tools/service-card-exclusions.json`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Create the empty exclusion registry**

`tools/service-card-exclusions.json`:

```json
{
  "$comment": "Service-card drift EXCLUSION registry. Each entry opts a (service[, section]) out of the card-drift gate (tools/check-service-card-drift.mjs). Omit 'section' to exclude the whole service; include it to exclude one section. 'reason' is mandatory and non-empty. See docs/superpowers/specs/2026-06-14-service-card-drift-gate-design.md. Keep alphabetised by service then section.",
  "exclusions": []
}
```

- [ ] **Step 2: Write the tool skeleton with constants + `parseExclusions`**

`tools/check-service-card-drift.mjs`:

```js
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
```

- [ ] **Step 3: Write the failing test for `parseExclusions`**

`tools/check-service-card-drift.test.mjs`:

```js
// node:test sibling for check-service-card-drift.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseExclusions, isExcluded, SECTION_IDS,
} from './check-service-card-drift.mjs';

const SCRIPT = join(process.cwd(), 'tools/check-service-card-drift.mjs');

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-carddrift-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return root;
}
function withTree(files, fn) {
  const root = makeTree(files);
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('parseExclusions: whole-service and per-section', () => {
  withTree({
    'tools/service-card-exclusions.json': JSON.stringify({ exclusions: [
      { service: 'investor-web', reason: 'frontend stack — no event constructs' },
      { service: 'foo-ctrl', section: 'ddb-entities', reason: 'internal-only rows' },
    ]}),
  }, (root) => {
    const { exclusions } = parseExclusions(root);
    assert.ok(isExcluded(exclusions, 'investor-web', 'ingress'));
    assert.ok(isExcluded(exclusions, 'foo-ctrl', 'ddb-entities'));
    assert.ok(!isExcluded(exclusions, 'foo-ctrl', 'ingress'));
  });
});

test('parseExclusions: bad section rejected', () => {
  withTree({
    'tools/service-card-exclusions.json': JSON.stringify({ exclusions: [
      { service: 'x', section: 'not-a-section', reason: 'y' },
    ]}),
  }, (root) => {
    assert.throws(() => parseExclusions(root), /bad entry/);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/service-card-exclusions.json tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): tool skeleton + exclusion registry"
```

---

## Task 2: `parseEvents` — events.ts const → key→wire map

**Files:**
- Modify: `tools/check-service-card-drift.mjs`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
import { parseEvents } from './check-service-card-drift.mjs';

const EVENTS_TS = `
import { eventName } from '@nestfolio/event-types';
export const FooEventTypes = {
  ORDER_FILLED: eventName('ORDER_FILLED'),
  FETCH_REQUESTED: eventName('FETCH_FOO_REQUESTED'),
} as const;
export const FooInboundEventTypes = {
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
} as const;
`;

test('parseEvents: groups + key≠wire resolution', () => {
  withTree({ 'services/d/foo-ctrl/src/domain/events.ts': EVENTS_TS }, (root) => {
    const { groups, resolve } = parseEvents(join(root, 'services/d/foo-ctrl/src/domain/events.ts'));
    assert.deepEqual(groups.map(g => g.constName).sort(), ['FooEventTypes', 'FooInboundEventTypes']);
    const foo = groups.find(g => g.constName === 'FooEventTypes');
    assert.deepEqual(foo.entries.find(e => e.key === 'FETCH_REQUESTED'), { key: 'FETCH_REQUESTED', wire: 'FETCH_FOO_REQUESTED' });
    assert.equal(resolve.get('FooEventTypes.ORDER_FILLED'), 'ORDER_FILLED');
    assert.equal(resolve.get('FooInboundEventTypes.EXECUTION_MODE_CHANGED'), 'EXECUTION_MODE_CHANGED');
  });
});

test('parseEvents: absent file → empty', () => {
  const { groups, resolve } = parseEvents('/no/such/events.ts');
  assert.deepEqual(groups, []);
  assert.equal(resolve.size, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: FAIL — `parseEvents is not a function`.

- [ ] **Step 3: Implement `parseEvents` + AST helpers**

Append to `tools/check-service-card-drift.mjs`:

```js
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

// Parse domain/events.ts: every `export const <Name> = { KEY: eventName('WIRE') } as const`.
export function parseEvents(eventsTsPath) {
  const groups = [];
  const resolve = new Map();
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
  return { groups, resolve };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): parseEvents (key→wire resolution)"
```

---

## Task 3: Stack AST core — `collectEventRefs` + `extractEgress`

**Files:**
- Modify: `tools/check-service-card-drift.mjs`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
import { extractEgress, parseEvents as _pe } from './check-service-card-drift.mjs';

const EVENTS_FOR_STACK = `
import { eventName } from '@nestfolio/event-types';
export const FooEventTypes = {
  ORDER_FILLED: eventName('ORDER_FILLED'),
  DEPOSIT_REQUESTED: eventName('DEPOSIT_REQUESTED'),
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
} as const;
`;

const STACK_EGRESS = `
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'NormalizedEvent': { insert: { field: 'sk', passthrough: true, emits: [
      FooEventTypes.ORDER_FILLED,
    ]}},
    'FundingEvent': { insert: { field: 'sk', passthrough: true, emits: [
      FooEventTypes.DEPOSIT_REQUESTED,
    ]}},
    'DepositIntent': { insert: FooEventTypes.DEPOSIT_INITIATED },
  },
});
`;

test('extractEgress: entity → emitted wire set (incl. insert: shorthand)', () => {
  withTree({
    'svc/src/domain/events.ts': EVENTS_FOR_STACK,
    'svc/src/service.stack.ts': STACK_EGRESS,
  }, (root) => {
    const { resolve } = _pe(join(root, 'svc/src/domain/events.ts'));
    const sf = sourceFileForTest(join(root, 'svc/src/service.stack.ts'));
    const egress = extractEgress(sf, resolve);
    assert.deepEqual(egress, [
      { entity: 'DepositIntent', events: ['DEPOSIT_INITIATED'] },
      { entity: 'FundingEvent', events: ['DEPOSIT_REQUESTED'] },
      { entity: 'NormalizedEvent', events: ['ORDER_FILLED'] },
    ]);
  });
});
```

Add this helper near the top of the test file (after `withTree`):

```js
import { _sourceFileForTest as sourceFileForTest } from './check-service-card-drift.mjs';
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: FAIL — `extractEgress is not a function`.

- [ ] **Step 3: Implement `collectEventRefs`, `findNewExpr`, `getProp`, `extractEgress`, and the test export**

Append to `tools/check-service-card-drift.mjs`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): extractEgress + collectEventRefs"
```

---

## Task 4: `extractIngress` — Ingress constructs + helper-const arrays

**Files:**
- Modify: `tools/check-service-card-drift.mjs`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
import { extractIngress } from './check-service-card-drift.mjs';

const STACK_INGRESS = `
const modeIngress = new Ingress(this, 'ModeIngress', {
  state,
  eventTypes: [FooInboundEventTypes.EXECUTION_MODE_CHANGED],
  entry: join(__dirname, 'handlers', 'mode-listener.ts'),
});
const CALLBACK_EVENT_TYPES = [
  FooInboundEventTypes.SIM_ORDER_FILLED,
  FooInboundEventTypes.SIM_ORDER_REJECTED,
];
const cb = new Ingress(this, 'CallbackIngress', {
  state,
  eventTypes: CALLBACK_EVENT_TYPES,
  entry: join(__dirname, 'handlers', 'callback-resolver.ts'),
});
`;

const EVENTS_INGRESS = `
import { eventName } from '@nestfolio/event-types';
export const FooInboundEventTypes = {
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
  SIM_ORDER_FILLED: eventName('SIM_ORDER_FILLED'),
  SIM_ORDER_REJECTED: eventName('SIM_ORDER_REJECTED'),
} as const;
`;

test('extractIngress: inline array + helper-const array, handler filenames', () => {
  withTree({
    'svc/src/domain/events.ts': EVENTS_INGRESS,
    'svc/src/service.stack.ts': STACK_INGRESS,
  }, (root) => {
    const { resolve } = _pe(join(root, 'svc/src/domain/events.ts'));
    const sf = sourceFileForTest(join(root, 'svc/src/service.stack.ts'));
    const ingress = extractIngress(sf, resolve);
    assert.deepEqual(ingress, [
      { label: 'CallbackIngress', handler: 'callback-resolver.ts', events: ['SIM_ORDER_FILLED', 'SIM_ORDER_REJECTED'] },
      { label: 'ModeIngress', handler: 'mode-listener.ts', events: ['EXECUTION_MODE_CHANGED'] },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: FAIL — `extractIngress is not a function`.

- [ ] **Step 3: Implement local-const resolution + `constructId` + `entryFilename` + `extractIngress`**

Append:

```js
// Map of local `const NAME = [ ... ]` array declarations in a SourceFile.
function localArrayConsts(sf) {
  const map = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
        map.set(decl.name.text, decl.initializer);
      }
    }
  }
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
function resolveEventTypesValue(node, sf, resolve, localConsts) {
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
    const events = resolveEventTypesValue(getProp(cfg, 'eventTypes'), sf, resolve, localConsts);
    out.push({ label, handler, events });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): extractIngress (inline + helper-const arrays)"
```

---

## Task 5: `extractForwarding` — adapter `Rule` detail-type arrays

**Files:**
- Modify: `tools/check-service-card-drift.mjs`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
import { extractForwarding } from './check-service-card-drift.mjs';

const EVENTS_FWD = `
import { eventName } from '@nestfolio/event-types';
export const InvestorIngestEventTypes = {
  ORDER_FILLED: eventName('ORDER_FILLED'),
  DEPOSIT_REQUESTED: eventName('DEPOSIT_REQUESTED'),
} as const;
`;
const STACK_FWD = `
const fromExecutionEvents = [
  InvestorIngestEventTypes.ORDER_FILLED,
  InvestorIngestEventTypes.DEPOSIT_REQUESTED,
];
const r = new Rule(this, 'InvestorIngress-FromExecution', {
  eventBus: executionBus,
  eventPattern: { detailType: fromExecutionEvents },
  targets: [new EventBusTarget(investorBus)],
});
`;

test('extractForwarding: Rule detailType array → forwarded wire set', () => {
  withTree({
    'svc/src/domain/events.ts': EVENTS_FWD,
    'svc/src/service.stack.ts': STACK_FWD,
  }, (root) => {
    const { resolve } = _pe(join(root, 'svc/src/domain/events.ts'));
    const sf = sourceFileForTest(join(root, 'svc/src/service.stack.ts'));
    const fwd = extractForwarding(sf, resolve);
    assert.deepEqual(fwd, [
      { label: 'InvestorIngress-FromExecution', handler: null, events: ['DEPOSIT_REQUESTED', 'ORDER_FILLED'] },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: FAIL — `extractForwarding is not a function`.

- [ ] **Step 3: Implement `extractForwarding`**

Append:

```js
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
    const events = resolveEventTypesValue(detailType, sf, resolve, localConsts);
    if (!events.length) continue; // not an event-forwarding rule
    out.push({ label: constructId(ne) ?? '(rule)', handler: null, events });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): extractForwarding (adapter Rule detailType)"
```

---

## Task 6: `extractHandlers`, `scanWriteTypenames`, `parseStack`, `buildModel`

**Files:**
- Modify: `tools/check-service-card-drift.mjs`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
import { parseStack, scanWriteTypenames, buildModel } from './check-service-card-drift.mjs';

test('scanWriteTypenames: intent-factory write literals', () => {
  withTree({
    'svc/src/handlers/h.ts': `
      project('BrokerOrder', x);
      record('FundingEvent', y);
      accumulate('NormalizedEvent', z);
      const s = obj.update('NotAFactoryMethod'); // method call, not factory
    `,
  }, (root) => {
    const got = scanWriteTypenames(join(root, 'svc/src'));
    assert.deepEqual(got.sort(), ['BrokerOrder', 'FundingEvent', 'NormalizedEvent']);
  });
});

test('parseStack + buildModel: ddb-entities = egress keys ∪ write typenames', () => {
  withTree({
    'svc/src/domain/events.ts': EVENTS_FOR_STACK,
    'svc/src/service.stack.ts': STACK_EGRESS + `
      const fn = new Ingress(this, 'In', { state, eventTypes: [], entry: join(__dirname,'handlers','x.ts') });`,
    'svc/src/handlers/x.ts': `record('ExtraRow', a);`,
  }, (root) => {
    const model = buildModel(join(root, 'svc'));
    assert.deepEqual(model.handlers, ['x.ts']);
    assert.deepEqual(model.ddbEntities, ['DepositIntent', 'ExtraRow', 'FundingEvent', 'NormalizedEvent']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: FAIL — `parseStack is not a function`.

- [ ] **Step 3: Implement handlers scan, write-typename scan, `parseStack`, `buildModel`**

Append:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): parseStack + buildModel (handlers, ddb-entities)"
```

---

## Task 7: `renderBlock`, `wrapBlock`, `locateBlocks`

**Files:**
- Modify: `tools/check-service-card-drift.mjs`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
import { renderBlock, wrapBlock, locateBlocks } from './check-service-card-drift.mjs';

const MODEL = {
  eventTypes: [{ constName: 'FooEventTypes', entries: [
    { key: 'ORDER_FILLED', wire: 'ORDER_FILLED' },
    { key: 'FETCH_REQUESTED', wire: 'FETCH_FOO_REQUESTED' },
  ]}],
  ingress: [{ label: 'ModeIngress', handler: 'mode-listener.ts', events: ['EXECUTION_MODE_CHANGED'] }],
  egress: [{ entity: 'NormalizedEvent', events: ['ORDER_FILLED'] }],
  handlers: ['mode-listener.ts'],
  ddbEntities: ['NormalizedEvent'],
};

test('renderBlock: event-types shows KEY and KEY (WIRE)', () => {
  assert.equal(renderBlock('event-types', MODEL),
    '- FooEventTypes: FETCH_REQUESTED (FETCH_FOO_REQUESTED), ORDER_FILLED');
});

test('renderBlock: ingress with handler', () => {
  assert.equal(renderBlock('ingress', MODEL),
    '- ModeIngress (mode-listener.ts): EXECUTION_MODE_CHANGED');
});

test('locateBlocks: tolerates hint text in start marker, captures body', () => {
  const card = [
    '## Egress',
    wrapBlock('egress', '- NormalizedEvent: ORDER_FILLED'),
    'prose after',
  ].join('\n');
  const blocks = locateBlocks(card);
  assert.equal(blocks.get('egress').body, '- NormalizedEvent: ORDER_FILLED');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: FAIL — `renderBlock is not a function`.

- [ ] **Step 3: Implement rendering + marker handling**

Append:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): renderBlock + locateBlocks"
```

---

## Task 8: `expectedSections`, `applyFix`, `evaluate`

**Files:**
- Modify: `tools/check-service-card-drift.mjs`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
import { expectedSections, applyFix, evaluate } from './check-service-card-drift.mjs';

test('expectedSections: only sections with a source signal', () => {
  assert.deepEqual(expectedSections(MODEL).sort(),
    ['ddb-entities', 'egress', 'event-types', 'handlers', 'ingress']);
  const hub = { eventTypes: [], ingress: [], egress: [], handlers: [], ddbEntities: [] };
  assert.deepEqual(expectedSections(hub), []);
});

test('applyFix: inserts block under matching heading', () => {
  const card = '# foo-ctrl\n\n## Egress\n\nprose\n';
  const out = applyFix(card, 'egress', '- NormalizedEvent: ORDER_FILLED');
  assert.match(out, /## Egress\n<!-- card-drift:egress[^>]*-->\n- NormalizedEvent: ORDER_FILLED\n<!-- \/card-drift:egress -->/);
});

test('applyFix: updates existing block in place', () => {
  const card = '## Egress\n' + wrapBlock('egress', '- Old: X') + '\nprose';
  const out = applyFix(card, 'egress', '- New: Y');
  assert.match(out, /- New: Y/);
  assert.doesNotMatch(out, /- Old: X/);
});

test('evaluate: drift error + fix produced', () => {
  withTree({
    'services/d/foo-ctrl/src/domain/events.ts': EVENTS_FOR_STACK,
    'services/d/foo-ctrl/src/service.stack.ts': STACK_EGRESS,
    'services/d/foo-ctrl/CLAUDE.md': '## Egress\n' + wrapBlock('egress', '- NormalizedEvent: WRONG') + '\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set());
    const egErr = errors.find(e => e.service === 'foo-ctrl' && e.section === 'egress');
    assert.ok(egErr, 'expected an egress drift error');
    assert.equal(egErr.kind, 'drift');
  });
});

test('evaluate: missing-block error when section expected but no block', () => {
  withTree({
    'services/d/foo-ctrl/src/domain/events.ts': EVENTS_FOR_STACK,
    'services/d/foo-ctrl/src/service.stack.ts': STACK_EGRESS,
    'services/d/foo-ctrl/CLAUDE.md': '# foo-ctrl\n\n## Egress\n\nprose only, no block\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set());
    assert.ok(errors.some(e => e.service === 'foo-ctrl' && e.section === 'egress' && e.kind === 'missing'));
  });
});

test('evaluate: stale-block error when block present but no source signal', () => {
  withTree({
    'services/d/foo-hub/src/service.stack.ts': 'export class S {}', // no Egress construct, no events.ts
    'services/d/foo-hub/CLAUDE.md': '## Egress\n' + wrapBlock('egress', '- Ghost: X') + '\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set());
    assert.ok(errors.some(e => e.service === 'foo-hub' && e.section === 'egress' && e.kind === 'stale'));
  });
});

test('evaluate: exclusion suppresses the error', () => {
  withTree({
    'services/d/foo-ctrl/src/domain/events.ts': EVENTS_FOR_STACK,
    'services/d/foo-ctrl/src/service.stack.ts': STACK_EGRESS,
    'services/d/foo-ctrl/CLAUDE.md': '## Egress\n' + wrapBlock('egress', '- NormalizedEvent: WRONG') + '\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set(['foo-ctrl::egress']));
    assert.ok(!errors.some(e => e.service === 'foo-ctrl' && e.section === 'egress'));
  });
});

test('evaluate: hub with no event constructs → no errors', () => {
  withTree({
    'services/d/foo-hub/src/service.stack.ts': 'export class S {}',
    'services/d/foo-hub/CLAUDE.md': '# foo-hub\n\n## State\nNone (stateless hub)\n',
  }, (root) => {
    const { errors } = evaluate(root, new Set());
    assert.deepEqual(errors, []);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: FAIL — `expectedSections is not a function`.

- [ ] **Step 3: Implement `expectedSections`, `applyFix`, `serviceDirs`, `evaluate`**

Append:

```js
// A section is expected iff its source signal is non-empty.
export function expectedSections(model) {
  const present = {
    'event-types': model.eventTypes.length > 0,
    'ingress': model.ingress.length > 0,
    'egress': model.egress.length > 0,
    'handlers': model.handlers.length > 0,
    'ddb-entities': model.ddbEntities.length > 0,
  };
  return SECTION_IDS.filter(s => present[s]);
}

// Heading a section's block lives under (first match wins; else appended).
const SECTION_HEADING = {
  'event-types': { re: /^##\s+Event Types.*$/m, canonical: '## Event Types (domain/events.ts)' },
  'ingress': { re: /^##\s+(Ingress|Cross-Domain Event Forwarding).*$/m, canonical: '## Ingress' },
  'egress': { re: /^##\s+Egress.*$/m, canonical: '## Egress' },
  'handlers': { re: /^##\s+Handlers.*$/m, canonical: '## Handlers' },
  'ddb-entities': { re: /^##\s+(DDB Entities|Entities).*$/m, canonical: '## DDB Entities' },
};

// Insert/update/remove one section's block. body===null removes the block.
export function applyFix(cardText, section, body) {
  const block = body === null ? null : wrapBlock(section, body);
  const existing = locateBlocks(cardText).get(section);
  if (existing) {
    return block === null
      ? cardText.replace(existing.full + '\n', '').replace(existing.full, '')
      : cardText.replace(existing.full, block);
  }
  if (block === null) return cardText;
  const { re, canonical } = SECTION_HEADING[section];
  const hm = re.exec(cardText);
  if (hm) {
    const insertAt = hm.index + hm[0].length;
    return cardText.slice(0, insertAt) + '\n' + block + cardText.slice(insertAt);
  }
  const trimmed = cardText.replace(/\s+$/, '');
  return `${trimmed}\n\n${canonical}\n${block}\n`;
}

// services/<domain>/<service> dirs that have a stack file.
function serviceDirs(root) {
  const base = join(root, 'services');
  const out = [];
  let domains;
  try { domains = readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const d of domains) {
    if (!d.isDirectory()) continue;
    let svcs;
    try { svcs = readdirSync(join(base, d.name), { withFileTypes: true }); } catch { continue; }
    for (const s of svcs) {
      if (!s.isDirectory()) continue;
      const dir = join(base, d.name, s.name);
      try { statSync(join(dir, 'src/service.stack.ts')); } catch { continue; }
      out.push({ service: s.name, dir, cardPath: join(dir, 'CLAUDE.md') });
    }
  }
  return out;
}

// Evaluate the whole tree. Returns drift/missing/stale errors and the fixes
// that --fix would apply (one rewritten card text per drifted card).
export function evaluate(root, exclusions) {
  const errors = [];
  const fixes = [];
  for (const { service, dir, cardPath } of serviceDirs(root)) {
    let cardText;
    try { cardText = readFileSync(cardPath, 'utf8'); }
    catch { errors.push({ service, section: '*', kind: 'no-card', detail: `${cardPath} missing` }); continue; }
    const model = buildModel(dir);
    const expected = new Set(expectedSections(model));
    const blocks = locateBlocks(cardText);
    let next = cardText;
    let changed = false;

    for (const section of SECTION_IDS) {
      if (isExcluded(exclusions, service, section)) continue;
      const has = blocks.has(section);
      if (expected.has(section)) {
        const want = renderBlock(section, model);
        if (!has) { errors.push({ service, section, kind: 'missing', detail: 'no generated block' }); next = applyFix(next, section, want); changed = true; }
        else if (blocks.get(section).body !== want) { errors.push({ service, section, kind: 'drift', detail: 'card block ≠ rendered' }); next = applyFix(next, section, want); changed = true; }
      } else if (has) {
        errors.push({ service, section, kind: 'stale', detail: 'block present but no source signal' });
        next = applyFix(next, section, null); changed = true;
      }
    }
    if (changed) fixes.push({ cardPath, newText: next });
  }
  return { errors, fixes };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): evaluate + applyFix + expectedSections"
```

---

## Task 9: CLI `main` (check + --fix) and CLI tests

**Files:**
- Modify: `tools/check-service-card-drift.mjs`
- Test: `tools/check-service-card-drift.test.mjs`

- [ ] **Step 1: Write the failing CLI test**

Append:

```js
test('CLI: exit 1 on drift, exit 0 after --fix', () => {
  withTree({
    'services/d/foo-ctrl/src/domain/events.ts': EVENTS_FOR_STACK,
    'services/d/foo-ctrl/src/service.stack.ts': STACK_EGRESS,
    'services/d/foo-ctrl/CLAUDE.md': '## Egress\n' + wrapBlock('egress', '- NormalizedEvent: WRONG') + '\n',
    'tools/service-card-exclusions.json': JSON.stringify({ exclusions: [] }),
  }, (root) => {
    const check = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(check.status, 1);
    assert.match(check.stderr + check.stdout, /egress/);

    const fix = spawnSync('node', [SCRIPT, '--root', root, '--fix'], { encoding: 'utf8' });
    assert.equal(fix.status, 0);

    const recheck = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(recheck.status, 0);

    const card = readFileSync(join(root, 'services/d/foo-ctrl/CLAUDE.md'), 'utf8');
    assert.match(card, /- NormalizedEvent: ORDER_FILLED/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: FAIL — script has no `main`, exit code wrong.

- [ ] **Step 3: Implement `main`**

Append:

```js
function main() {
  const { root, fix } = parseArgs(process.argv);
  const { exclusions, entries } = parseExclusions(root);
  const { errors, fixes } = evaluate(root, exclusions);

  if (fix) {
    for (const f of fixes) writeFileSync(f.cardPath, f.newText, 'utf8');
    console.log(`card-drift: --fix wrote ${fixes.length} card(s).`);
    process.exit(0);
  }

  if (errors.length === 0) {
    console.log(`card-drift: OK (${entries.length} excluded, 0 drift)`);
    process.exit(0);
  }

  console.error('card-drift: FAIL');
  console.error(`Found ${errors.length} card-drift issue(s). Run \`node tools/check-service-card-drift.mjs --fix\` (or \`nx run event-processor:card-drift -- --fix\`) and review.\n`);
  for (const e of errors) {
    console.error(`  [${e.kind}] ${e.service} :: ${e.section}`);
    console.error(`    ${e.detail}`);
  }
  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add tools/check-service-card-drift.mjs tools/check-service-card-drift.test.mjs
git commit --no-verify -m "feat(card-drift): CLI main (check + --fix)"
```

---

## Task 10: Wire nx target + pre-commit Check 9

**Files:**
- Modify: `libs/event-processor/project.json`
- Modify: `scripts/verify-structure.sh`

- [ ] **Step 1: Add the `card-drift` nx target**

In `libs/event-processor/project.json`, inside `targets`, add after `typed-subject-drift`:

```json
    "card-drift": {
      "executor": "nx:run-commands",
      "cache": true,
      "inputs": [
        "{workspaceRoot}/services/**/CLAUDE.md",
        "{workspaceRoot}/services/**/src/service.stack.ts",
        "{workspaceRoot}/services/**/src/domain/events.ts",
        "{workspaceRoot}/services/**/src/**/*.ts",
        "{workspaceRoot}/tools/check-service-card-drift.mjs",
        "{workspaceRoot}/tools/service-card-exclusions.json"
      ],
      "options": { "command": "node tools/check-service-card-drift.mjs" }
    }
```

- [ ] **Step 2: Verify the target runs**

Run: `pnpm nx run event-processor:card-drift`
Expected: runs the script (it MAY report drift until Task 11 migration — that is fine here; just confirm the target is wired and invokes the script).

- [ ] **Step 3: Add pre-commit Check 9**

First read the existing Check 8 block to match style:

Run: `sed -n '80,95p' scripts/verify-structure.sh`

Then append a Check 9 modeled on Check 8 (adjust the trailing line number/echo to match the file). Insert after Check 8's block:

```bash
# Check 9: service-card drift gate (blocking, daemon-free pure-node scan)
if ! node tools/check-service-card-drift.mjs > /tmp/card-drift-check.out 2>&1; then
  cat /tmp/card-drift-check.out
  echo "✗ Service-card drift detected. Run 'node tools/check-service-card-drift.mjs --fix' and review."
  exit 1
fi
```

- [ ] **Step 4: Verify the hook script is syntactically valid**

Run: `bash -n scripts/verify-structure.sh`
Expected: no output (valid).

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/project.json scripts/verify-structure.sh
git commit --no-verify -m "feat(card-drift): nx target + pre-commit Check 9"
```

---

## Task 11: Migrate all 32 cards (run --fix), review, fix real drift

**Files:**
- Modify: `services/**/CLAUDE.md` (generated blocks)
- Possibly modify: `tools/service-card-exclusions.json` (if a service legitimately needs an opt-out)

- [ ] **Step 1: Run the generator across the repo**

Run: `node tools/check-service-card-drift.mjs --fix`
Expected: `card-drift: --fix wrote N card(s).`

- [ ] **Step 2: Review the diff card-by-card**

Run: `git --no-pager diff --stat services/ && git --no-pager diff services/investor/investor-adpt/CLAUDE.md services/investor/investor-bff/CLAUDE.md services/execution/broker-ctrl/CLAUDE.md`

For each changed card, confirm the generated block reflects the CODE truth. The 3 known-stale cards MUST now carry the full funding-lifecycle event sets and drop the phantom `WITHDRAWAL_COMPLETED`/`TRANSFER_FAILED`. If any block looks wrong, the bug is in the generator (fix the tool + re-run) OR the CODE is genuinely wrong (out of scope here — file via `backlog-add` and leave the card matching code).

- [ ] **Step 3: Confirm the gate is green**

Run: `node tools/check-service-card-drift.mjs`
Expected: `card-drift: OK (… excluded, 0 drift)` — exit 0.

- [ ] **Step 4: Run the unit suite + a lint/test of the host project**

Run: `node --test tools/check-service-card-drift.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ tools/service-card-exclusions.json
git commit --no-verify -m "chore(card-drift): migrate all service cards to generated blocks"
```

---

## Task 12: Update `audit-service` skill (block-division)

**Files:**
- Modify: `.claude/skills/audit-service/SKILL.md`

- [ ] **Step 1: Read the current skill to find the regeneration section**

Run: `sed -n '1,60p' .claude/skills/audit-service/SKILL.md` and locate where it describes regenerating the card sections.

- [ ] **Step 2: Add the generated-block division note**

Insert a subsection (near where the card sections are described) stating exactly:

```markdown
## Generated blocks are machine-owned (do NOT hand-write)

The mechanically-derivable card sections are owned by the deterministic gate
`tools/check-service-card-drift.mjs`, not by this skill. They live between
`<!-- card-drift:<section> -->` … `<!-- /card-drift:<section> -->` markers
(`event-types`, `ingress`, `egress`, `handlers`, `ddb-entities`).

When regenerating a card:
1. Run `node tools/check-service-card-drift.mjs --fix` (or
   `nx run event-processor:card-drift -- --fix`) to refresh the generated blocks
   deterministically from `service.stack.ts` / `domain/events.ts`.
2. LLM-regenerate ONLY the prose/intent sections (Why, Read model ownership,
   IAM trace, handler descriptions, Event Payload Contracts, narrative).
3. Never write event names, subscription lists, entity names, or handler
   filenames by hand between the `card-drift:*` markers — they will fail the gate.
```

- [ ] **Step 3: Verify the skill still lints/reads cleanly**

Run: `node tools/check-service-card-drift.mjs` (ensure no regression) and visually confirm the SKILL.md renders.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/audit-service/SKILL.md
git commit --no-verify -m "docs(card-drift): audit-service generated-block division"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** tool (T1–T9), 5 blocks (T2–T8), TS-AST parser (T2–T6), exclusion registry (T1), structural service-type detection (T8 `expectedSections`/`evaluate`), nx target + pre-commit (T10), audit-service division (T12), migration as validation gate (T11). All spec sections map to a task.
- **Adapter forwarding** (investor-adpt) is covered by T5 `extractForwarding`, merged into the `ingress` block in T6 `parseStack`.
- **key≠wire** (6 feed adapters) handled in T2/T3 via the `resolve` map and `renderEventTypes`'s `KEY (WIRE)` form.
- **Hubs/web** auto-skip: no `Ingress`/`Egress`/`events.ts` → `expectedSections` returns `[]`; if a hub stack has no `service.stack.ts` it is included only when the file exists (all 32 do), and produces no expected sections.
- **Commit hygiene:** worktree commits use `--no-verify` (the pre-commit hook can't run nx-affected in a worktree); verify each commit landed.
