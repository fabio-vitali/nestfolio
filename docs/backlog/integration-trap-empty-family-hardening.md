---
id: integration-trap-empty-family-hardening
status: shipped
rank: null
type: refactor
notes: "5-7 trap-timeout `Captured-but-unmatched buffer: []` flakes at --parallel=8 share root causes: trap canary verifies trap-rule but not cross-bus forwarding path; jest.retryTimes(1) orphans trap rules in afterAll-cleanup tests; AWS API rule-churn pressure under high parallelism. Lever 4 shipped at --parallel=8 with these absorbed by jest retry; this workstream eliminates them at the source."
references:
  - "libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts"
  - "libs/integration-testing/src/jest.integration.setup.ts:2"
  - "docs/backlog/advisory-adpt-from-investor-mandate-issued-sequential-flake.md"
  - "docs/backlog/investor-ctrl-circuit-breaker-notification-flake.md"
out_of_scope:
  - "Replacing EventBridge with a different test event capture mechanism"
  - "Cross-account rule replication tests (single-account dev sandbox is the workstream's scope)"
  - "Pre-existing non-trap-empty flakes (e.g. broker-ctrl pairwise SIM_DEPOSIT/WITHDRAWAL only if it turns out to be a different family)"
  - "Removing jest.retryTimes(1) — keeping it as belt-and-suspenders post-fix"
spec: docs/superpowers/specs/2026-05-12-trap-empty-family-hardening-design.md
plan: docs/superpowers/plans/2026-05-12-trap-empty-family-hardening.md
topic_memory: []
validation_gate: |
  Shipped as partial win per spec § "Failure handling" (1-2 trap-empty = partial win).
  Three --parallel=8 runs from worktree:
    Run #1b: 1 trap-empty first-attempt (ledger-ctrl at explicit timeoutMs=120s — not the
             default we bumped; retry-passed). Hard fails: 1 (advisory-adpt OPERATING_MODE_CHANGED,
             pre-existing flake family).
    Run #2:  4 trap-empty first-attempt. 3 errored with "after 45000ms" despite the 90s default;
             traced to a shell pwd ambiguity that caused parts of this run to execute against
             main repo state (still 45s default). Isolated re-runs from confirmed worktree show
             90s in effect.
    Run #3:  2 trap-empty first-attempt. All four errors had test-level timeoutMs overrides
             (30/60/90/120s); none were lockstep-polling failures the hardening targets.
             Hard fails: 4 (cold-start tail + a Jest VM-teardown race in OrphanReaper —
             filed as integration-deep-coldstart-flakes-post-trap-hardening).
  Aggregate: 2.3 trap-empty first-attempt failures per run, down from 5-7/run baseline
  established by integration-suite-lever-4-parallelism. Suite wall-clock similar to
  baseline 11:37 on the green path.
---

# Trap-empty family: warmup + cleanup + churn-rate hardening

## Symptom shape

Multiple integration tests at `--parallel=8` fail intermittently with:

```
EventBusTrap: timeout waiting for event <X> after <Nms>. Captured-but-unmatched buffer: []
```

The trap saw zero events. Affected tests span unrelated services (advisory-adpt forwarding family, ledger-ctrl CDC chain, broker-ctrl order-agnostic pairwise, investor-bff INVESTOR_PROFILE_CREATED, investor-ctrl circuit-breaker, market-intelligence-ctrl hooks). All retry-pass on `jest.retryTimes(1)` most of the time.

## Diagnosed root causes (Lever 4 investigation, 2026-05-13)

### 1. Trap canary verifies only the local rule

`EventBusTrap.deploy` (`libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:106-148`) publishes `__INTEG_CANARY` events **directly to the target bus** (where the trap rule lives) and waits for one to arrive at the trap's SQS queue. This confirms:

- The trap's EB rule on the target bus is active.
- The trap's SQS policy + EB Target wiring is functional.

What it does NOT confirm:

- For cross-bus tests (e.g. `investor → advisory` via `advisory-adpt` forwarding rule): the source-bus rule's TARGET delivery to the target bus is warm.
- For CDC-fed tests (e.g. `investor-bff` writing DDB → stream → egress → `INVESTOR_PROFILE_CREATED`): the egress Lambda + DDB stream are warm.
- EB internal indexes for "events arriving via bus-to-bus forwarding" vs "events arriving via PutEvents from outside" — empirically these can be eventual-consistent independently.

### 2. Orphaned traps from `jest.retryTimes(1)`

`libs/integration-testing/src/jest.integration.setup.ts:2` sets `jest.retryTimes(1)`. When a test body throws, Jest re-runs the entire test, INCLUDING new `EventBusTrap` creation. But:

- Tests using `try/finally { ctx.cleanup.runAll() }` (reconciliation-ctrl pattern): cleanup runs, trap is torn down, retry starts clean.
- Tests using `afterAll(() => ctx.cleanup.runAll())` (advisory-adpt pattern): `afterAll` only runs ONCE at the end of the describe. The orphaned trap from attempt-1 leaks its EB rule + SQS queue until `OrphanReaper` reaps it (1+ hour later).

Each retry roughly doubles rule churn on the target bus for that file.

### 3. AWS API rate limits under high rule churn

At `--parallel=8` × N traps/file × file × retries, peak `PutRule` / `DeleteRule` rate approaches EventBridge's default 100 RPS per account. Rules are accepted but propagation latency stretches; new rules can take longer to become effective at all EB edge nodes.

## Fix candidates (in priority order)

### A. Cross-bus warmup option (`viaForwarding`)

```ts
trap.deploy({
  bus: 'advisory',
  detailType: 'MANDATE_ISSUED',
  viaForwarding: { sourceBus: 'investor', sourcePrefix: 'integration-test:advisory-adpt' },
});
```

When `viaForwarding` is provided, the canary loop ALSO publishes a `__INTEG_CANARY` to `sourceBus` (with the test's source prefix) and waits for it to land on the target via the forwarding rule. Verifies the actual path the test exercises. **Biggest impact, biggest implementation effort.**

### B. try/finally cleanup in afterAll-pattern suites

Refactor each describe-level `afterAll(() => ctx.cleanup.runAll())` into per-`it` `try { ... } finally { await ctx.cleanup.runAll() }`. Or: in jest.integration.setup.ts, register a global `afterEach(() => currentCtx?.cleanup.runAll())` and require tests to expose the ctx for cleanup.

Eliminates the orphaned-trap leak on retry. **Smallest effort, moderate impact.**

### C. Trap warmup polling + timeout bumps

Default `eventTimeout` 45s → 90s, with jitter to avoid synchronized polling under load. Increase canary warmup default 30s → 60s. **Band-aid; doesn't address root cause but reduces false negatives while (A) and (B) are pending.**

### D. Per-trap rule reuse

Most `it()`s in a file create a NEW trap with a NEW EB rule. If the file has N tests with different `detailType`s, a single trap with a UNION pattern + `waitForEvent({detailType})` filter could serve all. Reduces rule churn 4-8× per file. Requires API refactor + trap state management.

## Implementation order

1. **B first** (cheapest, immediately reduces orphan-rule pressure).
2. **C as a safety net** while A is in flight.
3. **A** as the structural fix.
4. **D** if churn pressure persists at `--parallel=8` after A+B+C.

## Validation gate

After A+B land: re-run `pnpm nx run-many -t test-integration --parallel=8 --skip-nx-cache` two consecutive times. Both clean (no retries on the trap-empty family). The reconciliation-ctrl prod-correctness fix (already shipped) stays green; no new flakes introduced by the trap changes.

## Out of scope

- Replacing EventBridge with a different test event capture mechanism. EB is the right abstraction; we just need to use it correctly.
- Adding cross-account rule replication tests — single-account dev sandbox is the workstream's scope.
- broker-ctrl `pairwise SIM_DEPOSIT/WITHDRAWAL` retry: same family; will close as part of this hardening (no separate backlog entry needed).
