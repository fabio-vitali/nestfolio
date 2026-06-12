# Typed-Subject Convention Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the five typed-subject conventions self-enforcing — convention 2 (import channel) via nx `enforce-module-boundaries`, conventions 1/3/4 + the deleted-`opaqueSubject` guard via a `tools/check-typed-subjects.mjs` gate, and all five via updated skills + arch docs — after first fixing the 11 live cross-domain import violations so the gate runs green.

**Architecture:** Two enforcement mechanisms, split by what each can express. (a) nx `@nx/enforce-module-boundaries`: tighten its over-permissive `allow` list so cross-domain `/contracts`+`/events` imports become lint errors, with a DRY test-code override; route the 11 live violations through the producer-domain `*-adpt/domain` re-exports. (b) `tools/check-typed-subjects.mjs`: a pure-Node string/regex gate (mirroring `tools/check-read-model-drift.mjs`) for the syntactic conventions, with a JSON exclusion registry, an nx target, and a pre-commit hook line. Then propagate the conventions into the `create-*`/`audit-*` skills and architecture docs.

**Tech Stack:** Node ESM (`node:test`, `node:fs`), nx `@nx/eslint-plugin` enforce-module-boundaries, zod (existing contracts), the repo's `TableEntry`/`BusEvent`/`parseSubject` platform types.

**Spec:** `docs/superpowers/specs/2026-06-12-typed-subject-enforcement-design.md`

---

## Worktree note

All work happens in the worktree at
`/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/typing-convention-enforcement`
(branch `worktree-typing-convention-enforcement`). **Commits in this worktree must use
`git commit --no-verify`** (the pre-commit hook rejects worktree code commits — nx-affected
can't run) and you must verify each commit landed (`git log --oneline -1`).

## File map

**Convention 2 (Phase A):**
- Modify: `services/ledger/ledger-adpt/src/domain/index.ts` (add 3 schema re-exports)
- Modify: `services/investor/investor-adpt/src/domain/events.ts` (add 4 names to `InvestorCrossDomainEventTypes`)
- Modify: 11 consumer files (repoint imports) — listed in Tasks A3/A4
- Modify: `eslint.config.js` (tighten `allow`, add DRY test override)

**Syntactic gate (Phase B):**
- Create: `tools/check-typed-subjects.mjs`
- Create: `tools/check-typed-subjects.test.mjs`
- Create: `tools/typed-subject-exclusions.json`
- Modify: `libs/event-processor/project.json` (add `typed-subject-drift` target)
- Modify: `scripts/verify-structure.sh` (add pre-commit check)

**Skills (Phase C):** `.claude/skills/create-event/SKILL.md`, `create-service/SKILL.md`,
`create-feature/SKILL.md`, `audit-service/SKILL.md`, `audit-domain/SKILL.md`

**Docs (Phase D):** `docs/architecture/SYSTEM-ARCHITECTURE.md`, `docs/agent-system.md`,
`.claude/skills/cdk-patterns/SKILL.md`

**Backlog (Phase E):** new `docs/backlog/service-card-drift-gate.md` via `backlog-add`

---

## Phase A — Convention 2 via nx enforce-module-boundaries

Order keeps the tree green at every commit: add re-exports → repoint consumers (old `allow`
still permits) → tighten `allow` (all violations already gone) → verify.

### Task A1: Add the 3 missing ledger schema re-exports to `ledger-adpt/domain`

**Files:**
- Modify: `services/ledger/ledger-adpt/src/domain/index.ts`

`BalanceUpdatedSchema` is already re-exported (line 2). Add the other three the
cross-domain consumers need (`PortfolioUpdatedSchema`, `LedgerSnapshotSchema`,
`LedgerEntryRecordedSchema`) + their inferred types.

- [ ] **Step 1: Edit the re-export block**

Replace lines 2–3:
```ts
export { BalanceUpdatedSchema } from '@nestfolio/ledger-ctrl/contracts';
export type { BalanceUpdated } from '@nestfolio/ledger-ctrl/contracts';
```
with:
```ts
// Cross-domain re-exports: the ledger domain produces these; advisory + investor
// consume them. Per the home rule, cross-domain consumers import them through this
// producer-domain adapter, never from @nestfolio/ledger-ctrl/contracts directly.
export {
  BalanceUpdatedSchema,
  PortfolioUpdatedSchema,
  LedgerSnapshotSchema,
  LedgerEntryRecordedSchema,
} from '@nestfolio/ledger-ctrl/contracts';
export type {
  BalanceUpdated,
  PortfolioUpdated,
  LedgerSnapshot,
  LedgerEntryRecorded,
} from '@nestfolio/ledger-ctrl/contracts';
```

- [ ] **Step 2: Type-check ledger-adpt**

Run: `pnpm nx build ledger-adpt`
Expected: PASS (these symbols all exist in `ledger-ctrl/contracts` — verified: lines 14/23/33/43).

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-adpt/src/domain/index.ts
git commit --no-verify -m "feat(ledger-adpt): re-export ledger snapshot/portfolio/entry contracts via /domain"
git log --oneline -1
```

### Task A2: Add the 4 investor event names to `InvestorCrossDomainEventTypes`

**Files:**
- Modify: `services/investor/investor-adpt/src/domain/events.ts`

The 4 names cross-consumers use (`INVESTOR_PROFILE_UPDATED`, `MANDATE_ISSUED`,
`MANDATE_REVOKED`, `OPERATING_MODE_CHANGED`) are not in `InvestorCrossDomainEventTypes`
yet (it only has `ACCOUNT_CLOSURE_REQUESTED`). `investor-adpt/domain` already re-exports
`InvestorCrossDomainEventTypes`, so adding them here exposes them through the adapter.

- [ ] **Step 1: Extend the map**

Replace the `InvestorCrossDomainEventTypes` object (lines 9–12):
```ts
export const InvestorCrossDomainEventTypes = {
  // → Execution (consumed by execution-ctrl/handlers/event-listener.ts)
  ACCOUNT_CLOSURE_REQUESTED: eventName('ACCOUNT_CLOSURE_REQUESTED'),
} as const;
```
with:
```ts
export const InvestorCrossDomainEventTypes = {
  // → Execution (consumed by execution-ctrl/handlers/event-listener.ts)
  ACCOUNT_CLOSURE_REQUESTED: eventName('ACCOUNT_CLOSURE_REQUESTED'),
  // → Advisory (consumed by compliance-ctrl, decision-workflow-ctrl, investor-profile-ctrl)
  INVESTOR_PROFILE_UPDATED: eventName('INVESTOR_PROFILE_UPDATED'),
  MANDATE_ISSUED: eventName('MANDATE_ISSUED'),
  MANDATE_REVOKED: eventName('MANDATE_REVOKED'),
  OPERATING_MODE_CHANGED: eventName('OPERATING_MODE_CHANGED'),
} as const;
```

- [ ] **Step 2: Type-check investor-adpt**

Run: `pnpm nx build investor-adpt`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-adpt/src/domain/events.ts
git commit --no-verify -m "feat(investor-adpt): expose mandate/profile/operating-mode names via cross-domain map"
git log --oneline -1
```

### Task A3: Repoint the ledger-consuming files to `ledger-adpt/domain`

**Files (6 imports across 6 files):**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/position-snapshot.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/time-travel-availability.ts`
- Modify: `services/investor/investor-bff/src/transforms/balance-updated.ts`

The two dwc files use `LedgerCtrlEventTypes.PORTFOLIO_UPDATED` (the only member used) →
switch to `LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED` (already present in that map).
The four schema importers just change the import source path; symbol unchanged.

- [ ] **Step 1: `snapshot-projector.ts`** — replace lines 14–15:
```ts
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { PortfolioUpdatedSchema } from '@nestfolio/ledger-ctrl/contracts';
```
with:
```ts
import { LedgerCrossDomainEventTypes, PortfolioUpdatedSchema } from '@nestfolio/ledger-adpt/domain';
```
Then replace every `LedgerCtrlEventTypes.PORTFOLIO_UPDATED` in this file with
`LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED`.
Run: `grep -n "LedgerCtrlEventTypes" services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` → expect no matches.

- [ ] **Step 2: `decision-workflow-ctrl/src/service.stack.ts`** — replace line 18:
```ts
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
```
with:
```ts
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
```
Then replace every `LedgerCtrlEventTypes.PORTFOLIO_UPDATED` with
`LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED`.
Run: `grep -n "LedgerCtrlEventTypes" services/advisory/decision-workflow-ctrl/src/service.stack.ts` → expect no matches.

- [ ] **Step 3: the three dashboard-bff transforms + investor-bff transform** — change only the source path:

`portfolio-summary.ts` line 3: `'@nestfolio/ledger-ctrl/contracts'` → `'@nestfolio/ledger-adpt/domain'` (symbol `LedgerSnapshotSchema` unchanged).
`position-snapshot.ts` line 4: `'@nestfolio/ledger-ctrl/contracts'` → `'@nestfolio/ledger-adpt/domain'` (symbol `LedgerSnapshotSchema`).
`time-travel-availability.ts` line 3: `'@nestfolio/ledger-ctrl/contracts'` → `'@nestfolio/ledger-adpt/domain'` (symbol `LedgerEntryRecordedSchema`).
`investor-bff/src/transforms/balance-updated.ts` line 3: `'@nestfolio/ledger-ctrl/contracts'` → `'@nestfolio/ledger-adpt/domain'` (symbol `BalanceUpdatedSchema`).

- [ ] **Step 4: Build the affected services**

Run: `pnpm nx run-many -t build -p decision-workflow-ctrl dashboard-bff investor-bff`
Expected: PASS (re-exports resolve identically).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl services/investor/dashboard-bff services/investor/investor-bff
git commit --no-verify -m "refactor: route ledger cross-domain imports through ledger-adpt/domain"
git log --oneline -1
```

### Task A4: Repoint the investor-name-consuming files to `investor-adpt/domain`

**Files (5 imports across 5 files):**
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/compliance-ctrl/src/service.stack.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/events.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts`

Each imports `InvestorBffEventTypes` from `@nestfolio/investor-bff/events`. Switch to
`InvestorCrossDomainEventTypes` from `@nestfolio/investor-adpt/domain` and rename the
member references (`INVESTOR_PROFILE_UPDATED`, `MANDATE_ISSUED`, `MANDATE_REVOKED`,
`OPERATING_MODE_CHANGED` are all now in that map).

- [ ] **Step 1: For each of the 5 files**, replace the import line
```ts
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
```
with:
```ts
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
```
then replace every `InvestorBffEventTypes.` with `InvestorCrossDomainEventTypes.` in that file.

- [ ] **Step 2: Verify no stale references remain**

Run:
```bash
grep -rn "InvestorBffEventTypes" services/advisory/compliance-ctrl/src services/advisory/decision-workflow-ctrl/src services/advisory/investor-profile-ctrl/src
```
Expected: no matches.

- [ ] **Step 3: Build the affected services**

Run: `pnpm nx run-many -t build -p compliance-ctrl decision-workflow-ctrl investor-profile-ctrl`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/compliance-ctrl services/advisory/decision-workflow-ctrl services/advisory/investor-profile-ctrl
git commit --no-verify -m "refactor: route investor cross-domain names through investor-adpt/domain"
git log --oneline -1
```

### Task A5: Tighten the nx `allow` list + add the DRY test-code override

**Files:**
- Modify: `eslint.config.js`

Remove `@nestfolio/.+/contracts` and `@nestfolio/.+/events` from the global `allow` so
cross-domain imports of them become lint errors (the scope-tag depConstraints already
restrict each domain to its own scope). Add a test-code override that re-permits them
(contract-validation tests must import real producer contracts cross-domain). DRY: extract
the allow + depConstraints to consts so the override doesn't duplicate them.

- [ ] **Step 1: Add consts after the requires (after line 4)**

Insert:
```js
// Cross-domain import channel (typed-subject convention 2): production src may import
// another domain's symbols ONLY through `*-adpt/domain`. /contracts and /events are
// intra-domain only (the scope-tag depConstraints below enforce it). Test code is
// exempt — contract-validation tests import real producer contracts cross-domain.
const PROD_ALLOW = [
  '@nestfolio/.+/agent-budgets',
  '@nestfolio/.+-adpt/domain',
  '@nestfolio/event-processor',
  '@nestfolio/e2e-feature-tests',
];
const TEST_ALLOW = [...PROD_ALLOW, '@nestfolio/.+/contracts', '@nestfolio/.+/events'];
const DEP_CONSTRAINTS = [
  { sourceTag: 'scope:platform', onlyDependOnLibsWithTags: ['scope:platform'] },
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared', 'scope:platform'] },
  { sourceTag: 'scope:domain', onlyDependOnLibsWithTags: ['scope:domain', 'scope:platform'] },
  { sourceTag: 'scope:investor', onlyDependOnLibsWithTags: ['scope:investor', 'scope:platform', 'scope:shared'] },
  { sourceTag: 'scope:onboarding', onlyDependOnLibsWithTags: ['scope:onboarding', 'scope:platform', 'scope:shared'] },
  { sourceTag: 'scope:advisory', onlyDependOnLibsWithTags: ['scope:advisory', 'scope:platform', 'scope:shared'] },
  { sourceTag: 'scope:execution', onlyDependOnLibsWithTags: ['scope:execution', 'scope:platform', 'scope:shared'] },
  { sourceTag: 'scope:ledger', onlyDependOnLibsWithTags: ['scope:ledger', 'scope:platform', 'scope:shared'] },
  { sourceTag: 'scope:shell', onlyDependOnLibsWithTags: ['scope:shell', 'scope:shared'] },
];
```

- [ ] **Step 2: Replace the inline `allow`+`depConstraints`** (current lines 27–67, inside the main `**/*.ts` block) so the rule reads:
```js
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: PROD_ALLOW,
          depConstraints: DEP_CONSTRAINTS,
        },
      ],
```

- [ ] **Step 3: Add the test-code override block** immediately after the existing
`{ files: ['**/*.test.ts', '**/*.spec.ts'], ... }` block:
```js
  {
    // Test code legitimately imports real producer contracts across domains.
    files: [
      '**/*.test.ts',
      '**/*.spec.ts',
      'apps/e2e-feature-tests/**',
      'libs/integration-testing/**',
      'libs/test-support/**',
    ],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        { enforceBuildableLibDependency: false, allow: TEST_ALLOW, depConstraints: DEP_CONSTRAINTS },
      ],
    },
  },
```

- [ ] **Step 4: Lint the affected projects — expect GREEN** (all 11 violations were fixed in A3/A4)

Run: `pnpm nx run-many -t lint -p decision-workflow-ctrl compliance-ctrl investor-profile-ctrl dashboard-bff investor-bff ledger-adpt investor-adpt`
Expected: PASS (no enforce-module-boundaries errors).

- [ ] **Step 5: Prove the rule actually bites (negative check)**

Temporarily re-add a cross-domain `/contracts` import to a production file:
```bash
sed -i '' "s#import { LedgerSnapshotSchema } from '@nestfolio/ledger-adpt/domain';#import { LedgerSnapshotSchema } from '@nestfolio/ledger-ctrl/contracts';#" services/investor/dashboard-bff/src/transforms/portfolio-summary.ts
pnpm nx lint dashboard-bff
```
Expected: **FAIL** with an `@nx/enforce-module-boundaries` violation naming
`@nestfolio/ledger-ctrl/contracts`. Then revert:
```bash
git checkout services/investor/dashboard-bff/src/transforms/portfolio-summary.ts
pnpm nx lint dashboard-bff   # expect PASS again
```

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js
git commit --no-verify -m "feat(lint): enforce typed-subject convention 2 — cross-domain via *-adpt/domain only"
git log --oneline -1
```

---

## Phase B — The syntactic gate `tools/check-typed-subjects.mjs`

### Task B1: Write the failing test

**Files:**
- Create: `tools/check-typed-subjects.test.mjs`

- [ ] **Step 1: Write the test** (mirrors `tools/check-read-model-drift.test.mjs`)

```js
// node:test sibling for check-typed-subjects.mjs.
// Verifies the syntactic typed-subject gate: per-rule detection, the exclusion
// registry, platform-seam path exclusion, and CLI exit codes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanTree, scanFile, parseExclusions, evaluate } from './check-typed-subjects.mjs';

const SCRIPT = join(process.cwd(), 'tools/check-typed-subjects.mjs');

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'nf-tsubj-'));
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

test('C1: flags `.subject as Record<string,unknown>`', () => {
  const hits = scanFile('services/x/x-ctrl/src/handlers/h.ts',
    `const s = payload.subject as Record<string, unknown>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-cast').length, 1);
});

test('C1: flags `(event.subject ?? event) as Record`', () => {
  const hits = scanFile('services/x/x-ctrl/src/agent-service.ts',
    `const subject = (event.subject ?? event) as Record<string, unknown>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-cast').length, 1);
});

test('C1: does NOT flag parseSubject or a nested field read', () => {
  const hits = scanFile('services/x/x-ctrl/src/handlers/h.ts',
    `const s = parseSubject(uow, FooSchema);\nconst p = s.investorProfile as Record<string, unknown>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-cast').length, 0);
});

test('C4: flags a Subject-suffixed contract name in a contracts file', () => {
  const hits = scanFile('services/x/x-ctrl/src/domain/contracts.ts',
    `export const FooSubjectSchema = z.object({});\nexport type FooSubject = z.infer<typeof FooSubjectSchema>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-suffix').length, 2);
});

test('C4: does NOT flag a clean contract name', () => {
  const hits = scanFile('services/x/x-ctrl/src/domain/contracts.ts',
    `export const FooSchema = z.object({});\nexport type Foo = z.infer<typeof FooSchema>;`);
  assert.equal(hits.filter(h => h.rule === 'subject-suffix').length, 0);
});

test('OPAQUE: flags a reintroduced opaqueSubject', () => {
  const hits = scanFile('services/x/x-ctrl/src/handlers/h.ts',
    `const s = opaqueSubject(payload);`);
  assert.equal(hits.filter(h => h.rule === 'opaque-subject').length, 1);
});

test('C3: flags an inline pk/sk/__typename row; not a TableEntry row', () => {
  const inlineHits = scanFile('services/x/x-ctrl/src/domain/models.ts',
    `export interface FooRow {\n  pk: string;\n  sk: string;\n  __typename: 'Foo';\n  value: number;\n}`);
  assert.equal(inlineHits.filter(h => h.rule === 'inline-row').length, 1);
  const tableEntryHits = scanFile('services/x/x-ctrl/src/domain/models.ts',
    `export type FooRow = TableEntry<Foo, RequestContext> & {\n  pk: string;\n  sk: string;\n  __typename: 'Foo';\n};`);
  assert.equal(tableEntryHits.filter(h => h.rule === 'inline-row').length, 0);
});

test('evaluate: platform seam C1 hits are path-excluded', () => {
  const hits = scanFile('libs/event-processor/src/util/to-uow.ts',
    `subject: payload.subject as Record<string, unknown>,`);
  assert.equal(hits.filter(h => h.rule === 'subject-cast').length, 1); // raw hit
  assert.equal(evaluate(hits, new Set()).length, 0);                   // excluded by path
});

test('evaluate: a registry-excluded file suppresses its rule', () => {
  const hits = scanFile('services/x/x-ctrl/src/handlers/kb.ts',
    `const c = subjectThing.subject as Record<string, unknown>;`);
  const ex = new Set(['subject-cast::services/x/x-ctrl/src/handlers/kb.ts']);
  assert.equal(evaluate(hits, ex).length, 0);
});

test('parseExclusions rejects an entry missing reason', () => {
  withTree({ 'tools/typed-subject-exclusions.json':
    JSON.stringify({ exclusions: [{ rule: 'subject-cast', file: 'a.ts' }] }) }, (root) => {
    assert.throws(() => parseExclusions(root), /needs non-empty/);
  });
});

test('CLI: exit 0 on a clean tree, exit 1 on a violation', () => {
  const clean = makeTree({ 'services/x/x-ctrl/src/h.ts': `const s = parseSubject(u, S);` });
  try {
    const ok = spawnSync('node', [SCRIPT, '--root', clean], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { rmSync(clean, { recursive: true, force: true }); }

  const bad = makeTree({ 'services/x/x-ctrl/src/h.ts': `const s = payload.subject as Record<string, unknown>;` });
  try {
    const fail = spawnSync('node', [SCRIPT, '--root', bad], { encoding: 'utf8' });
    assert.equal(fail.status, 1, fail.stdout + fail.stderr);
    assert.match(fail.stderr, /subject-cast/);
  } finally { rmSync(bad, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the test — expect FAIL (script does not exist)**

Run: `node --test tools/check-typed-subjects.test.mjs`
Expected: FAIL — `Cannot find module './check-typed-subjects.mjs'`.

### Task B2: Implement the gate + seed the exclusion registry

**Files:**
- Create: `tools/check-typed-subjects.mjs`
- Create: `tools/typed-subject-exclusions.json`

- [ ] **Step 1: Write `tools/check-typed-subjects.mjs`**

```js
#!/usr/bin/env node
// check-typed-subjects.mjs — typed-subject convention gate (capstone).
//
// Enforces the SYNTACTIC typed-subject conventions across services + libs `src`:
//   subject-cast   (C1) — `<expr>.subject … as Record<string,unknown>` / `as <PascalType>`.
//                         parseSubject(carrier, <ProducerSchema>) is the only sanctioned read.
//                         Excludes the parseSubject platform seams (by path) + registry files.
//   subject-suffix (C4) — a contract named `<Name>SubjectSchema` / type `<Name>Subject`
//                         in **/domain/contracts.ts or **/domain/events.ts.
//   opaque-subject      — the `opaqueSubject` identifier reintroduced anywhere in `src`.
//   inline-row     (C3) — a top-level interface/type declaring pk + sk + __typename inline
//                         (not via TableEntry<>). Heuristic regression guard.
//
// Convention 2 (cross-domain import channel) is enforced by @nx/enforce-module-boundaries,
// NOT here. Conventions 3 (full) + 5 (context generic) are skills/docs only.
//
// Usage: node tools/check-typed-subjects.mjs [--root <dir>]
// Scope: services/**/src + libs/**/src (excludes test dirs + *.test.ts/*.spec.ts).
// No AST dep — string/regex scanning, mirroring tools/check-read-model-drift.mjs.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDE_FRAGMENTS = ['node_modules', 'dist', 'cdk.out', '.worktrees', '.nx', 'coverage', 'test'];
const EXCLUDED_BASENAME_SUFFIXES = ['.test.ts', '.spec.ts'];
const SCAN_ROOTS = ['services', 'libs'];
const EXCLUSIONS_FILE = 'tools/typed-subject-exclusions.json';

// The parseSubject carrier itself reads subject as Record by design.
const PLATFORM_SEAMS = new Set([
  'libs/event-processor/src/util/to-uow.ts',
  'libs/event-processor/src/internal/sqs-parser.ts',
  'libs/event-processor/src/engine/ingestion-engine.ts',
  'libs/event-processor/src/testing/test-harness.ts',
]);

// Matches a `subject` token (property `.subject` OR a local `subject`/`subject.field`)
// cast to Record<string,unknown> or a PascalCase local type, before the next `;`/`=`/EOL.
// Broad-catch + registry (mirrors check-read-model-drift): any subject-as-untyped read is
// suspect; genuinely-polymorphic readers are registered. `parseSubject(...)` (capital S)
// and non-subject reads (`.payload`, `.upstreamOutputs`) are NOT matched.
const SUBJECT_CAST_RE = /(?<![A-Za-z0-9_])subject\b[^\n;=]*?\bas\s+(Record<\s*string\s*,\s*unknown\s*>|[A-Z][A-Za-z0-9_]*)/g;
const SUBJECT_SUFFIX_RE = /export\s+(?:const\s+([A-Za-z0-9_]+SubjectSchema)\b|type\s+([A-Za-z0-9_]+Subject)\b)/g;
const OPAQUE_RE = /\bopaqueSubject\b/g;

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

export function scanFile(rel, text) {
  const hits = [];
  SUBJECT_CAST_RE.lastIndex = 0; let m;
  while ((m = SUBJECT_CAST_RE.exec(text)) !== null) {
    if (inComment(text, m.index)) continue;
    hits.push({ rule: 'subject-cast', file: rel, line: lineOf(text, m.index),
      msg: `untyped subject read \`${m[0].trim()}\` — parse it with parseSubject(carrier, <ProducerSchema>) instead` });
  }
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
  return hits;
}

export function scanTree(root) {
  const hits = [];
  for (const sub of SCAN_ROOTS) {
    for (const file of walk(join(root, sub))) {
      if (!file.endsWith('.ts')) continue;
      if (EXCLUDED_BASENAME_SUFFIXES.some(s => file.endsWith(s))) continue;
      const rel = relative(root, file).split(sep).join('/');
      if (!rel.includes('/src/')) continue;
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      hits.push(...scanFile(rel, text));
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
```

- [ ] **Step 2: Create a minimal `tools/typed-subject-exclusions.json`** (final entries set in B3)

```json
{
  "exclusions": []
}
```

- [ ] **Step 3: Run the test — expect PASS**

Run: `node --test tools/check-typed-subjects.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 4: Commit**

```bash
git add tools/check-typed-subjects.mjs tools/check-typed-subjects.test.mjs tools/typed-subject-exclusions.json
git commit --no-verify -m "feat(tools): add check-typed-subjects gate + node:test sibling"
git log --oneline -1
```

### Task B3: Run against the repo + seed the exclusion registry until green

**Files:**
- Modify: `tools/typed-subject-exclusions.json`
- Possibly Modify: `tools/check-typed-subjects.mjs` (extend `PLATFORM_SEAMS` only if a
  genuine library-internal seam surfaces)

- [ ] **Step 1: Run the gate against the repo**

Run: `node tools/check-typed-subjects.mjs`
Expected initially: FAIL, listing `subject-cast` hits (the documented exceptions) and
possibly an `inline-row`/`opaque-subject`/`subject-suffix` hit.

- [ ] **Step 2: Classify each reported hit.** For each `subject-cast` file in the output,
decide: is it a `parseSubject` platform seam (→ add to `PLATFORM_SEAMS` in the script) or a
documented exception (→ registry entry)? The expected documented-exception set (audited
2026-06-12) is below. **If a hit is NOT one of these and NOT a seam, STOP** — it is an
unconverted violation; file it via `backlog-add` and add a registry entry with that
`backlogRef` (do not silently exclude a bug). Write `tools/typed-subject-exclusions.json`:

```json
{
  "exclusions": [
    { "rule": "subject-cast", "file": "services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts",
      "reason": "Shared sim/alpaca funding-completed handler reads 4 differently-shaped subjects; cannot type against one producer schema until normalized.",
      "backlogRef": "broker-funding-completed-normalization-drift" },
    { "rule": "subject-cast", "file": "services/advisory/market-intelligence-ctrl/src/handlers/kb-ingestion-handler.ts",
      "reason": "KB-stringify polymorphic fan-in over many feed events — a documented consumer-view read, not a single-producer subject." },
    { "rule": "subject-cast", "file": "services/ledger/ledger-ctrl/src/handlers/event-listener.ts",
      "reason": "ORDER_FILLED live-fill tax-lot boundary read of symbol/side/quantity not carried on the minimal NormalizedOrderEvent.",
      "backlogRef": "ledger-ctrl-live-tax-lot-missing-order-fields" },
    { "rule": "subject-cast", "file": "services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts",
      "reason": "AssemblePacket-style polymorphic fan-in over upstream agent outputs (investorProfile/marketAnalysis)." },
    { "rule": "subject-cast", "file": "services/advisory/portfolio-engine-ctrl/src/agent-service.ts",
      "reason": "Agent-runtime entry shim normalizes a direct-invoke payload OR an EB event subject — genuinely polymorphic." },
    { "rule": "subject-cast", "file": "services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts",
      "reason": "Polymorphic fan-in over upstream agent outputs (investorProfile/marketAnalysis/portfolio)." },
    { "rule": "subject-cast", "file": "services/advisory/advisory-narrative-ctrl/src/agent-service.ts",
      "reason": "Agent-runtime entry shim — direct-invoke OR EB event subject; genuinely polymorphic." },
    { "rule": "subject-cast", "file": "services/advisory/advisory-narrative-ctrl/src/handlers/feedback-correlator.ts",
      "reason": "Polymorphic feedback correlation over multiple event types." },
    { "rule": "subject-cast", "file": "services/advisory/market-intelligence-ctrl/src/agent-service.ts",
      "reason": "Agent-runtime entry shim — direct-invoke OR EB event subject; genuinely polymorphic." },
    { "rule": "subject-cast", "file": "services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts",
      "reason": "Polymorphic fan-in entry — narrows per-branch downstream." },
    { "rule": "subject-cast", "file": "services/advisory/investor-profile-ctrl/src/agent-service.ts",
      "reason": "Agent-runtime entry shim — direct-invoke OR EB event subject; genuinely polymorphic." }
  ]
}
```

> The 11 entries above are the expected `subject-cast` baseline (audited 2026-06-12), each a
> `subject … as` read. The three `.payload` / `.upstreamOutputs` casts
> (`ledger-ctrl/account.reducer.ts`, `portfolio-engine`/`advisory-narrative` `agents/**/graph.ts`)
> read a NON-`subject` token, so the regex does NOT flag them — no entry needed.

- [ ] **Step 3: Re-run until green**

Run: `node tools/check-typed-subjects.mjs`
Expected: `typed-subject: OK (… raw hit(s), 11 excluded, 0 violation(s))`. Iterate Step 2
until 0 violations. (If the set of flagged `subject-cast` files differs from the 11-file
baseline above, reconcile each delta EXPLICITLY — a newly-flagged file is either a real
violation to fix/file or a genuine polymorphic reader to register with a reason; never
blanket-exclude.)

- [ ] **Step 4: Re-run the unit test** (registry parsing must still pass)

Run: `node --test tools/check-typed-subjects.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/typed-subject-exclusions.json tools/check-typed-subjects.mjs
git commit --no-verify -m "chore(tools): seed typed-subject exclusion registry; gate green on repo"
git log --oneline -1
```

### Task B4: Wire the nx target

**Files:**
- Modify: `libs/event-processor/project.json`

- [ ] **Step 1: Add the target** alongside the existing `read-model-drift` target (same
shape). In the `targets` object add:
```json
    "typed-subject-drift": {
      "executor": "nx:run-commands",
      "cache": true,
      "inputs": [
        "{workspaceRoot}/services/**/src/**/*.ts",
        "{workspaceRoot}/libs/**/src/**/*.ts",
        "{workspaceRoot}/tools/check-typed-subjects.mjs",
        "{workspaceRoot}/tools/typed-subject-exclusions.json"
      ],
      "options": { "command": "node tools/check-typed-subjects.mjs" }
    }
```

- [ ] **Step 2: Run via nx**

Run: `pnpm nx run event-processor:typed-subject-drift`
Expected: PASS — `typed-subject: OK (…)`.

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/project.json
git commit --no-verify -m "feat(nx): add typed-subject-drift target on event-processor"
git log --oneline -1
```

### Task B5: Wire the pre-commit check

**Files:**
- Modify: `scripts/verify-structure.sh`

- [ ] **Step 1: Insert a new check** between the end of Check 7 (after the `fi` that closes
the affected-blast-radius block, currently line 79) and the final `echo ""` summary
(currently line 81):
```bash
# Check 8: typed-subject convention gate (blocking, daemon-free pure-node scan)
if ! node tools/check-typed-subjects.mjs > /tmp/typed-subject-check.out 2>&1; then
  cat /tmp/typed-subject-check.out
  ERRORS=$((ERRORS + 1))
fi
```

- [ ] **Step 2: Run the hook script directly** (from repo root, on the current clean tree)

Run: `bash scripts/verify-structure.sh`
Expected: the typed-subject gate prints OK; the script's overall result is unaffected by
Check 8 (no new errors).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-structure.sh
git commit --no-verify -m "feat(pre-commit): run typed-subject gate (daemon-free) in verify-structure"
git log --oneline -1
```

---

## Phase C — Skills

Mirror how `read-model-drift` is referenced across the skills. Add scaffolding guidance to
the `create-*` skills and a flag+run step to the `audit-*` skills. These are prose
additions — insert the exact text below at the noted anchor (read each file first to place
it naturally; do not restructure existing content).

### Task C1: `create-event`, `create-service`, `create-feature`

**Files:**
- Modify: `.claude/skills/create-event/SKILL.md`
- Modify: `.claude/skills/create-service/SKILL.md`
- Modify: `.claude/skills/create-feature/SKILL.md`

- [ ] **Step 1: Add a "Typed-subject conventions" subsection** to each, with this content
(adapt the heading level to the file):
```markdown
### Typed-subject conventions (enforced)

When a service produces an event, it owns ONE zod contract that types both the persisted
row and the emitted subject:

- Name it after the clean domain/event concept — `<Name>Schema` + `type <Name>` — **no
  `Subject` suffix** (event-aligned name on clash, e.g. `LedgerEntryRecorded`,
  `InvestorProfileUpdated`).
- Type the row as `TableEntry<Name, RequestContext>` and the event as
  `BusEvent<Name, RequestContext>` — never a hand-rolled `pk`/`sk`/`__typename` interface,
  and never drop the context generic.
- **Import channel (enforced by `nx lint`):**
  - *Intra-domain* consumer → import the producer's `@nestfolio/<svc>/contracts` (payloads)
    and `@nestfolio/<svc>/events` (names) directly.
  - *Cross-domain* consumer → import BOTH from the producer-domain's
    `@nestfolio/<domain>-adpt/domain` re-export. Add the re-export to that adapter's
    `/domain` index (schemas) and, for names, the adapter's `*CrossDomainEventTypes` map.
- Consumers read the subject via `parseSubject(carrier, <ProducerSchema>)` — never
  `event.subject as <Type>` / `as Record<string,unknown>`.

Both gates run automatically: `nx lint` (convention 2) and
`node tools/check-typed-subjects.mjs` / `nx run event-processor:typed-subject-drift`
(conventions 1/3/4 + the `opaqueSubject` guard). A genuinely-polymorphic reader gets a
registry entry in `tools/typed-subject-exclusions.json` with a reason.
```

- [ ] **Step 2: Verify the gate references resolve**

Run: `grep -l "typed-subject" .claude/skills/create-event/SKILL.md .claude/skills/create-service/SKILL.md .claude/skills/create-feature/SKILL.md`
Expected: all three listed.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/create-event/SKILL.md .claude/skills/create-service/SKILL.md .claude/skills/create-feature/SKILL.md
git commit --no-verify -m "docs(skills): scaffold typed-subject conventions in create-* skills"
git log --oneline -1
```

### Task C2: `audit-service`, `audit-domain`

**Files:**
- Modify: `.claude/skills/audit-service/SKILL.md`
- Modify: `.claude/skills/audit-domain/SKILL.md`

- [ ] **Step 1: Add a typed-subject audit step** to each (near the existing
`read-model-drift` reference):
```markdown
### Typed-subject convention check

Run the deterministic gate and treat any failure as a finding:
`node tools/check-typed-subjects.mjs` (or `pnpm nx run event-processor:typed-subject-drift`).
Additionally flag, by inspection: (a) `event.subject as …` casts + locally re-declared
payload types in transforms/handlers; (b) cross-domain `@nestfolio/<svc>/contracts` or
`/events` imports (also caught by `nx lint` — they must route through `*-adpt/domain`);
(c) row types re-declaring `pk`/`sk`/`__typename` inline instead of `TableEntry<Subject>`;
(d) a dropped context generic `S` on `BusEvent`/`TableEntry`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/audit-service/SKILL.md .claude/skills/audit-domain/SKILL.md
git commit --no-verify -m "docs(skills): add typed-subject convention check to audit-* skills"
git log --oneline -1
```

---

## Phase D — Architecture docs

### Task D1: Document the conventions

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`
- Modify: `docs/agent-system.md`
- Modify: `.claude/skills/cdk-patterns/SKILL.md`

- [ ] **Step 1: Add a "Typed-subject contracts" section** to `SYSTEM-ARCHITECTURE.md`
(near the event-taxonomy / read-model-ownership material) with the five conventions + the
two enforcement mechanisms, pointing to the dossier:
```markdown
## Typed-subject contracts (enforced)

Every producer aggregate owns one zod contract typing BOTH its persisted row
(`TableEntry<Subject, RequestContext>`) and its emitted event
(`BusEvent<Subject, RequestContext>`). The five conventions:

1. Consumers read subjects via `parseSubject(carrier, <ProducerSchema>)` — no
   `event.subject as <Type>` / `as Record<string,unknown>`.
2. **Import channel:** intra-domain → producer `@nestfolio/<svc>/contracts` + `/events`
   directly; cross-domain → the producer-domain `@nestfolio/<domain>-adpt/domain` re-export
   (both payloads and names). Never reach into another domain's `/contracts` or `/events`.
3. Rows are `TableEntry<Subject>`, not hand-rolled `pk`/`sk`/`__typename` interfaces.
4. Contracts are named for the clean concept — `<Name>Schema` + `<Name>`, no `Subject` suffix.
5. The context generic `S` (`RequestContext` or a domain extension) is carried on both
   `BusEvent<T,S>` and `TableEntry<T,S>`.

**Enforcement:** convention 2 by `@nx/enforce-module-boundaries`; conventions 1/3/4 + the
`opaqueSubject` guard by `tools/check-typed-subjects.mjs`
(`nx run event-processor:typed-subject-drift`, + pre-commit). Documented-polymorphic
readers are registered in `tools/typed-subject-exclusions.json`. Source-of-truth detail:
project-memory dossier `project_event_subject_contracts`.
```

- [ ] **Step 2: Add a shorter pointer** in `docs/agent-system.md` (agents are producers of
`AgentCompletionRow`/`AgentFailureRow` etc.) referencing the same section, noting agent
completion rows use the shared `TableEntry`-based `AgentCompletionRow<A, O>` generic and
agent subject reads go through `parseSubject`/registered polymorphic exceptions.

- [ ] **Step 3: Add a one-paragraph note** in `.claude/skills/cdk-patterns/SKILL.md`
stating that cross-domain contract/name sharing is done via the producer-domain adapter's
`/domain` re-export (the `*-adpt/domain` channel enforced by `nx lint`), not direct
service-to-service `/contracts` imports.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md docs/agent-system.md .claude/skills/cdk-patterns/SKILL.md
git commit --no-verify -m "docs(arch): document typed-subject conventions + enforcement"
git log --oneline -1
```

---

## Phase E — Split out the card-drift gate backlog item

### Task E1: File `service-card-drift-gate`

- [ ] **Step 1: Create the backlog item** via the `backlog-add` skill with these facts:
  - id: `service-card-drift-gate`, type: `tooling`, status: `queued` (rank next after the
    current QUEUED set — confirm against `docs/BACKLOG.md` at file time).
  - Summary: a deterministic checker (mirroring `check-read-model-drift.mjs`) that parses
    `service.stack.ts` / `events.ts` and diffs the MECHANICALLY-derivable CLAUDE.md
    service-card sections (Ingress subscriptions, Egress `eventTypes` map, Handlers, Event
    Types, DDB entities) against the card; fails CI on mismatch. Prose/intent sections stay
    LLM-regenerated (not gated). **Subsumes `service-card-funding-event-type-drift`**
    (close that as `dropped` with `[SUPERSEDED -> service-card-drift-gate]`, or note it).
  - Note that it was split out of `typing-convention-enforcement-skills-docs` on 2026-06-12
    (distinct checker; only shares the deterministic-checker + nx-target pattern).

- [ ] **Step 2: Run lint + commit** (backlog-add runs `--fix`; verify):

Run: `node .claude/skills/backlog-lint/lint.mjs --fix`
Expected: all rules pass.
```bash
git add docs/backlog docs/BACKLOG.md
git commit --no-verify -m "docs(backlog): split out service-card-drift-gate from typed-subject capstone"
git log --oneline -1
```

---

## Final verification (before ship)

- [ ] `node --test tools/check-typed-subjects.test.mjs` → all pass.
- [ ] `node tools/check-typed-subjects.mjs` → `typed-subject: OK (…, 0 violation(s))`.
- [ ] `pnpm nx run event-processor:typed-subject-drift` → PASS.
- [ ] `pnpm nx run-many -t build,lint -p decision-workflow-ctrl compliance-ctrl investor-profile-ctrl dashboard-bff investor-bff ledger-adpt investor-adpt` → PASS (convention 2 green; the negative check in A5/Step 5 proved the rule bites).
- [ ] `grep -rn "InvestorBffEventTypes\|LedgerCtrlEventTypes" services/advisory/*/src services/investor/{dashboard-bff,investor-bff}/src` → no cross-domain matches remain.
- [ ] No functional/behaviour change shipped (the 11 repointings are type-only re-exports; same event-name values, same schemas, same CDK rules) → no e2e behaviour to assert.

## Notes for the closing phase (executor: route through `/backlog-next` Step 6)

- **Deploy:** the `services/**/src` edits are type-only. `detect-deploy-needed.mjs` will
  false-positive (incl. on the new `tools/*.mjs`, per `detect-deploy-tools-path-no-deploy`).
  Either skip deploy with the behaviour-identical rationale, or do a type-only redeploy +
  light smoke of `compliance-ctrl decision-workflow-ctrl investor-profile-ctrl dashboard-bff
  investor-bff` (dev sandbox, pre-authorized). No e2e behaviour changed.
- **`validation_gate`:** fill with the gate-green output + `nx lint`/`build` results +
  test output (commit SHAs).

## Spec ↔ plan coverage check

- Conventions 1/4/opaqueSubject/3-heuristic → Tasks B1–B3 (gate). ✓
- Convention 2 (import channel) → Tasks A1–A5 (nx) + the 11 fixes. ✓
- Convention 5 → skills/docs only (C1, D1). ✓
- nx target + pre-commit → B4, B5. ✓
- Skills (create-*/audit-*) → C1, C2. ✓
- Arch docs → D1. ✓
- Card-drift gate split → E1. ✓
- Test-app exemption → A5 Step 3. ✓
- Exclusion registry seeded from audited exceptions → B3. ✓
