# Decouple `onboarded()` e2e fixture from synchronous AgentCore materialisation

- **Date:** 2026-05-21
- **Backlog:** `e2e-fixture-agentcore-synchronous-coupling`
- **Type:** refactor (e2e test infrastructure)

## Problem

`apps/e2e-feature-tests/src/helpers/fixtures.ts` `onboarded()` performs two
sequential waits after emitting `USER_REGISTERED` + `ONBOARDING_COMPLETED`:

1. **`getProfile` GraphQL poll** (60s budget) — confirms the composite
   `InvestorProfile` row exists. Materialised by the investor-bff event-listener
   projecting `ONBOARDING_COMPLETED`. **Not** agent-gated; resolves in seconds.
2. **`InvestorProfileSnapshot` DDB poll** (360s budget) — polls IP-ctrl's table
   for a row written by IP-ctrl's Bedrock AgentCore agent (user-goals Haiku +
   risk-assessment Sonnet 4.6). Wall-clock cost is gated by agent-invoke latency
   (observed 19–89s, plus an SQS native-redrive recovery window after
   `agentcore-invocation-resilience` raised the budget to 360s).

Every `onboarded()`-using scenario pays wait (2) in `beforeEach`. Investigation
of the suite shows **15 scenarios** call `onboarded()`, but only **3** drive a
real decision-workflow-ctrl (DWC) decision cycle that reads the snapshot:

- `advisory/first-decision.e2e.test.ts` — calls `withLiveDecision()`; its own
  comment notes it relies on `onboarded()` having waited for the snapshot.
- `advisory/rebalance-on-drift.e2e.test.ts` — calls `withLiveDecision()`.
- `advisory/operating-mode-recommendation-shape.e2e.test.ts` — inlines the
  `withLiveDecision` trigger pattern manually; still drives a real DWC cycle.

The DWC per-cycle Step Function reads the **DWC-local mirror** of
`InvestorProfileSnapshot` (materialised by `SnapshotProjectorIngress` CDC). If
the snapshot does not yet exist when the cycle triggers, the SF races IP
precomputation. So those 3 scenarios genuinely need the snapshot present first.

The other ~12 scenarios (`accept-decision`, `reject-decision`,
`view-decision-explanation` — which use the synthetic `withDecision()` that
short-circuits the SF — plus all funding / notification / profile scenarios)
need an **onboarded tenant**, not a freshly-reasoned profile. They pay up to
360s of agent latency for a precondition they never consume.

## Approach

**Split the fixture.** Extract wait (2) into a new composable fixture
`withProfileSnapshot()`, alongside the existing `funded()` / `withDecision()` /
`withHoldings()` fixtures. `onboarded()` retains the two event emits and wait
(1) only.

Direct-DDB seeding of the snapshot row was considered and **rejected** — it
would conflict with the events-only fixture convention (`feedback_no_seeder_fixtures`),
and the only scenarios that would benefit are the 3 live-decision scenarios,
which drive real Bedrock waves by design anyway. Splitting the fixture captures
essentially all of the available win (≈12 of 15 scenarios) with zero convention
conflict.

## Detailed design

### `withProfileSnapshot()` — new fixture

A `Fixture` (same signature as the others). No options. Body is the existing
360s `InvestorProfileSnapshot` poll loop relocated **verbatim** from
`onboarded()`:

- Resolves IP-ctrl's table name via `ctx.ssm.tableName('investor-profile-ctrl')`.
- Polls `GetCommand` on key
  `pk = InvestorProfileSnapshot#{tenantId}#{userId}`, `sk = InvestorProfileSnapshot`.
- 360s deadline, 2s interval; throws
  `withProfileSnapshot(): InvestorProfileSnapshot not materialised within 360s`
  on timeout.
- `DynamoDBClient` created and `.destroy()`-ed in a `finally`, as today.
- The native-redrive budget comment is carried over unchanged.

Read-only — no DDB writes — so `feedback_no_seeder_fixtures` is untouched.

### `onboarded()` — slimmed

Retains: `USER_REGISTERED` emit, `ONBOARDING_COMPLETED` emit, `getProfile`
GraphQL wait (60s). The `InvestorProfileSnapshot` poll block and its
now-unused `DynamoDBClient`/`GetCommand` imports move out (imports stay if
still used by other fixtures in the file — `withBreakerOpen` etc. use
`PutCommand`/`UpdateCommand`; `GetCommand` is still used by `funded()`).

The `onboarded()` JSDoc is updated to drop the snapshot-wait description and
point callers needing a decision cycle to `withProfileSnapshot()`.

### Export surface

`withProfileSnapshot` is added to the re-export block in
`apps/e2e-feature-tests/src/index.ts` next to `withLiveDecision`.

### Scenario updates

The 3 live-decision scenarios add `withProfileSnapshot()` to their fixture
composition, sequenced **after `onboarded()` and before** the decision-cycle
trigger, and import it:

- `first-decision.e2e.test.ts` — `[onboarded()]` becomes
  `[onboarded(), withProfileSnapshot()]`.
- `rebalance-on-drift.e2e.test.ts` — insert `withProfileSnapshot()` between
  `onboarded()` and `withLiveDecision()` in the fixture array.
- `operating-mode-recommendation-shape.e2e.test.ts` — insert
  `withProfileSnapshot()` after `onboarded({ … })` and before the inlined
  cycle trigger.

The exact array positions are determined during plan execution by reading each
file; the principle is fixed here.

No other scenario files change — they simply inherit the faster `onboarded()`.

### Accepted consequence — background re-decision race

Profile-mutation scenarios (`update-goal`, `update-operating-mode`,
`revoke-mandate`) emit `INVESTOR_PROFILE_UPDATED` on mutation, which can trigger
a background DWC re-decision SF. With `onboarded()` no longer waiting for the
snapshot, that SF may race IP precomputation. This is acceptable: none of those
scenarios assert on a decision packet, so a racing or orphaned background SF
does not affect their assertions. They drop the wait and run fast.

## Testing & validation

Test-infrastructure-only change — no service code, no CDK, **no deploy**.

- `pnpm nx affected -t lint --base=origin/main` — passes for the e2e app.
- Scoped e2e gate against deployed dev (per `feedback_always_rerun_e2e` — the
  *involved* tests only, never the full suite, never Playwright):
  - The 3 live-decision scenarios — `first-decision`, `rebalance-on-drift`,
    `operating-mode-recommendation-shape` — must still pass with
    `withProfileSnapshot()` composed in.
  - A fast-path sample — `accept-decision` and `fund-account` — must pass
    without the snapshot wait, confirming the decoupling is correct and the
    `beforeEach` is faster.
- No unit tests — fixtures are not unit-tested; their correctness is proven by
  the e2e scenarios that consume them.

## Out of scope

- Reducing the actual decision-cycle latency inside `withLiveDecision` (180s
  budget) — end-to-end pipeline tuning, not a fixture-coupling concern.
- Changing the 360s native-retry poll budget — `agentcore-invocation-resilience`
  set it deliberately; this workstream relocates the poll, it does not retune it.
- Direct-DDB seeding of the `InvestorProfileSnapshot` row — rejected above.
- Other fixtures (`funded`, `withDecision`, `withHoldings`, etc.) — unchanged.
