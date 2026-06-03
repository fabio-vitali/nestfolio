# Read-Model Ownership WS-D — Governance Capstone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single-writer read-model ownership model fully enforced across the *whole* system by registering the last governed producer rows and upgrading the drift-checker from an advisory INFO list to a mandatory error gate backed by an explicit exclusion registry.

**Architecture:** The drift-checker (`tools/check-read-model-drift.mjs`, nx target `event-processor:read-model-drift`) today scans every service but only *reports* unregistered intent-factory writes as non-failing INFO. WS-D (a) registers the remaining governed producer rows (`ExecutionMode` in broker-ctrl; `ReconciliationResult`/`DriftRecord` in reconciliation-ctrl; `FeatureFlag` documentary in investor-bff), (b) creates `tools/read-model-exclusions.json` listing the verified non-governed outbox/carrier/feed-cache rows, and (c) upgrades the checker so any **intent-factory** write that is neither registered nor excluded is a hard ERROR. It also registers `typecheck` in `nx.json` `targetDefaults` so `nx affected -t typecheck` mechanically runs every per-service ownership type-test, and brings the canonical doc + skills in sync. All code changes are type-only augmentations + tooling — **no runtime bundle change, no deploy** (verified: augmentation files are `declare module` + `export {}`, stripped by esbuild; the program-end e2e runs against already-converged dev).

**Tech Stack:** TypeScript declaration-merging (`declare module '@nestfolio/event-processor'`), Node.js ESM tooling (`node:fs`/`node:test`), nx `run-commands` targets, `tsc --noEmit` type-test configs.

---

## Decisions locked (from brainstorming + user choice 2026-06-03)

- **`ReconciliationResult` + `DriftRecord`** → **register `CommandOwned`** in reconciliation-ctrl (user-chosen). Evidence: reconciliation-ctrl computes them and reads them back via `getDriftRecords`; no other service projects the rows (consumers react to the emitted events). Behavior-free (`record()` stays valid).
- **`ExecutionMode`** → register `CommandOwned` in broker-ctrl (design-mandated; single-field cache via `record()`; no `__version` — add one only if a P1 consumer of the mode cache ever appears).
- **`FeatureFlag`** → register `CommandOwned` (documentary) in investor-bff. It is an AppSync command write (not an intent factory), so the gate does **not require** it, but it is plainly a governed UI-read row; registering it matches the `UserConfirmation`/`UserRejection`/`UserInteraction` precedent and clears it from the INFO list.
- **Gate scope** = intent-factory writes only must be register-or-exclude (faithful to the design's enforcement section). Command writes (`*.fn.js __typename`) remain scanned for the R3 dual-writer rule and reported as non-failing INFO if unregistered — they are not subject to the mandatory error.
- **Exclusion granularity** = per-`(service, typename)` (matches the registry's per-service keying + the WS-C R4 refinement). Each entry carries a one-line `reason`.

## The 29 INFO write-sites → disposition

**Register `CommandOwned`** (4 typenames):
- `ExecutionMode` — broker-ctrl
- `ReconciliationResult`, `DriftRecord` — reconciliation-ctrl
- `FeatureFlag` — investor-bff (documentary; command write)

**Exclude (25 INFO lines)** in `tools/read-model-exclusions.json`:
- Agent execution-trace/outbox: `AgentCompletion` (advisory-narrative-ctrl, portfolio-engine-ctrl), `AgentFailure` (advisory-narrative-ctrl, portfolio-engine-ctrl), `AgentInvocation` (advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl), `AgentOutput` (decision-workflow-ctrl)
- Ledger `snapshot-to-events` outbox: `BalanceEvent`, `LedgerEntryEvent`, `PortfolioEvent`, `SnapshotHistory` (ledger-ctrl)
- Funding CDC carriers: `FundingEvent` (broker-ctrl), `DepositDetected` (broker-sim-adpt), `WithdrawalCompleted` (broker-sim-adpt)
- External-feed adapter caches: `AlpacaAccountSnapshot`, `AlpacaOrderResult`, `AlpacaTransferResult` (broker-alpaca-adpt), `AlphaVantageArticle`, `EconomicIndicator` (alpha-vantage-adpt), `FredIndicator` (fred-adpt), `MarketWatchArticle` (marketwatch-adpt), `SecFiling` (sec-edgar-adpt), `YahooFinanceArticle` (yahoo-finance-adpt)

## File Structure

- `services/execution/broker-ctrl/src/read-model-ownership.ts` — **create** (augmentation)
- `services/execution/broker-ctrl/src/handlers/mode-listener.ts` — **modify** (side-effect import)
- `services/execution/broker-ctrl/test/types/read-model-ownership.type-test.ts` — **create**
- `services/execution/broker-ctrl/tsconfig.type-test.json` — **create**
- `services/execution/broker-ctrl/project.json` — **modify** (add `typecheck` target)
- `services/ledger/reconciliation-ctrl/src/read-model-ownership.ts` — **create**
- `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts` — **modify** (side-effect import)
- `services/ledger/reconciliation-ctrl/test/types/read-model-ownership.type-test.ts` — **create**
- `services/ledger/reconciliation-ctrl/tsconfig.type-test.json` — **create**
- `services/ledger/reconciliation-ctrl/project.json` — **modify** (add `typecheck` target)
- `services/investor/investor-bff/src/read-model-ownership.ts` — **modify** (add `FeatureFlag`)
- `services/investor/investor-bff/test/types/read-model-ownership.type-test.ts` — **modify** (assert `FeatureFlag`)
- `tools/read-model-exclusions.json` — **create** (25 entries)
- `tools/check-read-model-drift.mjs` — **modify** (load exclusions; R5 unclassified-write; R6 exclusion-conflict; INFO/main rework; header comment)
- `tools/check-read-model-drift.test.mjs` — **modify** (rewrite INFO test; add R5/R6/exclusion/parse tests)
- `libs/event-processor/project.json` — **modify** (`read-model-drift` inputs += exclusions file)
- `nx.json` — **modify** (`targetDefaults.typecheck`)
- `docs/architecture/READ-MODEL-OWNERSHIP.md` — **modify** (§9 producer table; §10 enforcement)
- `.claude/skills/event-processor-patterns/SKILL.md` — **modify** (filename fix; per-factory table; exclusion note)
- `.claude/skills/create-service/SKILL.md`, `.claude/skills/create-feature/SKILL.md`, `.claude/skills/create-event/SKILL.md` — **modify** (exclusion-registry option)
- `.claude/skills/audit-service/SKILL.md`, `.claude/skills/audit-domain/SKILL.md`, `.claude/skills/audit-system/SKILL.md` — **modify** (mandatory-gate + exclusion language)
- `CLAUDE.md` — **modify** (exclusion-registry mention; mandatory)

---

### Task 1: Register `ExecutionMode` (CommandOwned) in broker-ctrl

**Files:**
- Create: `services/execution/broker-ctrl/src/read-model-ownership.ts`
- Modify: `services/execution/broker-ctrl/src/handlers/mode-listener.ts:1`
- Create: `services/execution/broker-ctrl/test/types/read-model-ownership.type-test.ts`
- Create: `services/execution/broker-ctrl/tsconfig.type-test.json`
- Modify: `services/execution/broker-ctrl/project.json`

- [ ] **Step 1: Create the augmentation**

`services/execution/broker-ctrl/src/read-model-ownership.ts`:
```ts
/**
 * broker-ctrl read-model ownership registration (WS-D).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - ExecutionMode : CommandOwned single-field operating-mode cache, seeded /
 *     refreshed via record() on EXECUTION_MODE_CHANGED. Read by the order
 *     state-machine's ReadExecutionMode GetItem (read-your-own-writes). No
 *     __version — add one only if a P1 consumer of the cache is introduced.
 *     projectVersioned() on it must fail typecheck.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    ExecutionMode: CommandOwned;
  }
}

export {};
```

- [ ] **Step 2: Side-effect import it from the handler** (matches execution-ctrl/investor-ctrl/compliance-ctrl convention; types-only, stripped by esbuild → no runtime delta)

In `services/execution/broker-ctrl/src/handlers/mode-listener.ts`, add as the first import line (before the existing `import { materializeToTable, ... }`):
```ts
import '../read-model-ownership';
```

- [ ] **Step 3: Write the type-test (the failing-then-passing proof)**

`services/execution/broker-ctrl/test/types/read-model-ownership.type-test.ts`:
```ts
/**
 * Compile-time proof that broker-ctrl's ownership registration rejects the
 * wrong write intents. Verified by `nx run broker-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned cache seeded/refreshed by one idempotent event: record() is allowed.
record('ExecutionMode', { mode: 'simulation' });

// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('ExecutionMode', { mode: 'simulation' }, { version: 1 });

export {};
```

- [ ] **Step 4: Create the type-test tsconfig**

`services/execution/broker-ctrl/tsconfig.type-test.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 5: Add the `typecheck` target** to `services/execution/broker-ctrl/project.json` `targets` (sibling of the existing `test`/`lint` targets):
```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/execution/broker-ctrl/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 6: Run the type-test — expect PASS**

Run: `pnpm nx run broker-ctrl:typecheck`
Expected: PASS. (If the `ExecutionMode: CommandOwned` line were missing or mistyped, the `@ts-expect-error` would have nothing to suppress and `tsc` would fail with "Unused '@ts-expect-error' directive" — that is the trip-wire working.)

- [ ] **Step 7: Confirm the checker now sees it registered**

Run: `node tools/check-read-model-drift.mjs 2>&1 | grep -i ExecutionMode || echo "ExecutionMode no longer in INFO"`
Expected: `ExecutionMode no longer in INFO`.

- [ ] **Step 8: Commit**
```bash
git add services/execution/broker-ctrl
git commit -m "feat(broker-ctrl): register ExecutionMode CommandOwned (read-model WS-D)"
```

---

### Task 2: Register `ReconciliationResult` + `DriftRecord` (CommandOwned) in reconciliation-ctrl

**Files:**
- Create: `services/ledger/reconciliation-ctrl/src/read-model-ownership.ts`
- Modify: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts:1`
- Create: `services/ledger/reconciliation-ctrl/test/types/read-model-ownership.type-test.ts`
- Create: `services/ledger/reconciliation-ctrl/tsconfig.type-test.json`
- Modify: `services/ledger/reconciliation-ctrl/project.json`

- [ ] **Step 1: Create the augmentation**

`services/ledger/reconciliation-ctrl/src/read-model-ownership.ts`:
```ts
/**
 * reconciliation-ctrl read-model ownership registration (WS-D).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - ReconciliationResult / DriftRecord : CommandOwned rows reconciliation-ctrl
 *     computes from its own reconcile() logic, writes via record(), and reads
 *     back via getDriftRecords (read-your-own-writes). No other service projects
 *     the rows — consumers react to the emitted RECONCILIATION_COMPLETED /
 *     PORTFOLIO_DRIFT_DETECTED events. projectVersioned() on them must fail
 *     typecheck.
 */
import type { CommandOwned } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    ReconciliationResult: CommandOwned;
    DriftRecord: CommandOwned;
  }
}

export {};
```

- [ ] **Step 2: Side-effect import it from the handler**

In `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`, add as the first import line:
```ts
import '../read-model-ownership';
```

- [ ] **Step 3: Write the type-test**

`services/ledger/reconciliation-ctrl/test/types/read-model-ownership.type-test.ts`:
```ts
/**
 * Compile-time proof that reconciliation-ctrl's ownership registration rejects
 * the wrong write intents. Verified by `nx run reconciliation-ctrl:typecheck`.
 */
import { record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// CommandOwned owned rows written via record(): allowed.
record('ReconciliationResult', { status: 'OK' });
record('DriftRecord', { instrument: 'AAPL' });

// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('ReconciliationResult', { status: 'OK' }, { version: 1 });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('DriftRecord', { instrument: 'AAPL' }, { version: 1 });

export {};
```

- [ ] **Step 4: Create the type-test tsconfig**

`services/ledger/reconciliation-ctrl/tsconfig.type-test.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/read-model-ownership.ts", "test/types/**/*.ts"]
}
```

- [ ] **Step 5: Add the `typecheck` target** to `services/ledger/reconciliation-ctrl/project.json` `targets`:
```json
"typecheck": {
  "executor": "nx:run-commands",
  "options": {
    "command": "tsc --noEmit -p services/ledger/reconciliation-ctrl/tsconfig.type-test.json"
  }
}
```

- [ ] **Step 6: Run the type-test — expect PASS**

Run: `pnpm nx run reconciliation-ctrl:typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add services/ledger/reconciliation-ctrl
git commit -m "feat(reconciliation-ctrl): register ReconciliationResult + DriftRecord CommandOwned (read-model WS-D)"
```

---

### Task 3: Register `FeatureFlag` (CommandOwned, documentary) in investor-bff

**Files:**
- Modify: `services/investor/investor-bff/src/read-model-ownership.ts`
- Modify: `services/investor/investor-bff/test/types/read-model-ownership.type-test.ts`

- [ ] **Step 1: Read the current investor-bff augmentation**

Run: `cat services/investor/investor-bff/src/read-model-ownership.ts`
Note the existing `interface ReadModelOwnership { ... }` block (it already declares `CashBalance`, `Deposit`, `WithdrawalRequest` as P1 and `InvestorProfile`, `Mandate`, `Notification`, `DepositIntent`, `WithdrawalIntent` as `CommandOwned`).

- [ ] **Step 2: Add `FeatureFlag: CommandOwned;`** to the `CommandOwned` group inside that interface, and extend the file's doc comment with one line:
```
 *   - FeatureFlag : CommandOwned system flag store, written only by the
 *     updateFeatureFlag AppSync resolver (and the circuit-breaker IAM-signed
 *     mutation), read by getFeatureFlags + the onFeatureFlagUpdate subscription.
 *     Documentary registration (command write, not an intent factory).
```

- [ ] **Step 3: Add the trip-wire assertions** to `services/investor/investor-bff/test/types/read-model-ownership.type-test.ts` (mirror the existing CommandOwned assertions in that file):
```ts
// FeatureFlag — CommandOwned (command-written system flag).
record('FeatureFlag', { name: 'confirmDecision', enabled: true });
// @ts-expect-error — projectVersioned on a command-owned row must not typecheck
projectVersioned('FeatureFlag', { name: 'confirmDecision', enabled: true }, { version: 1 });
```
(If `record`/`projectVersioned` are not yet imported in that test file, add them to its top import from `@nestfolio/event-processor`.)

- [ ] **Step 4: Run investor-bff typecheck — expect PASS**

Run: `pnpm nx run investor-bff:typecheck`
Expected: PASS. (This target uses the narrow `tsconfig.type-test.json` that includes only `src/read-model-ownership.ts` + `test/types/**`, so the unrelated `investor-bff-13-latent-tsc-errors` do not block it.)

- [ ] **Step 5: Confirm FeatureFlag leaves the INFO list**

Run: `node tools/check-read-model-drift.mjs 2>&1 | grep -i FeatureFlag || echo "FeatureFlag no longer in INFO"`
Expected: `FeatureFlag no longer in INFO`.

- [ ] **Step 6: Commit**
```bash
git add services/investor/investor-bff
git commit -m "feat(investor-bff): register FeatureFlag CommandOwned documentary (read-model WS-D)"
```

---

### Task 4: Create the exclusion registry

**Files:**
- Create: `tools/read-model-exclusions.json`

- [ ] **Step 1: Write the registry** (25 verified non-governed `(service, typename)` entries)

`tools/read-model-exclusions.json`:
```json
{
  "$comment": "Read-model ownership EXCLUSION registry (WS-D). Each (service, typename) listed here is a verified NON-governed row — an outbox/CDC-carrier or external-feed cache written via an event-processor intent factory but NOT a governed read model. The drift gate (tools/check-read-model-drift.mjs) errors on any intent-factory write that is neither registered in a ReadModelOwnership augmentation NOR listed here. See docs/architecture/READ-MODEL-OWNERSHIP.md §9. Keep alphabetised by service then typename.",
  "exclusions": [
    { "service": "advisory-narrative-ctrl", "typename": "AgentCompletion", "reason": "Agent execution-trace/outbox row; write-once diagnostic consumed via emitted trace events, never read back as a governed read model." },
    { "service": "advisory-narrative-ctrl", "typename": "AgentFailure", "reason": "Agent execution-trace/outbox row; write-once diagnostic consumed via emitted trace events." },
    { "service": "advisory-narrative-ctrl", "typename": "AgentInvocation", "reason": "Agent execution-trace/outbox row; write-once diagnostic consumed via emitted trace events." },
    { "service": "alpha-vantage-adpt", "typename": "AlphaVantageArticle", "reason": "External-feed adapter cache; raw Alpha Vantage feed item persisted for CDC re-emission, not a governed aggregate." },
    { "service": "alpha-vantage-adpt", "typename": "EconomicIndicator", "reason": "External-feed adapter cache; raw Alpha Vantage indicator persisted for CDC re-emission." },
    { "service": "broker-alpaca-adpt", "typename": "AlpacaAccountSnapshot", "reason": "External-feed adapter cache; raw Alpaca account result persisted for CDC re-emission." },
    { "service": "broker-alpaca-adpt", "typename": "AlpacaOrderResult", "reason": "External-feed adapter cache; raw Alpaca order result persisted for CDC re-emission." },
    { "service": "broker-alpaca-adpt", "typename": "AlpacaTransferResult", "reason": "External-feed adapter cache; raw Alpaca transfer result persisted for CDC re-emission." },
    { "service": "broker-ctrl", "typename": "FundingEvent", "reason": "Funding-lifecycle CDC carrier; one immutable row per transition re-emitted via sk-passthrough. Governed funding read model is investor-bff Deposit/WithdrawalRequest (P1)." },
    { "service": "broker-sim-adpt", "typename": "DepositDetected", "reason": "Sim-broker funding CDC carrier; write-once keyed by source eventId, emitted only to publish DEPOSIT_DETECTED. Governed funding read model is investor-bff (P1)." },
    { "service": "broker-sim-adpt", "typename": "WithdrawalCompleted", "reason": "Sim-broker funding CDC carrier; write-once keyed by source eventId, emitted only to publish WITHDRAWAL_COMPLETED. Governed funding read model is investor-bff (P1)." },
    { "service": "decision-workflow-ctrl", "typename": "AgentOutput", "reason": "Agent execution-trace/outbox row written by sfn-callback; consumed via the decision pipeline, not read back as a governed read model." },
    { "service": "fred-adpt", "typename": "FredIndicator", "reason": "External-feed adapter cache; raw FRED indicator persisted for CDC re-emission." },
    { "service": "investor-profile-ctrl", "typename": "AgentInvocation", "reason": "Agent execution-trace/outbox row; write-once diagnostic consumed via emitted trace events." },
    { "service": "ledger-ctrl", "typename": "BalanceEvent", "reason": "Ledger snapshot-to-events outbox/carrier; emitted purely to drive CDC (BALANCE_UPDATED). Governed read models are downstream BFF projections." },
    { "service": "ledger-ctrl", "typename": "LedgerEntryEvent", "reason": "Ledger snapshot-to-events outbox/carrier; emitted purely to drive CDC (LEDGER_ENTRY_RECORDED)." },
    { "service": "ledger-ctrl", "typename": "PortfolioEvent", "reason": "Ledger snapshot-to-events outbox/carrier; emitted purely to drive CDC (PORTFOLIO_UPDATED)." },
    { "service": "ledger-ctrl", "typename": "SnapshotHistory", "reason": "Ledger snapshot-to-events append-only history row with TTL; carrier/audit log, not a governed read model." },
    { "service": "market-intelligence-ctrl", "typename": "AgentInvocation", "reason": "Agent execution-trace/outbox row; write-once diagnostic consumed via emitted trace events." },
    { "service": "marketwatch-adpt", "typename": "MarketWatchArticle", "reason": "External-feed adapter cache; raw MarketWatch feed item persisted for CDC re-emission." },
    { "service": "portfolio-engine-ctrl", "typename": "AgentCompletion", "reason": "Agent execution-trace/outbox row; write-once diagnostic consumed via emitted trace events." },
    { "service": "portfolio-engine-ctrl", "typename": "AgentFailure", "reason": "Agent execution-trace/outbox row; write-once diagnostic consumed via emitted trace events." },
    { "service": "portfolio-engine-ctrl", "typename": "AgentInvocation", "reason": "Agent execution-trace/outbox row; write-once diagnostic consumed via emitted trace events." },
    { "service": "sec-edgar-adpt", "typename": "SecFiling", "reason": "External-feed adapter cache; raw SEC EDGAR filing persisted for CDC re-emission." },
    { "service": "yahoo-finance-adpt", "typename": "YahooFinanceArticle", "reason": "External-feed adapter cache; raw Yahoo Finance feed item persisted for CDC re-emission." }
  ]
}
```

- [ ] **Step 2: Validate it is well-formed JSON**

Run: `node -e "const j=require('./tools/read-model-exclusions.json'); console.log(j.exclusions.length, 'exclusions')"`
Expected: `25 exclusions`.

- [ ] **Step 3: Commit**
```bash
git add tools/read-model-exclusions.json
git commit -m "feat(tools): add read-model-exclusions.json — 25 verified non-governed rows (WS-D)"
```

---

### Task 5: Upgrade the drift-checker to a mandatory gate (TDD)

**Files:**
- Modify: `tools/check-read-model-drift.mjs`
- Modify: `tools/check-read-model-drift.test.mjs`
- Test: `tools/check-read-model-drift.test.mjs` (run via `node --test`)

- [ ] **Step 1: Write the failing tests first**

In `tools/check-read-model-drift.test.mjs`:

(a) Add `parseExclusions` to the import block at the top (line 11–16):
```js
import {
  parseRegistry,
  scanIntentCalls,
  scanCommandWrites,
  parseExclusions,
  evaluate,
} from './check-read-model-drift.mjs';
```

(b) Update the `evalTree` helper (currently around line 160) to load + pass exclusions:
```js
function evalTree(files) {
  return withTree(files, (root) => {
    const { registry, conflicts } = parseRegistry(root);
    const { exclusions } = parseExclusions(root);
    return evaluate(registry, conflicts, scanIntentCalls(root), scanCommandWrites(root), exclusions);
  });
}
```

(c) **Replace** the existing INFO test (currently around line 216, `'INFO: factory-written but unregistered typenames are reported, not errored'`) with the new mandatory-gate behavior, and add the exclusion/command/conflict/parse tests:
```js
test('R5: an unregistered + unexcluded intent-factory write is a HARD ERROR', () => {
  const { errors } = evalTree({
    'services/x/x-ctrl/src/t.ts': `record('Order', {});`,
  });
  assert.equal(errors.filter(e => e.rule === 'unclassified-write').length, 1);
});

test('R5: an EXCLUDED intent-factory write is clean (no error)', () => {
  const { errors, info } = evalTree({
    'services/x/x-ctrl/src/t.ts': `record('Carrier', {});`,
    'tools/read-model-exclusions.json':
      `{ "exclusions": [ { "service": "x-ctrl", "typename": "Carrier", "reason": "outbox carrier" } ] }`,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(!info.some(i => i.typename === 'Carrier'));
});

test('R5: a REGISTERED intent-factory write is clean (no error)', () => {
  const { errors } = evalTree({
    'services/x/x-ctrl/src/read-model-ownership.ts': `interface ReadModelOwnership { Order: CommandOwned; }`,
    'services/x/x-ctrl/src/t.ts': `record('Order', {});`,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
});

test('gate is intent-factory-scoped: an unregistered command-write is INFO, not an error', () => {
  const { errors, info } = evalTree({
    'services/x/x-bff/src/graphql/js-function/c.fn.js': `const x = { __typename: 'FeatureFlag' };`,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(info.some(i => i.typename === 'FeatureFlag'));
});

test('R6: a typename both registered AND excluded is a conflict error', () => {
  const { errors } = evalTree({
    'services/x/x-ctrl/src/read-model-ownership.ts': `interface ReadModelOwnership { Order: CommandOwned; }`,
    'services/x/x-ctrl/src/t.ts': `record('Order', {});`,
    'tools/read-model-exclusions.json':
      `{ "exclusions": [ { "service": "x-ctrl", "typename": "Order", "reason": "dup" } ] }`,
  });
  assert.equal(errors.filter(e => e.rule === 'exclusion-conflict').length, 1);
});

test('parseExclusions returns empty when the file is absent', () => {
  withTree({ 'services/x/x-bff/src/t.ts': `record('A', {});` }, (root) => {
    const { exclusions, entries } = parseExclusions(root);
    assert.equal(exclusions.size, 0);
    assert.equal(entries.length, 0);
  });
});

test('parseExclusions throws on an entry missing service/typename/reason', () => {
  withTree({
    'tools/read-model-exclusions.json': `{ "exclusions": [ { "typename": "A" } ] }`,
  }, (root) => {
    assert.throws(() => parseExclusions(root), /read-model-exclusions\.json/);
  });
});
```

(d) Update the CLI section: keep the existing R1 drift test, and add a CLI test that an unclassified write exits 1 and that excluding it exits 0:
```js
test('CLI exits 1 on an unregistered + unexcluded intent-factory write', () => {
  withTree({
    'services/x/x-ctrl/src/t.ts': `record('Ungoverned', {});`,
  }, (root) => {
    const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1, `stdout: ${r.stdout}`);
    assert.match(r.stdout + r.stderr, /Ungoverned/);
  });
});

test('CLI exits 0 when the write is excluded', () => {
  withTree({
    'services/x/x-ctrl/src/t.ts': `record('Ungoverned', {});`,
    'tools/read-model-exclusions.json':
      `{ "exclusions": [ { "service": "x-ctrl", "typename": "Ungoverned", "reason": "carrier" } ] }`,
  }, (root) => {
    const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 0, `stderr: ${r.stderr}\nstdout: ${r.stdout}`);
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL** (`parseExclusions` not exported; R5/R6 not implemented)

Run: `node --test tools/check-read-model-drift.test.mjs`
Expected: failures referencing `parseExclusions is not a function` / missing `unclassified-write` + `exclusion-conflict` errors.

- [ ] **Step 3: Implement `parseExclusions`** in `tools/check-read-model-drift.mjs`

After the existing `parseArgs` function (around line 52), add:
```js
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
```

- [ ] **Step 4: Add `exclusions` to `evaluate` + implement R5 & R6**

Change the `evaluate` signature (around line 164) to accept exclusions with a safe default:
```js
export function evaluate(registry, conflicts, calls, commands, exclusions = new Set()) {
```

After the R4 conflicts loop (around line 200–203), add R5 + R6:
```js
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
```

Then rework the INFO loop (currently around line 205–214) so it (1) only surfaces **command** writes that are unregistered+unexcluded (intent calls are now gated by R5), and (2) skips excluded entries:
```js
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
```

- [ ] **Step 5: Wire `parseExclusions` into `main()`**

In `main()` (around line 219), load exclusions and pass them through, and update the INFO header + OK line:
```js
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
  // ... existing FAIL printing unchanged ...
}
```

- [ ] **Step 6: Update the header comment block** (lines 1–33) — document R5/R6 + the exclusion registry, and remove the "unregistered = INFO, not errored" paragraph (now false). Replace that paragraph with:
```
//   R5 unclassified-write       — an intent-factory write whose typename is neither
//                                 registered in a ReadModelOwnership augmentation NOR
//                                 listed in tools/read-model-exclusions.json. MANDATORY
//                                 gate: register it or add it to the exclusion registry.
//                                 (Command writes — *.fn.js __typename — are NOT gated
//                                 here; they are surfaced as non-failing INFO.)
//   R6 exclusion-conflict       — a (service, typename) both registered AND excluded.
//
// The exclusion registry (tools/read-model-exclusions.json) lists the verified
// non-governed outbox/carrier and external-feed-cache rows, each with a reason.
```

- [ ] **Step 7: Run the tests — expect PASS**

Run: `node --test tools/check-read-model-drift.test.mjs`
Expected: all tests pass.

- [ ] **Step 8: Add the exclusions file to the nx target inputs** (so the cache invalidates when exclusions change)

In `libs/event-processor/project.json`, add `"{workspaceRoot}/tools/read-model-exclusions.json"` to the `read-model-drift` target's `inputs` array (after the `check-read-model-drift.mjs` entry).

- [ ] **Step 9: Run the real gate end-to-end — expect GREEN**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: `read-model-drift: OK (44 registered typename(s), 25 excluded, 0 drift)` and exit 0. (40 prior + ExecutionMode + ReconciliationResult + DriftRecord + FeatureFlag = 44. INFO section absent.)
If any `unclassified-write` error appears, an intent-factory write was missed — add it to the registry (if governed) or exclusions (if a verified carrier) before proceeding.

- [ ] **Step 10: Commit**
```bash
git add tools/check-read-model-drift.mjs tools/check-read-model-drift.test.mjs libs/event-processor/project.json
git commit -m "feat(tools): drift-checker mandatory gate — R5 unclassified-write + R6 exclusion-conflict (WS-D)"
```

---

### Task 6: Register `typecheck` in nx.json targetDefaults

**Files:**
- Modify: `nx.json`

- [ ] **Step 1: Read the current targetDefaults**

Run: `node -e "const j=require('./nx.json'); console.log(JSON.stringify(j.targetDefaults.lint, null, 2))"`
Note the shape of an existing simple target default (for matching style).

- [ ] **Step 2: Add a `typecheck` entry** to `nx.json` `targetDefaults`, so `nx affected -t typecheck` discovers every per-service `typecheck` target (the folded `bff-readmodel-typecheck-targets-not-in-ci` trip-wire). Use:
```json
"typecheck": {
  "cache": true,
  "inputs": ["default", "^default"]
}
```
(The per-service targets already define their own `command`; `targetDefaults` only needs to register the target name + caching so it participates in `affected`. Match the surrounding indentation/trailing-comma style of the existing `lint`/`test` entries.)

- [ ] **Step 3: Verify affected discovery**

Run: `pnpm nx show project broker-ctrl --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s).targets).filter(t=>t==='typecheck')))"`
Expected: `[ 'typecheck' ]`.

Run: `pnpm nx run-many -t typecheck --projects=broker-ctrl,reconciliation-ctrl,investor-bff,execution-ctrl`
Expected: all 4 PASS.

- [ ] **Step 4: Commit**
```bash
git add nx.json
git commit -m "build(nx): register typecheck targetDefault so ownership type-tests gate via affected (WS-D)"
```

---

### Task 7: Extend the canonical doc (§9 producer table + §10 enforcement)

**Files:**
- Modify: `docs/architecture/READ-MODEL-OWNERSHIP.md`

- [ ] **Step 1: Extend §9** — after the existing per-row classification table (the row ending `... settlement drives the row | projection P1`), insert a producer-surface subsection before `### 9.1`:
```markdown
### Producer-surface classification (WS-D, 2026-06-03)

The producer/`-ctrl`/`-adpt` surface is now registered or explicitly excluded. The
drift gate is **mandatory**: every typename written via an event-processor intent
factory must be registered below or listed in `tools/read-model-exclusions.json`.

| Service | Row(s) | Kind |
|---|---|---|
| broker-ctrl | `ExecutionMode` | command-owned (single-field mode cache; no `__version` until a P1 consumer appears) |
| reconciliation-ctrl | `ReconciliationResult`, `DriftRecord` | command-owned (computed + read-your-own-writes via `getDriftRecords`) |
| investor-bff | `FeatureFlag` | command-owned (documentary; AppSync-written, UI-read) |
| execution-ctrl | `Order`, `StagedOrder` | command-owned (WS-A) |
| investor-ctrl | `Notification`, `MonthlyReport` | command-owned (WS-A) |
| compliance-ctrl | `ComplianceCheck`, `AuditArtifact` | projection P2 (WS-A) |
| market-intelligence-ctrl | `MarketSnapshot` | command-owned (owner; WS-A/B) |
| investor-profile-ctrl | `InvestorProfileSnapshot` | command-owned (owner; WS-A/B) |
| decision-workflow-ctrl | `DecisionPacket` | command-owned; mirrors `LedgerSnapshot`/`InvestorProfileSnapshot`/`MarketSnapshot`/`MandateSnapshot` as projection P1 (WS-A/C) |

**Verified non-governed (excluded, not registered)** — outbox/CDC-carrier and
external-feed-cache rows, enumerated with reasons in `tools/read-model-exclusions.json`:
agent execution-trace rows (`AgentCompletion`/`AgentFailure`/`AgentInvocation`/`AgentOutput`);
ledger `snapshot-to-events` carriers (`BalanceEvent`/`LedgerEntryEvent`/`PortfolioEvent`/`SnapshotHistory`);
funding CDC carriers (`FundingEvent`, `DepositDetected`, `WithdrawalCompleted`);
external-feed adapter caches (`Alpaca*`, `AlphaVantageArticle`, `EconomicIndicator`,
`FredIndicator`, `MarketWatchArticle`, `SecFiling`, `YahooFinanceArticle`).
```

- [ ] **Step 2: Rewrite §10** to reflect shipped state + the mandatory gate. Replace the "**Governance workstream (w6) will add layers 3 + 4:**" block (and its layer 3/4 bullets) with:
```markdown
**Layers 3 + 4 shipped (w6 + producer-aggregates WS-A–WS-D):**

3. **Skill guidance** — `event-processor-patterns`, `create-service`, `create-feature`,
   `create-event`, `testing-patterns`, and the `CLAUDE.md` router carry the model.

4. **Drift gate (mandatory)** — `tools/check-read-model-drift.mjs` / nx target
   `event-processor:read-model-drift`, repo-wide. Rules: R1 accumulate-on-projection;
   R2 unguarded P1; R3 command+event dual-writer; R4 within-service registry conflict;
   **R5 unclassified-write** (an intent-factory write neither registered nor excluded —
   hard fail); R6 exclusion-conflict. `tools/read-model-exclusions.json` holds the
   verified non-governed outbox/carrier/feed-cache rows. (Wiring the gate into the
   GitHub PR workflow stays with `ci-pipeline-bring-up`; WS-D ships it as a
   local-runnable nx target.) `audit-service`/`audit-domain`/`audit-system` invoke it.
```

- [ ] **Step 3: Commit**
```bash
git add docs/architecture/READ-MODEL-OWNERSHIP.md
git commit -m "docs(architecture): extend READ-MODEL-OWNERSHIP §9 to producer surface + §10 mandatory gate (WS-D)"
```

---

### Task 8: Update skill + router pointers

**Files:**
- Modify: `.claude/skills/event-processor-patterns/SKILL.md`
- Modify: `.claude/skills/create-service/SKILL.md`, `.claude/skills/create-feature/SKILL.md`, `.claude/skills/create-event/SKILL.md`
- Modify: `.claude/skills/audit-service/SKILL.md`, `.claude/skills/audit-domain/SKILL.md`, `.claude/skills/audit-system/SKILL.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: event-processor-patterns — fix the stale filename.** In the `### ReadModelOwnership registry` section, change `the service's \`src/ownership.ts\`` to `the service's \`src/read-model-ownership.ts\` (side-effect-imported from a handler)`.

- [ ] **Step 2: event-processor-patterns — fix the per-factory table's "unregistered" allowance** (the table under `### Per-factory constraint summary`). Append a sentence under the table:
```markdown
> **The drift gate is mandatory** (`event-processor:read-model-drift`): "unregistered" is allowed by the *type system* but **fails the gate** for any intent-factory write — register the typename, or, if it is a verified non-governed outbox/carrier/external-feed row, add it to `tools/read-model-exclusions.json`. Command writes (`*.fn.js __typename`) are not gated.
```

- [ ] **Step 3: create-service — add the exclusion option.** In step `4b` (the read-model classification step, after the `Run \`pnpm nx run event-processor:read-model-drift\` after wiring.` line), append:
```markdown
  If a row is a verified **non-governed** outbox/CDC-carrier or external-feed cache
  (written via an intent factory but never read back as a read model), do NOT register
  it — add a `{ "service", "typename", "reason" }` entry to
  `tools/read-model-exclusions.json` instead. The gate errors on any intent-factory
  write that is neither registered nor excluded.
```

- [ ] **Step 4: create-feature — add the exclusion option.** After the `run \`pnpm nx run event-processor:read-model-drift\`` reference (line ~33), append the same guidance, condensed:
```markdown
  (If the new row is a verified non-governed outbox/carrier/feed-cache row, add it to
  `tools/read-model-exclusions.json` instead of registering it — the gate errors on any
  unclassified intent-factory write.)
```

- [ ] **Step 5: create-event — add the exclusion option.** After the `Run \`pnpm nx run event-processor:read-model-drift\`` reference (line ~83), append the same condensed guidance as Step 4.

- [ ] **Step 6: audit-service — make coverage a hard fail.** Replace the line beginning `- **Coverage (warning):**` (line ~113) with:
```markdown
- **Unclassified write (hard fail):** the gate now errors (`unclassified-write`) on any intent-factory write that is neither registered in a `ReadModelOwnership` augmentation nor listed in `tools/read-model-exclusions.json`. Treat any such error naming a row written by *this* service as a hard fail — register it or add an exclusion entry with a reason.
```
Also in the line ~112 rule list, append `; an intent-factory write that is neither registered nor excluded (R5); a typename both registered and excluded (R6)` before the closing period.

- [ ] **Step 7: audit-domain — extend the rule list.** In the read-model row (line ~26), change `(accumulate-on-projection, unguarded P1, command+event dual-writer, registry conflict)` to `(accumulate-on-projection, unguarded P1, command+event dual-writer, registry conflict, unclassified intent-factory write, exclusion conflict)`.

- [ ] **Step 8: audit-system — update the INFO-gap language.** In step `5b` (line ~23), replace the sentences starting `The non-failing INFO list ...` through `... tracked by \`read-model-ownership-producer-aggregates\`.` with:
```markdown
The producer-aggregates program is complete: the gate is MANDATORY — an intent-factory write that is neither registered nor listed in `tools/read-model-exclusions.json` is a hard fail (`unclassified-write`). The only remaining non-failing INFO is unregistered *command* writes (`*.fn.js`), which are not gated; a non-empty list there is a documentary-registration gap, not a drift.
```
And in the line ~29 hard-fail dashboard row, change the parenthetical to include `unclassified-write` + `exclusion-conflict`.

- [ ] **Step 9: CLAUDE.md — note the exclusion registry.** In line 31 (the READ-MODEL-OWNERSHIP pointer), change the trailing sentence `Enforced by the \`event-processor:read-model-drift\` nx target.` to:
```markdown
Enforced by the **mandatory** `event-processor:read-model-drift` nx target — every intent-factory write must be registered or listed in `tools/read-model-exclusions.json` (verified non-governed rows).
```

- [ ] **Step 10: Commit**
```bash
git add .claude/skills CLAUDE.md
git commit -m "docs(skills): producer-surface + mandatory-gate pointers across read-model skills (WS-D)"
```

---

### Task 9: Final validation gate

**Files:** none (verification only)

- [ ] **Step 1: Mandatory drift gate — GREEN**

Run: `pnpm nx run event-processor:read-model-drift`
Expected: `read-model-drift: OK (44 registered typename(s), 25 excluded, 0 drift)`, exit 0, no INFO section.

- [ ] **Step 2: Checker unit tests — GREEN**

Run: `node --test tools/check-read-model-drift.test.mjs`
Expected: all pass (incl. the new R5/R6/exclusion/parse tests).

- [ ] **Step 3: Affected typecheck — GREEN** (the new CI trip-wire actually runs)

Run: `pnpm nx affected -t typecheck --base=origin/main`
Expected: all affected `typecheck` targets pass (broker-ctrl, reconciliation-ctrl, investor-bff at minimum).

- [ ] **Step 4: Affected test + lint — GREEN**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: pass. (Type-only src additions + tooling — no behavioral test should change.)

- [ ] **Step 5: Affected integration (mocked agents) — GREEN**

Run: `pnpm nx affected -t test-integration --base=origin/main`
Expected: pass. Per [[feedback-integration-tests-auto-run]] these use mocked agents — auto-run, no cost gate.

- [ ] **Step 6: Deploy decision**

WS-D's code changes are **type-only** augmentation files (`declare module` + `export {}`, side-effect-imported but stripped by esbuild) + tooling/docs. No runtime bundle changes → **no deploy required**. If `detect-deploy-needed.mjs` flags broker-ctrl/reconciliation-ctrl/investor-bff (because `services/**/src` changed), a deploy is a harmless no-op; document the type-only reasoning in the ship note rather than burning a deploy cycle.

- [ ] **Step 7: Program-end consolidated e2e (WS-D's gate)**

This is the once-per-program real-LLM e2e the validation-cadence decision deferred to WS-D. Run the **involved** scenarios only against already-converged dev: the advisory decision-pipeline, dashboard, and ledger flows. Per [[feedback-e2e-cost-conscious]] this is cost-heavy (real LLMs) — surface the scenario list + repeat count via AskUserQuestion before running. NEVER the full suite. If any scenario fails-then-passes, pull CloudWatch evidence from the failing window and run a confirmation pass ([[feedback-flake-means-broken]]).

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-01-...-design.md` § WS-D + the dossier):
- broker-ctrl `ExecutionMode` CommandOwned → Task 1. ✓
- drift-checker → mandatory-error + `tools/read-model-exclusions.json` → Tasks 4 + 5. ✓
- canonical doc §9 producer surface → Task 7. ✓ (+ §10 staleness fixed)
- typecheck trip-wire into CI: `targetDefaults` + local-runnable target (workflow deferred to ci-pipeline-bring-up per out_of_scope) → Tasks 1/2 (per-service targets) + 6 (`targetDefaults`). ✓
- CLAUDE.md/skill pointers → Task 8. ✓
- Validation gate: `read-model-drift` green as mandatory + backlog-lint 8/8 + program-end e2e → Task 9 (+ backlog-next closing phase). ✓
- Beyond-spec but required for "fully enforced" (folded per the refactoring-completeness exception): reconciliation-ctrl `ReconciliationResult`/`DriftRecord` (Task 2, user-approved) + investor-bff `FeatureFlag` documentary (Task 3). ✓

**Placeholder scan:** every code/JSON/markdown step shows the literal content. ✓

**Type consistency:** `parseExclusions` (Task 5 Step 3) is imported in the test (Step 1a), used in `evalTree` (Step 1b) + `main` (Step 5); `evaluate`'s new 5th param `exclusions` defaults to `new Set()` so existing direct call sites keep working; error rule strings `unclassified-write`/`exclusion-conflict` match between implementation (Step 4) and tests (Step 1c). ✓
