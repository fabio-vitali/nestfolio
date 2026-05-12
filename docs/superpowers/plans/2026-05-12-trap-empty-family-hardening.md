# Trap-empty Family Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `Captured-but-unmatched buffer: []` trap-empty flakes in the `--parallel=8` integration suite by raising the `eventTimeout` default and decorrelating SQS poll cycles with jitter.

**Architecture:** Two small mechanical changes (`eventTimeout` 45s → 90s default; ±25% jitter on `pollInterval` sleeps) applied at the test-fixture layer. No production code touched. The jitter math is extracted into a shared util in `libs/test-support` so both `event-bus-trap.fixture.ts` and `table-assertions.ts` consume the same helper. A preventive doc convention is appended to the `testing-patterns` skill.

**Tech Stack:** TypeScript, Jest (with `jest.retryTimes(1, { logErrorsBeforeRetry: true })`), Nx, AWS SDK v3 (EventBridge + SQS), pnpm.

**Spec:** `docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md`

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `libs/test-support/src/context.ts` | Modify | Bump `eventTimeout` default 45_000 → 90_000 in `createTimingConfig`. |
| `libs/test-support/src/timing.ts` | **Create** | Export `jitter(mean, random?)` — pure arithmetic helper. |
| `libs/test-support/src/index.ts` | Modify | Re-export `jitter` from new `timing.ts`. |
| `libs/test-support/test/timing.test.ts` | **Create** | Unit-test `jitter` math (floor / mean / ceiling). |
| `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts` | Modify | Replace `setTimeout(resolve, pollInterval)` in `waitForEvent` loop with `jitter`-wrapped sleep. |
| `libs/integration-testing/src/fixtures/table-assertions.ts` | Modify | Same jitter wrap on its poll-loop sleep. |
| `.claude/skills/testing-patterns/SKILL.md` | Modify | Append "Trap-fixture cleanup pattern" section. |
| `docs/backlog/integration-trap-empty-family-hardening.md` | Modify (final task) | Flip `status: shipped`, fill `validation_gate`. |

---

## Pre-flight

This plan must execute in a worktree off `main`. The first task creates it.

---

### Task 0: Create the implementation worktree

**Files:**
- New worktree at `../nestfolio-trap-empty` on branch `feat/trap-empty-hardening`

- [ ] **Step 1: Verify main is clean and up to date**

Run:
```bash
git status
git log -1 --oneline
```
Expected: clean working tree on `main` at commit `9baf5cd3` (the design commit) or later.

- [ ] **Step 2: Create worktree via the using-git-worktrees skill**

Invoke `superpowers:using-git-worktrees` with the target branch name `feat/trap-empty-hardening`. The skill creates `../nestfolio-trap-empty` and switches the working directory.

Expected: `git worktree list` shows the new path; `git rev-parse --abbrev-ref HEAD` returns `feat/trap-empty-hardening`.

- [ ] **Step 3: Sanity-check the worktree**

Run from the worktree:
```bash
pnpm install --frozen-lockfile
```
Expected: completes without changes (workspace already installed once; this re-binds the worktree's `node_modules`).

---

### Task 1: Bump `eventTimeout` default to 90s

**Files:**
- Modify: `libs/test-support/src/context.ts:30`
- Test exists: `libs/test-support/test/context.test.ts` (no change needed — see Step 1 reasoning)

- [ ] **Step 1: Confirm no existing test asserts on the 45_000 default**

Run:
```bash
grep -rn "45_000\|45000" libs/test-support/test libs/integration-testing/test
```
Expected: zero hits in test files (existing tests pass explicit `timings` overrides, never read defaults).

This means no failing-test step is needed for the default bump — the change is verified by the validation gate, not a unit test of the constant.

- [ ] **Step 2: Apply the bump**

Edit `libs/test-support/src/context.ts:30`. Change:
```ts
    eventTimeout: overrides?.eventTimeout ?? 45_000 * multiplier,
```
to:
```ts
    eventTimeout: overrides?.eventTimeout ?? 90_000 * multiplier,
```

- [ ] **Step 3: Run test-support unit tests**

Run:
```bash
pnpm nx test test-support
```
Expected: PASS. All `createTestContext` tests still green.

- [ ] **Step 4: Commit**

```bash
git add libs/test-support/src/context.ts
git commit -m "$(cat <<'EOF'
test-infra(test-support): bump eventTimeout default 45s -> 90s

Aligns trap-polling budget with the 60s waitForItem cold-start floor,
plus headroom for EB-side propagation tax. INTEG_TIMEOUT_MULTIPLIER
remains the per-environment scaling knob.

Spec: docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md
EOF
)"
```

---

### Task 2: Add the `jitter` helper

**Files:**
- Create: `libs/test-support/src/timing.ts`
- Modify: `libs/test-support/src/index.ts:3` (add re-export)
- Create test: `libs/test-support/test/timing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/test-support/test/timing.test.ts` with:
```ts
import { jitter } from '../src/timing';

describe('jitter', () => {
  it('returns mean * 0.75 at random=0 (floor)', () => {
    expect(jitter(500, () => 0)).toBeCloseTo(375);
  });

  it('returns mean * 1.0 at random=0.5 (mean)', () => {
    expect(jitter(500, () => 0.5)).toBeCloseTo(500);
  });

  it('approaches mean * 1.25 at random=0.999 (ceiling, exclusive)', () => {
    expect(jitter(500, () => 0.999)).toBeCloseTo(624.75, 1);
  });

  it('stays within [0.75x, 1.25x) for arbitrary mean', () => {
    expect(jitter(1000, () => 0)).toBeCloseTo(750);
    expect(jitter(1000, () => 0.999)).toBeCloseTo(1249.5, 1);
  });

  it('uses Math.random by default', () => {
    const v = jitter(500);
    expect(v).toBeGreaterThanOrEqual(375);
    expect(v).toBeLessThan(625);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm nx test test-support --testFile=test/timing.test.ts
```
Expected: FAIL with "Cannot find module '../src/timing'" or equivalent module-resolution error.

- [ ] **Step 3: Implement `jitter`**

Create `libs/test-support/src/timing.ts`:
```ts
/**
 * Returns a jittered duration in the half-open range [mean * 0.75, mean * 1.25).
 * Used to decorrelate lockstep polling across parallel test workers — see
 * spec docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md.
 */
export function jitter(mean: number, random: () => number = Math.random): number {
  return mean * (0.75 + random() * 0.5);
}
```

- [ ] **Step 4: Re-export from index**

Edit `libs/test-support/src/index.ts`. After the existing exports, add:
```ts
export { jitter } from './timing';
```

- [ ] **Step 5: Run tests to verify pass**

Run:
```bash
pnpm nx test test-support
```
Expected: PASS. All 5 `jitter` tests + all pre-existing `createTestContext` tests green.

- [ ] **Step 6: Commit**

```bash
git add libs/test-support/src/timing.ts libs/test-support/src/index.ts libs/test-support/test/timing.test.ts
git commit -m "$(cat <<'EOF'
test-infra(test-support): add jitter() helper for pollInterval sleep

Pure arithmetic helper that returns a value in [mean * 0.75, mean * 1.25).
Will be consumed by EventBusTrap.waitForEvent and TableAssertions poll loops
to decorrelate lockstep SQS reads across --parallel=8 test workers.

Spec: docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md
EOF
)"
```

---

### Task 3: Apply jitter in `EventBusTrap.waitForEvent`

**Files:**
- Modify: `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:240`

- [ ] **Step 1: Read the current sleep call to confirm location**

Run:
```bash
grep -n "setTimeout" libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
```
Expected output (single hit):
```
240:        await new Promise(resolve => setTimeout(resolve, pollInterval));
```

- [ ] **Step 2: Add the import**

Edit `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`. Find the existing import line:
```ts
import type { TestContext } from '@nestfolio/test-support';
```
Replace it with:
```ts
import { jitter } from '@nestfolio/test-support';
import type { TestContext } from '@nestfolio/test-support';
```

- [ ] **Step 3: Wrap the sleep with jitter**

Edit line 240. Change:
```ts
        await new Promise(resolve => setTimeout(resolve, pollInterval));
```
to:
```ts
        await new Promise(resolve => setTimeout(resolve, jitter(pollInterval)));
```

- [ ] **Step 4: Run integration-testing unit tests**

Run:
```bash
pnpm nx test integration-testing
```
Expected: PASS. Existing `event-bus-trap.test.ts` covers dedup/auto-delete logic (mocks SQS — doesn't exercise the sleep call), so it should be unaffected.

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
git commit -m "$(cat <<'EOF'
test-infra(integration-testing): jitter EventBusTrap poll sleep +-25%

Decorrelates lockstep SQS reads across --parallel=8 test workers.
ctx.timings.pollInterval is now interpreted as the mean sleep duration
rather than an exact value. No public API change.

Spec: docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md
EOF
)"
```

---

### Task 4: Apply jitter in `TableAssertions` poll loop

**Files:**
- Modify: `libs/integration-testing/src/fixtures/table-assertions.ts:88`

- [ ] **Step 1: Verify the sleep call location**

Run:
```bash
grep -n "setTimeout\|@nestfolio/test-support" libs/integration-testing/src/fixtures/table-assertions.ts
```
Expected output (relevant hits):
```
88:      await new Promise(resolve => setTimeout(resolve, pollInterval));
```
(and likely an existing import line for `TestContext`).

- [ ] **Step 2: Add or extend the import**

Edit `libs/integration-testing/src/fixtures/table-assertions.ts`. If there is an existing import from `@nestfolio/test-support`, extend it to include `jitter`:
```ts
import { jitter, type TestContext } from '@nestfolio/test-support';
```
If `TestContext` is imported with `type`-only syntax (e.g. `import type { TestContext } from '@nestfolio/test-support';`), add a separate value-import line:
```ts
import { jitter } from '@nestfolio/test-support';
```
Pick whichever form matches the existing style in the file.

- [ ] **Step 3: Wrap the sleep with jitter**

Edit line 88. Change:
```ts
      await new Promise(resolve => setTimeout(resolve, pollInterval));
```
to:
```ts
      await new Promise(resolve => setTimeout(resolve, jitter(pollInterval)));
```

- [ ] **Step 4: Run integration-testing unit tests**

Run:
```bash
pnpm nx test integration-testing
```
Expected: PASS. `table-assertions.test.ts` uses mocked DDB and explicit `pollIntervalMs` overrides; the existing assertions are tolerant to the small jitter range.

If any test fails because it asserts on total elapsed time, that's a real signal — file as a follow-up and revisit before continuing.

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/table-assertions.ts
git commit -m "$(cat <<'EOF'
test-infra(integration-testing): jitter TableAssertions poll sleep +-25%

Same treatment as EventBusTrap.waitForEvent — decorrelates lockstep DDB
polls across --parallel=8 test workers.

Spec: docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md
EOF
)"
```

---

### Task 5: Document the trap-fixture cleanup pattern

**Files:**
- Modify: `.claude/skills/testing-patterns/SKILL.md` (append)

- [ ] **Step 1: Locate the insertion point**

Run:
```bash
grep -n "^## \|^### " .claude/skills/testing-patterns/SKILL.md | tail -20
```
Expected: a list of section headers. Append the new section after the last existing section (most likely an integration-testing-related section). If the file has a clear "## EventBusTrap" or "## Integration test patterns" section, append the new subsection inside it.

- [ ] **Step 2: Append the convention**

Append the following block to the end of `.claude/skills/testing-patterns/SKILL.md` (or as a subsection under an existing integration-testing section — use editorial judgement based on Step 1's output):

````markdown

## Trap-fixture cleanup pattern

When using `EventBusTrap`, follow **one** of these two patterns:

### Pattern A — shared trap (preferred for read-only assertions)

```ts
let ctx: TestContext;
let trap: EventBusTrap;

beforeAll(async () => {
  ctx = await createTestContext();
  trap = new EventBusTrap(ctx);
  await trap.deploy({ bus: 'advisory', detailType: 'MANDATE_ISSUED' });
});

afterAll(async () => {
  await ctx.cleanup.runAll();
});
```

### Pattern B — fresh ctx per test (preferred for resilience / idempotency assertions)

```ts
it('handles redelivery idempotently', async () => {
  const ctx = await createTestContext();
  try {
    const trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: 'advisory', detailType: 'MANDATE_ISSUED' });
    // ... test body
  } finally {
    await ctx.cleanup.runAll();
  }
});
```

### Never `beforeEach`+`afterAll`

`beforeEach`-created traps leak their EB rule + SQS queue on `jest.retryTimes(1)` retries until `OrphanReaper` runs (1+ hour later). Each retry roughly doubles rule churn on the bus.
````

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/testing-patterns/SKILL.md
git commit -m "$(cat <<'EOF'
docs(testing-patterns): document trap-fixture cleanup pattern

Preventive convention — all current trap users already follow Pattern A
or B; convention exists to prevent regression.

Spec: docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md
EOF
)"
```

---

### Task 6: Smoke validation

**Files:** none (verification only)

- [ ] **Step 1: Unit-suite smoke**

Run:
```bash
pnpm nx test test-support
pnpm nx test integration-testing
```
Expected: both green. No regression from Tasks 1–4.

- [ ] **Step 2: Single-file integration smoke (trap-heavy file, no parallel)**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run advisory-adpt:test-integration
```
Expected: PASS. This is a trap-heavy file (3 `it`s, all cross-bus). It exercises `EventBusTrap.waitForEvent` against deployed dev infrastructure. If this fails with `Captured-but-unmatched buffer: []`, the fixture changes broke something at the SDK boundary — investigate before continuing.

- [ ] **Step 3: No commit needed** (verification step only).

---

### Task 7: Full validation — run #1

**Files:** none (verification only)

- [ ] **Step 1: Run full integration suite at `--parallel=8`**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration --parallel=8 --skip-nx-cache 2>&1 | tee /tmp/trap-hardening-run1.log
```
Expected: green exit code.

- [ ] **Step 2: Count first-attempt trap-empty failures**

Run:
```bash
grep -c "Captured-but-unmatched buffer: \[\]" /tmp/trap-hardening-run1.log
```
Expected: 0 (down from 5–7/run baseline).

If count is 1–2: partial win, note for backlog `validation_gate`.
If count is ≥3: workstream didn't close the gap. Stop here, do not run #2. Open a follow-up issue per spec § "Failure handling".

- [ ] **Step 3: Note wall-clock**

Read the final line of `/tmp/trap-hardening-run1.log` for total time. Record as `run1_wallclock` for the backlog close-out. Expected ≤ ~12:50 (11:37 baseline +10%).

- [ ] **Step 4: No commit needed** (verification step only).

---

### Task 8: Full validation — run #2

**Files:** none (verification only)

- [ ] **Step 1: Re-run full integration suite at `--parallel=8`**

Run:
```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration --parallel=8 --skip-nx-cache 2>&1 | tee /tmp/trap-hardening-run2.log
```
Expected: green exit code.

- [ ] **Step 2: Count first-attempt trap-empty failures**

Run:
```bash
grep -c "Captured-but-unmatched buffer: \[\]" /tmp/trap-hardening-run2.log
```
Expected: 0. Apply the same thresholds as Task 7 Step 2.

- [ ] **Step 3: Note wall-clock**

Same as Task 7 Step 3. Record as `run2_wallclock`.

- [ ] **Step 4: No commit needed** (verification step only).

---

### Task 9: Backlog close-out + PR

**Files:**
- Modify: `docs/backlog/integration-trap-empty-family-hardening.md`
- Modify: `docs/BACKLOG.md` (regenerated by lint --fix)

- [ ] **Step 1: Flip status to shipped + fill validation_gate**

Edit `docs/backlog/integration-trap-empty-family-hardening.md` frontmatter:
- Change `status: active` to `status: shipped`
- Change `validation_gate: null` to:
  ```yaml
  validation_gate: |
    Two consecutive --parallel=8 integration runs with zero first-attempt
    trap-empty failures. Run #1: <run1_wallclock>, 0 buffer-empty. Run #2:
    <run2_wallclock>, 0 buffer-empty. Baseline 11:37 + ≤10%.
  ```
Substitute the actual wall-clocks recorded in Tasks 7 and 8.

- [ ] **Step 2: Regenerate BACKLOG.md**

Run from the worktree:
```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```
Expected: `✓ 91 backlog files; all 7 rules pass (with --fix applied)`.

- [ ] **Step 3: Commit backlog close-out**

```bash
git add docs/backlog/integration-trap-empty-family-hardening.md docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): ship integration-trap-empty-family-hardening

Validation gate met: two consecutive --parallel=8 runs with zero
first-attempt buffer-empty failures. Wall-clock within +10% baseline.

Spec: docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md
EOF
)"
```

- [ ] **Step 4: Open PR**

Run:
```bash
git push -u origin feat/trap-empty-hardening
gh pr create --title "test-infra: harden trap-empty family at --parallel=8" --body "$(cat <<'EOF'
## Summary

- Bump `eventTimeout` default 45s → 90s in `libs/test-support/src/context.ts`
- Add ±25% jitter to `pollInterval` sleeps via shared `jitter()` helper in `libs/test-support`
- Document trap-fixture cleanup pattern as preventive convention in `testing-patterns` SKILL.md

Spec: `docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md`
Backlog: `docs/backlog/integration-trap-empty-family-hardening.md`

## Validation

Two consecutive `--parallel=8` integration runs with zero first-attempt `Captured-but-unmatched buffer: []` failures (down from 5–7/run baseline). Wall-clock within +10% of 11:37 baseline.

## Test plan

- [x] `pnpm nx test test-support` green (5 new `jitter` tests)
- [x] `pnpm nx test integration-testing` green (no regression)
- [x] `pnpm nx run advisory-adpt:test-integration` green (single-file smoke)
- [x] `pnpm nx run-many -t test-integration --parallel=8 --skip-nx-cache` × 2 runs, both green with 0 buffer-empty first-attempt failures

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: After merge, cleanup worktree**

Run from the main repo (not the worktree):
```bash
git worktree remove ../nestfolio-trap-empty
git branch -d feat/trap-empty-hardening
```
Expected: clean.

---

## Done definition

- All 9 tasks ✅
- PR merged to `main`
- `docs/backlog/integration-trap-empty-family-hardening.md` has `status: shipped` and a filled `validation_gate`
- `docs/BACKLOG.md` regenerated; "Recently Shipped (last 10)" lists this workstream
- Worktree removed; feature branch deleted locally
