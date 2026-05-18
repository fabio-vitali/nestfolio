---
id: eventbustrap-batch-race-loses-sibling-events
status: queued
type: bug
rank: 1
notes: "EventBusTrap.waitForEvent returns mid-loop on first match, leaving later events in the same SQS batch unbuffered and lost — flakes update-operating-mode.e2e.test.ts:182 when both events from one CDC batch arrive in one SQS receive."
references:
  - libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
  - apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
  - docs/backlog/update-operating-mode-cdc-silent.md
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_operating_mode.md
  - project_e2e_feature_tests.md
validation_gate: null
---

# EventBusTrap batch-race loses sibling events

## Surfacing run

2026-05-19 e2e suite (32/33 PASS, single fail): `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts:182` failed with:

```
EventBusTrap: timeout waiting for event INVESTOR_PROFILE_UPDATED after 60000ms.
Captured-but-unmatched buffer: []
```

Line 174 (the first `waitForEvent` for `OPERATING_MODE_CHANGED`) succeeded — the failure fires only at line 182 (second `waitForEvent` for `INVESTOR_PROFILE_UPDATED`). The test author's own comment at lines 173-175 acknowledges both events "originate from one CDC batch but arrive in non-deterministic order on the trap."

## Evidence

`libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:230-244`:

```ts
const fresh = await this.consumeMessages(/* … */);

for (const event of fresh) {
  if (satisfies(event)) {
    return event as CapturedEvent<TDetail>;   // returns mid-loop
  }
  this.captured.push(event);                  // unreached for trailing entries
}
```

If a single SQS receive returns `[OPERATING_MODE_CHANGED, INVESTOR_PROFILE_UPDATED]` (order non-deterministic) and the caller is waiting for `OPERATING_MODE_CHANGED`:

- iter 1: matches → `return` → loop body never executes for iter 2
- `INVESTOR_PROFILE_UPDATED` is **never pushed to `this.captured`**, and the SQS message has already been consumed by `consumeMessages` (long-poll receive + dedup-aware helper)
- 2nd `waitForEvent` finds buffer empty, SQS empty → 60s timeout

Reverse arrival order (`INVESTOR_PROFILE_UPDATED` first in `fresh`) → both handled correctly, test passes. Matches the flake history: yesterday's "fix" (commit `a6fb1985`, redeploy of investor-bff) didn't touch libs — it just got lucky on subsequent runs.

## Why this is distinct from `update-operating-mode-cdc-silent`

`update-operating-mode-cdc-silent` was shipped 2026-05-18 with root cause "stale Lambda bundle". That dossier's instrumentation proved **both events publish in one batch with `publish OK 2`** — i.e., CDC is producing both events correctly. The remaining intermittent failure is downstream of publish, in the test fixture.

Today's Lambda state confirms the bundle is post-fix:

```
dev-investor-bff-EgressPublisherDB741A6E-NvEv6noNaZZJ
LastModified: 2026-05-18T13:09:42Z  (= the clean redeploy at the end of a6fb1985)
```

So the regression today is not a bundle drift — it's the trap losing one of two simultaneously-arriving events.

## Cheapest next step

One-line restructure of `waitForEvent`: process all `fresh` entries before returning, buffering non-matches even after a match is found. Approximate shape:

```ts
let matched: CapturedEvent | undefined;
for (const event of fresh) {
  if (!matched && satisfies(event)) matched = event;
  else this.captured.push(event);
}
if (matched) return matched as CapturedEvent<TDetail>;
```

Then re-run `update-operating-mode.e2e.test.ts` repeatedly (≥ 5 consecutive PASS) to confirm. Since `EventBusTrap` is the shared fixture used by ~all e2e + many integration tests, run the full suite once before merging.

## Out of scope (filed separately if needed)

- Redesigning the trap's SQS receive semantics (long-poll vs short-poll, batch sizing, visibility timeout). Only the buffer-loss bug is in scope.
- Adding integration coverage on the trap itself. Possible follow-up tooling work.
- Re-litigating the stale-bundle root cause from `update-operating-mode-cdc-silent` (which remains the documented historical explanation, with the EB-flake alternative).
