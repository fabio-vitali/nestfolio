---
id: ip-ctrl-integration-snapshot-userid-mismatch
status: parking
type: bug
notes: "Pre-existing IP-ctrl integration test 'materialises…INVESTOR_PROFILE_UPDATED' fails DETERMINISTICALLY (2/2 runs) reading back the fixture ctx.userId instead of the test's local userId at an exact-pk GetItem. Surfaced during WS-B (read-model-ownership-w-b-version-carriage) validation; proven NOT WS-B-caused. Mechanism unresolved (observed value contradicts the code path)."
references:
  - services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts
  - services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts
  - libs/integration-testing/src/fixtures/table-assertions.ts
  - libs/test-support/src/fixtures/event-bridge-client.ts
  - libs/test-support/src/context.ts
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# IP-ctrl integration: `materialises…INVESTOR_PROFILE_UPDATED` reads a foreign `ctx.userId`

Surfaced 2026-06-02 during WS-B (`read-model-ownership-w-b-version-carriage`) validation. The test
`investor-profile-ctrl: … › materialises an InvestorProfileSnapshot row on INVESTOR_PROFILE_UPDATED`
fails on `expect(snapshot['userId']).toBe(userId)`.

## Evidence (two runs, deterministic)

- Run 1 (full `nx run-many test-integration`): `Expected: "integ-profile-user-68a060ec-…"  Received: "integ-user-1780426747502-2fde1d50"`.
- Run 2 (isolated, basic file only — no resilience concurrency): `Expected: "integ-profile-user-a7a06ce0-…"  Received: "integ-user-1780427361363-fbca819f"`.
- Each run's "Received" value is **that run's `ctx.userId`** (`libs/test-support/src/context.ts:74` → `integ-user-${timestamp}-${entropy}`), not the test's local `integ-profile-user-${randomUUID()}`.
- The failure is **fast** (~1480 ms) — a row is found at the test's pk almost immediately (mock agent writes quickly).
- Sibling tests in the SAME file **pass**: `materialises…MANDATE_ISSUED` (same exact-pk read + userId assertion) and the WS-B `rebuilds…INVESTOR_PROFILE_SNAPSHOT_UPDATED with __version 2` test (151 s).

## Why this is logically puzzling

The read (`libs/integration-testing/src/fixtures/table-assertions.ts:63-68`) is an **exact `GetItemCommand`** on
`pk = InvestorProfileSnapshot#${ctx.tenantId}#${localUserId}`, `sk = 'InvestorProfileSnapshot'`. The injector
(`libs/test-support/src/fixtures/event-bridge-client.ts:42-52`) puts the test detail (with `localUserId`) as
`subject`, and the fixture identity (`ctx.userId`) only under `context`. The handler
(`services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts:47-52,94-105`) stamps
`userId = subject.userId ?? tenantId` into **both** the pk segment and the `userId` field from one variable —
so a row at `…#localUserId` must carry `userId = localUserId`. The observed `userId = ctx.userId` at that exact
pk is inconsistent with this code. No `beforeAll` seed exists. The table is empty post-run (afterAll cleanup
deletes observed rows), so no post-mortem of the offending row was possible.

## Why it is NOT caused by WS-B

WS-B's only IP-ctrl change is `record()` → `update()` upsert + `{ add: { __version: 1 } }` on the
`InvestorProfileSnapshot` write. That change applies **uniformly** to all three snapshot triggers
(INVESTOR_PROFILE_UPDATED / MANDATE_ISSUED / OPERATING_MODE_CHANGED — same `update()` call). A uniform change
cannot break only **one** of three structurally-identical tests; the `MANDATE_ISSUED` sibling (same
write+read+assert) passes, and the WS-B two-trigger `__version 2` test passes on live dev. The userId/pk
resolution WS-B touches is unchanged. ⇒ deterministically not WS-B-attributable.

## Candidate root causes (for the investigator)

1. A test-isolation/contamination path specific to the **first** test in the file (e.g., a leftover/seed row, or
   an env/identity bleed) writing an `InvestorProfileSnapshot` at the test's pk with `ctx.userId`.
2. A deployed-bundle vs source skew (the deployed Lambda resolving userId differently than the source reads) —
   would warrant comparing the deployed `event-listener` bundle's userId resolution against source.
3. A `waitForItem`/marshalling subtlety returning a different item than the exact key implies.

## Cheapest next step (when promoted)

Add a one-shot debug log of `subject.userId` / resolved `userId` / final pk in the deployed handler (or a
temporary CloudWatch query during a single run), and capture the actual DDB row at the test's pk **before**
afterAll cleanup runs (e.g., disable cleanup for the debug run). Compare pk-segment vs `userId` field directly.

## Why parking (not queued)

- Integration test, not an `apps/e2e-feature-tests` / `apps/nestfolio-e2e` blocker — per the e2e-gaps-queued
  rule, integration findings stay parking.
- WS-B shipped with this documented as a pre-existing, non-WS-B exception (see WS-B `validation_gate`).
- Cost to root-cause is bounded but needs a live debug run; not justified mid-WS-B.

Promote when: the next IP-ctrl workstream (WS-C consumer conversions touch IP-ctrl mirror) is picked up, OR if
the same userId-mismatch signature appears in another service's snapshot integration test.

## Related

- [[read-model-redesign]] — surfaced during the producer-aggregates program's WS-B validation.
