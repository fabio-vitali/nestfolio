# Trap-empty family hardening — design

**Status:** design ready for plan
**Backlog:** `integration-trap-empty-family-hardening`
**Date:** 2026-05-12

## Problem

At `--parallel=8`, the integration suite produces 5–7 intermittent failures per run of the form:

```
EventBusTrap: timeout waiting for event <X> after 45000ms. Captured-but-unmatched buffer: []
```

The trap saw zero events. Failures span unrelated services (advisory-adpt forwarding, ledger-ctrl CDC, broker-ctrl pairwise, investor-bff `INVESTOR_PROFILE_CREATED`, investor-ctrl circuit-breaker, market-intelligence-ctrl hooks) and almost always retry-pass under `jest.retryTimes(1, { logErrorsBeforeRetry: true })`. Lever 4 (`integration-suite-lever-4-parallelism`) shipped `--parallel=8` with these absorbed by retry; this workstream eliminates them at the source.

## Diagnosis

Three candidate causes were considered:

1. **Trap canary verifies only the local rule.** The canary publishes directly to the target bus (`event-bus-trap.fixture.ts:109-122`) and waits for itself. This confirms the trap's own EB rule + SQS wiring, not the upstream production path (forwarding rule, CDC stream, SUT Lambda) that the real test event traverses.
2. **Orphan rules on `jest.retryTimes(1)` retries.** Originally hypothesised to bite suites that create traps in `beforeEach` and clean them up in `afterAll`. Inspection confirmed **no suite in the repo uses that pattern today**: every trap user is either `beforeAll`+`afterAll` (shared trap) or per-`it` `try/finally` (fresh ctx per test). The orphan claim is preventive, not corrective.
3. **EB rule propagation tax + Lambda cold start.** AWS's PutRule reference says only: *"When you create or update a rule, incoming events might not immediately start matching to new or updated rules. Allow a short period of time for changes to take effect."* — [PutRule API Reference](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutRule.html). The size of the "short period" is undocumented. Compounding factors: Lambda cold start (heaviest paths can take 20–30s on our stack), CDC stream poll latency, and SQS empty-poll lockstep across 8 parallel workers.

The decision: **don't expand the trap fixture's responsibility**. The fixture's job is to verify *its own* scaffolding is healthy. Verifying upstream production paths conflates "trap is ready" with "SUT delivered" and crosses test scope.

What remains is the post-warmup tail: cold starts + propagation tax that today's 45s `eventTimeout` doesn't always absorb under `--parallel=8`.

## Changes

### 1. `eventTimeout` default: 45_000 → 90_000

File: `libs/test-support/src/context.ts`, in `createTimingConfig`.

Rationale: `waitForItem` (DDB polling) ships at 60s today per the `advisory-narrative-ctrl-tightening-cold-start-flake` workstream. Trap polling carries additional EB-side latency over DDB polling, so a higher floor is principled. 90s on the fail path adds ~45s per failing test to suite wall-clock; the goal of this workstream is reducing failures, so the trade is acceptable. `INTEG_TIMEOUT_MULTIPLIER` env var stays as the per-environment scaling knob.

### 2. `pollInterval` jitter: ±25% applied at sleep time

Files:
- `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts` — `waitForEvent` loop
- `libs/integration-testing/src/fixtures/table-assertions.ts` — its poll loop

Change the sleep call from `setTimeout(resolve, pollInterval)` to:

```ts
const jittered = pollInterval * (0.75 + Math.random() * 0.5);
await new Promise(r => setTimeout(r, jittered));
```

For default `pollInterval=500ms`, sleeps range 375–625ms. Decorrelates lockstep polling across 8 parallel test workers so SQS reads don't all hit "no events yet" at the same wall-clock moments. No public API change — `ctx.timings.pollInterval` is now interpreted as a mean rather than an exact value.

### 3. Trap-fixture cleanup pattern documented (preventive)

File: `.claude/skills/testing-patterns/SKILL.md` — appended section:

> ### Trap-fixture cleanup pattern
>
> When using `EventBusTrap`, follow **one** of these two patterns:
>
> **Pattern A — shared trap (preferred for read-only assertions):** `beforeAll` creates ctx + trap; `afterAll` runs `ctx.cleanup.runAll()`.
>
> **Pattern B — fresh ctx per test (preferred for resilience / idempotency assertions):** create ctx + trap inside `it`; wrap body in `try { ... } finally { await ctx.cleanup.runAll() }`.
>
> **Never `beforeEach`+`afterAll`.** `beforeEach`-created traps leak their EB rule + SQS queue on `jest.retryTimes(1)` retries until `OrphanReaper` runs (1+ hour later). Each retry roughly doubles rule churn on the bus.

All current trap users already follow Pattern A or B; the convention exists to prevent regression.

## Tests for the changes themselves

- `libs/test-support/test/context.test.ts` — no change (no existing assertion on the old default).
- `libs/integration-testing/test/fixtures/event-bus-trap.test.ts` — add one `describe('pollInterval jitter', …)` block that mocks `Math.random` with three fixed values (0, 0.5, 0.999) and asserts the sleep duration locks in at 375ms (floor), 500ms (mean), and ~625ms (ceiling). Pure arithmetic verification; no SDK calls.
- `libs/integration-testing/test/table-assertions.test.ts` — no change (existing inline `pollIntervalMs` overrides still hold; jitter math is covered above).

## Validation gate

**Command:** `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration --parallel=8 --skip-nx-cache`

**Pass criteria — all three must hold across two consecutive runs:**

1. **Zero `Captured-but-unmatched buffer: []` errors in first-attempt output.** Parse stdout under `jest.retryTimes(1, { logErrorsBeforeRetry: true })`. Target: zero (down from 5–7/run baseline).
2. **Suite exits green** — even if a non-trap-empty flake fires, jest retry catches it.
3. **Suite wall-clock within +10% of the 11:37 baseline** established by `integration-suite-lever-4-parallelism` on 2026-05-12. The timeout bump only affects the fail path; green-path wall-clock should be flat.

**Failure handling:**
- ≥3 trap-empty first-attempt failures → workstream didn't close the gap. File follow-up to investigate Lambda cold-start as primary cause (SUT-warmup hook is the leading candidate).
- 1–2 trap-empty first-attempt failures → partial win; ship and file the specific failing tests for individual investigation.
- Hard test failures unrelated to trap-empty → file in backlog, ship the trap changes if they don't cause the unrelated failures.

## Rollout

Single commit on `feat/trap-empty-hardening` (worktree off `main`):
1. `libs/test-support/src/context.ts` — bump default
2. `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts` — apply jitter
3. `libs/integration-testing/src/fixtures/table-assertions.ts` — apply jitter
4. `libs/integration-testing/test/fixtures/event-bus-trap.test.ts` — add jitter unit test
5. `.claude/skills/testing-patterns/SKILL.md` — append cleanup-pattern section

Verification ladder (each gate must pass before the next):

| # | Step | Pass criterion |
|---|------|----------------|
| 1 | `pnpm nx test test-support` | green |
| 2 | `pnpm nx test integration-testing` | green; jitter test passes |
| 3 | `pnpm nx run advisory-adpt:test-integration` (single trap-heavy file, no `--parallel`) | green; fixture works end-to-end against dev |
| 4 | Full `--parallel=8` validation — run #1 | Section "Validation gate" pass criteria |
| 5 | Full `--parallel=8` validation — run #2 | Section "Validation gate" pass criteria |

Backlog close-out after step 5: set `status: shipped` and fill `validation_gate` with the two run wall-clocks + first-attempt trap-empty counts in `docs/backlog/integration-trap-empty-family-hardening.md`, then `node .claude/skills/backlog-lint/lint.mjs --fix`.

## Out of scope

- **`viaForwarding` / cross-bus canary.** Crosses test scope — integration tests assert SUT behaviour, not upstream forwarding health.
- **SUT-warmup hook.** A leading candidate if validation fails; deferred until the timeout bump's effect is measured.
- **Quiet-period / N-canary warmup.** AWS's "rule is now matching" signal is taken at face value; one canary success is treated as sufficient.
- **Rule pooling or per-suite trap reuse** (backlog's Fix D). Deferred unless rule-churn rate-limit pressure persists at `--parallel=8` after this workstream.
- **Removing `jest.retryTimes(1)`.** Kept as belt-and-suspenders post-fix.
- **broker-ctrl `pairwise SIM_DEPOSIT/WITHDRAWAL` retry.** Same family by symptom; closes by validation gate if it's a trap-empty cause, otherwise refiled separately.
- **CI enforcement of the cleanup pattern.** Doc convention only; an AST-walker lint rule is not justified for a pattern that doesn't exist today.
