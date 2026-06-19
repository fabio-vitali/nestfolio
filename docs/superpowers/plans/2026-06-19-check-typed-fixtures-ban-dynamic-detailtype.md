# Ban dynamic `detailType` in check-typed-fixtures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the dynamic-`detailType` blind spot in `tools/check-typed-fixtures.mjs` so the gate forbids untyped `putEvent` outright, and migrate the two slipped `it.each` fixture blocks in `onboarding-notification.integration.test.ts` to the typed `putEvent` overload.

**Architecture:** Refactor the gate into testable exported functions + a thin CLI (mirroring `tools/check-typed-subjects.mjs`); add string-aware, line-number-preserving comment-stripping; flip a non-literal `detailType` from a skipped `note:` to a `violation`. Then unroll the two `it.each` blocks (a dynamic `detailType` cannot use the literal-`K` typed overload) to per-event literal calls: 13 registered events use the typed `subject:` form; `ORDER_FILLED`/`ORDER_REJECTED` stay documented unregistered legacy literals.

**Tech Stack:** Node ESM (`.mjs`), `node:test` + `node:assert/strict`, zod producer schemas reached via `@nestfolio/test-contracts` `EventSubjects`/`SubjectOf<K>`, Jest integration test, `@nestfolio/test-support` `EventBridgeClient`.

## Global Constraints

- Tests live in `test/`, never `src/__tests__/`.
- Run nx tasks via `pnpm nx`, never the underlying tool directly.
- This work happens in the worktree `.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap`; commit with `git commit --no-verify` (the worktree pre-commit hook can't run nx-affected) and verify each commit landed with `git log --oneline -1`.
- DRY subjects: identity (`tenantId`/`userId`/`region`) travels in the event **context**, never in `subject`. Every migrated subject omits identity.
- Fixtures must satisfy the producer schema **by type**, never via `as` casts.
- Never delete test coverage — unroll, do not drop, the parameterized cases.
- The gate (`node tools/check-typed-fixtures.mjs`) and its test (`node --test tools/check-typed-fixtures.test.mjs`) are NOT in the nx pipeline — run them explicitly.

---

### Task 1: Refactor the gate into testable exports (behavior-preserving) + characterization test

**Files:**
- Modify: `tools/check-typed-fixtures.mjs` (full rewrite — extract `loadRegistry`, `putEventBlock`, `scanFile`, `scanTree`, thin `main`; behavior unchanged)
- Create: `tools/check-typed-fixtures.test.mjs`

**Interfaces:**
- Produces: `loadRegistry(root?) → Set<string>`; `scanFile(file: string, src: string, registered: Set<string>) → { violations: string[], notes: string[] }`; `scanTree(root?, registered?) → { violations: string[], notes: string[], fileCount: number }`.

- [ ] **Step 1: Write the characterization test** (`tools/check-typed-fixtures.test.mjs`) — asserts the behavior that MUST be preserved across the refactor:

```js
// tools/check-typed-fixtures.test.mjs — node:test sibling for check-typed-fixtures.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanFile } from './check-typed-fixtures.mjs';

const REG = new Set(['BALANCE_UPDATED', 'ALPACA_ORDER_FILLED']);
const F = 'services/x/x-ctrl/test/integration/x.integration.test.ts';

test('registered literal detailType + detail: → violation', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', detail: { x: 1 } });`;
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /BALANCE_UPDATED — legacy putEvent/);
});

test('member detailType whose trailing name is not registered → clean (note only)', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: BrokerCtrlEventTypes.ORDER_FILLED, detail: { x: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /compound detailType 'BrokerCtrlEventTypes.ORDER_FILLED'/);
});

test('typed form (registered literal, no detail:) → clean', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', subject: { cashBalanceCents: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('bare literal not in registry + detail: → clean', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'ORDER_REJECTED', detail: { x: 1 } });`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('.subject as T cast inside putEvent → violation', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType: 'BALANCE_UPDATED', subject: payload.subject as Foo });`;
  const { violations } = scanFile(F, src, REG);
  assert.ok(violations.some((v) => /cast inside putEvent fixture/.test(v)));
});

test('CLI exits 0 on the real repo (gate currently green)', () => {
  const r = spawnSync('node', [join(process.cwd(), 'tools/check-typed-fixtures.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0);
});
```

- [ ] **Step 2: Run the test against the CURRENT gate to confirm it fails on the missing export**

Run: `node --test tools/check-typed-fixtures.test.mjs`
Expected: FAIL — `scanFile` is not exported by `check-typed-fixtures.mjs` (import error / undefined).

- [ ] **Step 3: Rewrite `tools/check-typed-fixtures.mjs`** to the exported-function form (behavior identical to today — dynamic still a `note:`, no comment stripping yet):

```js
#!/usr/bin/env node
// check-typed-fixtures.mjs — registry-driven regression gate for typed fixtures.
//
// LEGACY-DETAIL CHECK (registry-driven): a putEvent({ ... detail: ... }) whose detailType's
//   TRAILING NAME is a registered event is a violation (use the typed subject:/context: overload).
// SUBJECT-CAST CHECK: `.subject as <Type>` used as a property value inside a putEvent({ ... }) block.
//
// Exports (for tools/check-typed-fixtures.test.mjs):
//   loadRegistry(root) -> Set<string>
//   scanFile(file, src, registered) -> { violations: string[], notes: string[] }
//   scanTree(root, registered) -> { violations, notes, fileCount }
//
// Usage: node tools/check-typed-fixtures.mjs   Exit: 1 if any violations, else 0.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

export function loadRegistry(root = ROOT) {
  const { registeredEvents } = JSON.parse(
    readFileSync(join(root, 'tools/typed-fixture-registered-events.json'), 'utf8'),
  );
  return new Set(registeredEvents);
}

function walk(dir) {
  const out = [];
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) out.push(...walk(p));
      else if (name.endsWith('.test.ts') || name.endsWith('.spec.ts')) out.push(p);
    }
  } catch {
    // directory missing / unreadable — skip
  }
  return out;
}

const SCAN_ROOTS = ['services', 'libs', 'apps/e2e-feature-tests/src'];

const SUBJECT_CAST_IN_BLOCK = /\w[\w.]*\s*:\s*.*\.subject\s+as\b/;
const PUTEVENT_START = /putEvent\s*\(\s*\{/g;
const DETAIL_TYPE_IN_BLOCK = /detailType\s*:\s*([`'"]?)(\w[\w.]*)\1/;
const HAS_DETAIL = /\bdetail\s*:/;

// brace-balanced object block starting at a putEvent match index.
function putEventBlock(src, callStart) {
  let depth = 0;
  let i = src.indexOf('{', callStart);
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.substring(callStart, i + 1); }
    i++;
  }
  return null;
}

export function scanFile(file, src, registered) {
  const violations = [];
  const notes = [];

  // legacy-detail check
  PUTEVENT_START.lastIndex = 0;
  let match;
  while ((match = PUTEVENT_START.exec(src)) !== null) {
    const callStart = match.index;
    const lineNum = src.substring(0, callStart).split('\n').length;
    const block = putEventBlock(src, callStart);
    if (block === null) continue;
    if (!HAS_DETAIL.test(block)) continue; // typed form → skip
    const dtm = DETAIL_TYPE_IN_BLOCK.exec(block);
    if (!dtm) {
      notes.push(`  note: ${file}:${lineNum} — dynamic detailType (no literal name resolvable), skipped`);
      continue;
    }
    const rawName = dtm[2];
    const trailingName = rawName.includes('.') ? rawName.split('.').pop() : rawName;
    if (registered.has(trailingName)) {
      violations.push(`${file}:${lineNum}: ${trailingName} — legacy putEvent({ detail: ... }) — use the typed subject:/context: putEvent overload`);
    } else if (rawName.includes('.')) {
      notes.push(`  note: ${file}:${lineNum} — compound detailType '${rawName}' (trailing '${trailingName}' not in registry), skipped`);
    }
  }

  // subject-cast check (first hit per file)
  PUTEVENT_START.lastIndex = 0;
  let castMatch;
  let found = false;
  while (!found && (castMatch = PUTEVENT_START.exec(src)) !== null) {
    const callStart = castMatch.index;
    const block = putEventBlock(src, callStart);
    if (block === null) continue;
    for (const line of block.split('\n')) {
      if (SUBJECT_CAST_IN_BLOCK.test(line)) {
        const lineNum = src.substring(0, callStart).split('\n').length;
        violations.push(`${file}:${lineNum}: '.subject as' cast inside putEvent fixture — fixtures must satisfy the producer schema by type, not cast`);
        found = true;
        break;
      }
    }
  }
  PUTEVENT_START.lastIndex = 0;

  return { violations, notes };
}

export function scanTree(root = ROOT, registered = loadRegistry(root)) {
  const violations = [];
  const notes = [];
  let fileCount = 0;
  for (const sub of SCAN_ROOTS) {
    const abs = join(root, sub);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      fileCount++;
      const r = scanFile(file, readFileSync(file, 'utf8'), registered);
      violations.push(...r.violations);
      notes.push(...r.notes);
    }
  }
  return { violations, notes, fileCount };
}

function main() {
  const registered = loadRegistry();
  const { violations, notes, fileCount } = scanTree(ROOT, registered);
  if (notes.length) {
    process.stderr.write('check-typed-fixtures: dynamic/compound detailType sites (not flagged, verify manually):\n' + notes.join('\n') + '\n');
  }
  if (violations.length) {
    process.stderr.write('check-typed-fixtures: violations found:\n' + violations.map((v) => `  - ${v}`).join('\n') + '\n');
    process.exit(1);
  }
  console.log(`check-typed-fixtures: OK (${fileCount} test file(s) scanned, ${registered.size} registered events)`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run the test + the gate to verify behavior is preserved**

Run: `node --test tools/check-typed-fixtures.test.mjs`
Expected: PASS (all 6 tests).
Run: `node tools/check-typed-fixtures.mjs`
Expected: prints 2 `note:` lines (the `onboarding-notification:198` dynamic site + the `investor-contract-emission:80` compound site) then `check-typed-fixtures: OK (...)`, exit 0 — identical to before the refactor.

- [ ] **Step 5: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap
git -C "$WT" add tools/check-typed-fixtures.mjs tools/check-typed-fixtures.test.mjs
git -C "$WT" commit --no-verify -m "refactor(tools): extract check-typed-fixtures into testable functions + add node:test"
git -C "$WT" log --oneline -1
```

---

### Task 2: Add comment-stripping + flip dynamic `detailType` to a violation (TDD)

**Files:**
- Modify: `tools/check-typed-fixtures.mjs` (add `stripComments`; restructure `scanFile`'s legacy-detail loop)
- Modify: `tools/check-typed-fixtures.test.mjs` (add the new-behavior cases)

**Interfaces:**
- Produces: `stripComments(src: string) → string` (string/template-aware, line-number-preserving).

- [ ] **Step 1: Add the failing new-behavior tests** to `tools/check-typed-fixtures.test.mjs` (append; also add `stripComments` to the import):

```js
import { scanFile, stripComments } from './check-typed-fixtures.mjs';

test('dynamic detailType (bare variable) + detail: → violation', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType, detail });`;
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /dynamic detailType/);
});

test('dynamic detailType with NO detail: key also → violation (absolute ban)', () => {
  const src = `await eb.putEvent({ bus: 'b', targetService: 's', detailType, subject: makeSubject() });`;
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /dynamic detailType/);
});

test('putEvent inside a // line comment → ignored', () => {
  const src = `// await eb.putEvent({ detailType, detail });\nconst x = 1;`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('putEvent inside a /* block comment */ → ignored', () => {
  const src = `/*\n  await eb.putEvent({ detailType, detail });\n*/\nconst x = 1;`;
  const { violations, notes } = scanFile(F, src, REG);
  assert.equal(violations.length, 0);
  assert.equal(notes.length, 0);
});

test('stripComments preserves line count and string content containing //', () => {
  const src = `const u = 'http://x'; // trailing\nawait eb.putEvent({ detailType: 'BALANCE_UPDATED', detail: {} });`;
  const stripped = stripComments(src);
  assert.equal(stripped.split('\n').length, src.split('\n').length);
  assert.match(stripped, /'http:\/\/x'/);
  const { violations } = scanFile(F, src, REG);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /:2:/);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tools/check-typed-fixtures.test.mjs`
Expected: FAIL — dynamic cases currently produce a `note` (not a `violation`); the comment cases currently produce a violation/note; `stripComments` is not exported.

- [ ] **Step 3: Add `stripComments` to `tools/check-typed-fixtures.mjs`** (place above `scanFile`):

```js
// Strip // line and /* */ block comments, string/template-literal-aware, replacing comment
// characters with spaces (newlines preserved) so reported line numbers are unchanged. Content
// inside '...', "...", `...` is copied verbatim (a // inside a string is NOT a comment).
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < n) { out += ch + src[i + 1]; i += 2; continue; }
        out += ch; i++;
        if (ch === quote) break;
      }
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && i + 1 < n && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    out += c; i++;
  }
  return out;
}
```

- [ ] **Step 4: Wire `stripComments` into `scanFile` and flip the dynamic branch.** In `scanFile`, make the first line strip comments, and replace the legacy-detail `while` loop body so a non-resolvable `detailType` is a violation with no `detail:` precondition. The new `scanFile` (subject-cast loop unchanged):

```js
export function scanFile(file, rawSrc, registered) {
  const src = stripComments(rawSrc);
  const violations = [];
  const notes = [];

  // detailType check — dynamic (non-literal) is banned outright; registered + detail: is legacy.
  PUTEVENT_START.lastIndex = 0;
  let match;
  while ((match = PUTEVENT_START.exec(src)) !== null) {
    const callStart = match.index;
    const lineNum = src.substring(0, callStart).split('\n').length;
    const block = putEventBlock(src, callStart);
    if (block === null) continue;
    const dtm = DETAIL_TYPE_IN_BLOCK.exec(block);
    if (!dtm) {
      violations.push(`${file}:${lineNum}: dynamic detailType — putEvent requires a literal detailType (a string or an EventTypes.NAME member); unroll to per-event literal calls and use the typed subject:/context: overload`);
      continue;
    }
    const rawName = dtm[2];
    const trailingName = rawName.includes('.') ? rawName.split('.').pop() : rawName;
    if (registered.has(trailingName)) {
      if (HAS_DETAIL.test(block)) {
        violations.push(`${file}:${lineNum}: ${trailingName} — legacy putEvent({ detail: ... }) — use the typed subject:/context: putEvent overload`);
      }
    } else if (rawName.includes('.')) {
      notes.push(`  note: ${file}:${lineNum} — compound detailType '${rawName}' (trailing '${trailingName}' not in registry), skipped`);
    }
  }

  // subject-cast check (first hit per file) — UNCHANGED from Task 1, but scans the stripped `src`.
  PUTEVENT_START.lastIndex = 0;
  let castMatch;
  let found = false;
  while (!found && (castMatch = PUTEVENT_START.exec(src)) !== null) {
    const callStart = castMatch.index;
    const block = putEventBlock(src, callStart);
    if (block === null) continue;
    for (const line of block.split('\n')) {
      if (SUBJECT_CAST_IN_BLOCK.test(line)) {
        const lineNum = src.substring(0, callStart).split('\n').length;
        violations.push(`${file}:${lineNum}: '.subject as' cast inside putEvent fixture — fixtures must satisfy the producer schema by type, not cast`);
        found = true;
        break;
      }
    }
  }
  PUTEVENT_START.lastIndex = 0;

  return { violations, notes };
}
```

Also update the header comment block to describe the dynamic-ban + comment-stripping.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tools/check-typed-fixtures.test.mjs`
Expected: PASS (all 11 tests — the 6 characterization + 5 new).

- [ ] **Step 6: Run the gate repo-wide — EXPECT 2 violations (intentional, transient)**

Run: `node tools/check-typed-fixtures.mjs`
Expected: exit 1, two violations:
`services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts:117: dynamic detailType ...` and `...:195: dynamic detailType ...` (the two `it.each` blocks), plus the `investor-contract-emission:80` compound `note:`. The advisory-bff:43 comment is gone (stripped). These two violations are migrated away in Tasks 3–4.

- [ ] **Step 7: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap
git -C "$WT" add tools/check-typed-fixtures.mjs tools/check-typed-fixtures.test.mjs
git -C "$WT" commit --no-verify -m "feat(tools): check-typed-fixtures bans dynamic detailType + strips comments"
git -C "$WT" log --oneline -1
```

---

### Task 3: Unroll the `notificationEvents` it.each block to per-event literal calls

**Files:**
- Modify: `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts` (replace the `notificationEvents` array + TODO comment + `it.each` block — currently lines ~65–136 inside `describe('notification creation (CDC verification)')`)

**Interfaces:**
- Consumes: `eb` (`EventBridgeClient`) and `notificationTrap` (`EventBusTrap`) already created in the outer `beforeAll`; the typed `putEvent<K>` overload from `@nestfolio/test-support` (binds `subject: SubjectOf<K>` for a literal `detailType`). No new imports.

- [ ] **Step 1: Replace the array + TODO + `it.each`** with a DRY assertion helper + 12 explicit `it(...)` cases (preserve order and the 90s/120s timeouts). The 10 registered events use `subject:` (typed); `ORDER_FILLED`/`ORDER_REJECTED` keep `detail:` (deferred, unregistered → gate-clean):

```ts
    // Each event type makes investor-ctrl write a Notification, re-emitted as NOTIFICATION_CREATED
    // via CDC. No assertion reads the INJECTED subject, so each injected subject only needs to be
    // minimally valid under its producer schema — enforced offline by the typed putEvent runtime
    // backstop (EventSubjects[K].parse) before any send.
    const expectNotificationCdc = async (emit: () => Promise<void>) => {
      await emit();
      const cdcEvent = await notificationTrap.waitForEvent({
        detailType: 'NOTIFICATION_CREATED',
        timeoutMs: 90_000,
      });
      expect(cdcEvent.detailType).toBe('NOTIFICATION_CREATED');
      expect(cdcEvent.detail).toBeDefined();
    };

    it('creates Notification on ONBOARDING_COMPLETED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'ONBOARDING_COMPLETED',
        subject: { goal: { objective: 'RETIREMENT' }, horizonYears: 10, accountMode: 'simulation', capitalAmount: 100_000, currency: 'USD', riskTolerance: 2, riskExperience: 1, operatingMode: 'BALANCED', mandateAccepted: true },
      })), 120_000);

    it('creates Notification on MANDATE_ISSUED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'MANDATE_ISSUED',
        subject: { mandateId: 'integ-mandate', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on MANDATE_REVOKED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'MANDATE_REVOKED',
        subject: { mandateId: 'integ-mandate', level: 'DISCRETIONARY', status: 'REVOKED', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString(), revokedAt: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on DEPOSIT_INITIATED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'DEPOSIT_INITIATED',
        subject: { depositId: 'integ-dep', amountCents: 100_000, currency: 'USD', timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on DECISION_APPROVED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'DECISION_APPROVED',
        subject: { ccId: 'integ-cc', decisionPacketId: 'integ-dp', decisionId: 'integ-decision', taskToken: 'integ-token', mandateSnapshot: { level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString() }, status: 'COMPLETED', result: 'APPROVED', violations: [], authorityLevel: 'L1', sourceEventId: 'integ-src-evt' },
      })), 120_000);

    // ORDER_FILLED / ORDER_REJECTED — deferred ORDER_*/NormalizedOrderEvent family (no producer zod
    // contract; doubly-blocked on parked production forks). Left as legacy untyped putEvent;
    // unregistered → gate-clean. See backlog typed-test-fixtures-execution-deferred-cross-domain.
    it('creates Notification on ORDER_FILLED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'ORDER_FILLED',
        detail: { orderId: 'integ-order', symbol: 'AAPL', side: 'BUY', quantity: 10, fillPrice: 150 },
      })), 120_000);

    it('creates Notification on BALANCE_UPDATED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'BALANCE_UPDATED',
        subject: { cashBalanceCents: 500_000, snapshot: { positions: {}, cashBalanceCents: 500_000, lastEventSequence: 1 } },
      })), 120_000);

    it('creates Notification on ORDER_REJECTED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'ORDER_REJECTED',
        detail: { orderId: 'integ-reject', reason: 'Margin' },
      })), 120_000);

    it('creates Notification on DECISION_BLOCKED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'DECISION_BLOCKED',
        subject: { ccId: 'integ-cc', decisionPacketId: 'integ-dp', decisionId: 'integ-blocked', taskToken: 'integ-token', mandateSnapshot: { level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString() }, status: 'BLOCKED', result: 'BLOCKED', violations: [], authorityLevel: 'L1', sourceEventId: 'integ-src-evt' },
      })), 120_000);

    it('creates Notification on WITHDRAWAL_SETTLED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'WITHDRAWAL_SETTLED',
        subject: { sk: 'WITHDRAWAL_SETTLED', direction: 'WITHDRAWAL', status: 'settled', transferId: 'integ-wd', amountCents: 50_000, currency: 'USD', executionMode: 'simulation', initiatedAt: new Date().toISOString(), timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates Notification on GOAL_UPDATED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'GOAL_UPDATED',
        subject: { operatingMode: 'BALANCED', goal: { objective: 'INCOME' }, riskProfile: { score: 5 } },
      })), 120_000);

    it('creates Notification on OPERATING_MODE_CHANGED and emits NOTIFICATION_CREATED via CDC', () =>
      expectNotificationCdc(() => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'OPERATING_MODE_CHANGED',
        subject: { mandateId: 'integ-mandate', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'AGGRESSIVE', effectiveDate: new Date().toISOString() },
      })), 120_000);
```

- [ ] **Step 2: Type-check the migrated file** (proves each `subject` satisfies `SubjectOf<K>`):

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap && npx tsc --noEmit -p services/investor/investor-ctrl/tsconfig.spec.json 2>&1 | grep onboarding-notification || echo "MIGRATED FILE TYPE-CLEAN"`
Expected: `MIGRATED FILE TYPE-CLEAN` (no type errors in the file). NB: investor-ctrl has pre-existing latent errors elsewhere (backlog `investor-services-latent-tsc-errors`) — the grep scopes the assertion to our file. If a `subject` literal IS rejected, fix it to satisfy the schema (do not cast). If a rejection reveals a genuine producer-contract mismatch, **fix-or-file** via `backlog-add`.

- [ ] **Step 3: Run the gate — the notificationEvents violation must be gone**

Run: `node tools/check-typed-fixtures.mjs`
Expected: exit 1 with exactly ONE violation remaining — `...onboarding-notification...:195: dynamic detailType` (the circuit-breaker block, migrated in Task 4). The `:117` violation is gone.

- [ ] **Step 4: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap
git -C "$WT" add services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts
git -C "$WT" commit --no-verify -m "test(typed-fixtures): unroll notificationEvents it.each to per-event typed putEvent"
git -C "$WT" log --oneline -1
```

---

### Task 4: Unroll the `circuitBreakerEvents` it.each block to per-event typed calls

**Files:**
- Modify: `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts` (replace the `circuitBreakerEvents` array + `it.each` block — currently lines ~189–215 inside `describe('circuit breaker notifications')`; keep the `systemTrap` `beforeAll` above it)

**Interfaces:**
- Consumes: `eb`, `systemTrap` (the SYSTEM-tenant `EventBusTrap` from this describe's `beforeAll`); `BrokerCircuitEventSchema` subject shape `{ adapter, timestamp }`.

- [ ] **Step 1: Replace the `circuitBreakerEvents` array + `it.each`** with a SYSTEM assertion helper + 3 explicit typed `it(...)` cases (preserve the two subject assertions — they read the OUTGOING Notification envelope, unaffected by the injected subject):

```ts
    const expectSystemNotificationCdc = async (eventType: string, emit: () => Promise<void>) => {
      await emit();
      const cdcEvent = await systemTrap.waitForEvent({
        detailType: 'NOTIFICATION_CREATED',
        timeoutMs: 90_000,
      });
      expect(cdcEvent.detailType).toBe('NOTIFICATION_CREATED');
      expect(cdcEvent.detail).toBeDefined();
      expect(cdcEvent.detail.subject.tenantId).toBe('SYSTEM');
      expect(cdcEvent.detail.subject.type).toBe(eventType);
    };

    it('creates SYSTEM Notification on BROKER_CIRCUIT_OPEN and emits NOTIFICATION_CREATED via CDC', () =>
      expectSystemNotificationCdc('BROKER_CIRCUIT_OPEN', () => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'BROKER_CIRCUIT_OPEN',
        subject: { adapter: 'broker-alpaca-adpt', timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates SYSTEM Notification on BROKER_CIRCUIT_CLOSED and emits NOTIFICATION_CREATED via CDC', () =>
      expectSystemNotificationCdc('BROKER_CIRCUIT_CLOSED', () => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'BROKER_CIRCUIT_CLOSED',
        subject: { adapter: 'broker-alpaca-adpt', timestamp: new Date().toISOString() },
      })), 120_000);

    it('creates SYSTEM Notification on BROKER_HEAL_ESCALATED and emits NOTIFICATION_CREATED via CDC', () =>
      expectSystemNotificationCdc('BROKER_HEAL_ESCALATED', () => eb.putEvent({
        bus: 'investor', targetService: 'investor-ctrl', detailType: 'BROKER_HEAL_ESCALATED',
        subject: { adapter: 'broker-alpaca-adpt', timestamp: new Date().toISOString() },
      })), 120_000);
```

- [ ] **Step 2: Type-check the migrated file**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap && npx tsc --noEmit -p services/investor/investor-ctrl/tsconfig.spec.json 2>&1 | grep onboarding-notification || echo "MIGRATED FILE TYPE-CLEAN"`
Expected: `MIGRATED FILE TYPE-CLEAN`.

- [ ] **Step 3: Run the gate — must be fully GREEN now**

Run: `node tools/check-typed-fixtures.mjs`
Expected: zero violations, exit 0 — `check-typed-fixtures: OK (...)`. The only remaining `note:` is the `investor-contract-emission:80` compound `BrokerCtrlEventTypes.ORDER_FILLED` (legitimately unregistered).

- [ ] **Step 4: Commit**

```bash
WT=/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap
git -C "$WT" add services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts
git -C "$WT" commit --no-verify -m "test(typed-fixtures): unroll circuitBreakerEvents it.each to per-event typed putEvent"
git -C "$WT" log --oneline -1
```

---

### Task 5: Repo-wide verification + file the shorthand-`detail` follow-up

**Files:** none (verification + a backlog side-finding)

- [ ] **Step 1: Gate test + gate both green**

Run: `node --test tools/check-typed-fixtures.test.mjs && node tools/check-typed-fixtures.mjs`
Expected: 11 tests pass; gate prints `OK`, exit 0.

- [ ] **Step 2: nx unit + lint on the true-affected projects**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap && AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -); echo "affected: $AFFECTED"; [ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"`
Expected: pass. (Tooling `.mjs` changes may not map to an nx project; the gate + gate-test in Step 1 cover them.)

- [ ] **Step 3: File the shorthand-`detail` follow-up** (side-finding surfaced in design — `HAS_DETAIL` matches only `detail:`, not the shorthand `detail` property, so a *literal*-`detailType` + shorthand-`detail` + registered site would still be missed by the legacy-detail check; not load-bearing for this item's `done_when` because the dynamic ban already catches today's shorthand sites). Invoke the `backlog-add` skill with: title "check-typed-fixtures HAS_DETAIL misses shorthand `detail` property"; body describing the gap + that the absolute dynamic ban already covers today's instances; suggest folding into the `typed-test-fixtures` epic as **captured** (orthogonal to `done_when`).

- [ ] **Step 4: Integration confirmation (closing-phase, best-effort against deployed dev — NO deploy needed; investor-ctrl src unchanged)**

Run: `cd /Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/check-typed-fixtures-dynamic-detailtype-gap && pnpm nx run investor-ctrl:test-integration`
Expected: the `notification creation` + `circuit breaker notifications` suites pass — proving the typed subjects drive the real handlers and CDC still emits `NOTIFICATION_CREATED`. If a scenario fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing; separate any residual env flakes into the pre-filed umbrellas (`integration-deep-coldstart-flakes-post-trap-hardening`, `ip-ctrl-integration-snapshot-userid-mismatch`, `investor-bff-updateoperatingmode-integration-seed-flake`) vs a genuine fixture regression. The typed `putEvent` runtime backstop (`EventSubjects[K].parse` offline) already guarantees the subjects are schema-valid even if the deployed run is degraded.

---

## Self-Review

**1. Spec coverage:**
- Spec §3.1 gate hardening (comment-strip + dynamic ban + exports + preserved behaviors) → Tasks 1–2. ✓
- Spec §3.2 gate test → Tasks 1 (characterization) + 2 (new behavior). ✓
- Spec §3.3 fixture migration (both it.each blocks; 13 typed + 2 unregistered literals) → Tasks 3–4. ✓
- Spec §3.4 validation (gate test, gate green, tsc, nx affected, integration) → Task 5. ✓
- Spec §4 out-of-scope shorthand-`detail` follow-up → Task 5 Step 3. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows command + expected output. ✓

**3. Type consistency:** `scanFile(file, src, registered) → { violations, notes }`, `scanTree → { violations, notes, fileCount }`, `loadRegistry → Set`, `stripComments(src) → string` are consistent across Tasks 1–2 and the test imports. All 13 typed subjects match the schemas extracted from `EventSubjects`. The two unregistered events use the legacy `detail:` overload. ✓
