---
id: investor-bff-onboarding-jest-retry-pollution
status: shipped
closed: "2026-05-13"
type: bug
notes: "investor-bff `should atomically write composite InvestorProfile + Mandate row on ONBOARDING_COMPLETED` failed first on `waitForEvent('MANDATE_ISSUED')` at 60s. Jest auto-retry re-fired both events with the same userId (cognitoSub), turning the second ONBOARDING_COMPLETED Put into a CDC MODIFY → emit INVESTOR_PROFILE_UPDATED instead of INVESTOR_PROFILE_CREATED. The retry's `waitForEvent('INVESTOR_PROFILE_CREATED')` then timed out at 60s. Fix: (1) StateResetFixture clears the row pk at test start so every attempt sees a clean slate, (2) bump inner waitForEvent timeouts 60s→90s to match eventTimeout default. cognitoSub preserved so downstream tests in the suite still find the row."
references:
  - "services/investor/investor-bff/test/integration/investor-bff.integration.test.ts:176"
  - "libs/integration-testing/src/jest.integration.setup.ts:2"
  - "services/investor/investor-bff/src/service.stack.ts"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "pnpm nx run investor-bff:test-integration --skip-nx-cache GREEN on dev sandbox (validate after deploy)"
---

# investor-bff ONBOARDING_COMPLETED test — Jest retry pollution + tight inner timeout

## Symptom (2026-05-13)

Integration suite run, single suite failure:

```
LOGGING RETRY ERRORS  investor-bff event materializations should atomically write composite InvestorProfile + Mandate row on ONBOARDING_COMPLETED
 RETRY 1
    EventBusTrap: timeout waiting for event MANDATE_ISSUED after 60000ms. Captured-but-unmatched buffer: []

  ● investor-bff › event materializations › should atomically write composite InvestorProfile + Mandate row on ONBOARDING_COMPLETED
    EventBusTrap: timeout waiting for event INVESTOR_PROFILE_CREATED after 60000ms. Captured-but-unmatched buffer:
      [{"detailType":"INVESTOR_PROFILE_UPDATED", ...eventName:"MODIFY"...},
       {"detailType":"MANDATE_REVOKED", ...status:"ACTIVE"...},
       {"detailType":"INVESTOR_PROFILE_UPDATED", ...eventName:"MODIFY"...}]
```

17/18 other tests in the same file passed.

## Root cause

Two chained issues:

1. **First-attempt timeout on MANDATE_ISSUED.** The test fires USER_REGISTERED + ONBOARDING_COMPLETED, then waits for INVESTOR_PROFILE_CREATED + MANDATE_ISSUED. Both events come from the same `transactWrite` (two DDB items in one transaction → two CDC stream records emitted to the egress Lambda). The egress Lambda emits INVESTOR_PROFILE_CREATED first, MANDATE_ISSUED second. Under load the inter-emit gap can straddle a DDB-stream batch boundary and exceed the explicit `timeoutMs: 60_000` set on `trap.waitForEvent` — even though the default `ctx.timings.eventTimeout` is 90s. The test's local timeout was tighter than the global default.

2. **Retry pollution on retry.** `libs/integration-testing/src/jest.integration.setup.ts:2` enables `jest.retryTimes(1)`. The failing test uses `cognitoSub` (the suite-level Cognito sub from `beforeAll`) as the userId for the InvestorProfile/Mandate composite row PK. On retry, the same userId means the same DDB PK — the row already exists from the first attempt's transactWrite. The retry's ONBOARDING_COMPLETED Put now hits an existing row → CDC emits MODIFY → `INVESTOR_PROFILE_UPDATED` (not `INVESTOR_PROFILE_CREATED`). The retry's `waitForEvent('INVESTOR_PROFILE_CREATED')` times out at 60s with the buffer full of UPDATED events.

The test's pre-existing comment block warned about exactly this hazard ("jest's auto-retry would otherwise re-fire ONBOARDING_COMPLETED, turning the second Put into a CDC MODIFY") — the `waitForItem` guard prevents the *waitForItem* call from re-firing, but cannot prevent retry triggered by a *subsequent* throw.

## First fix attempt (broke downstream tests)

Initial fix used a fresh `crypto.randomUUID()` userId per attempt. This isolated the retry but broke 5 downstream tests in the same suite that read the row by `cognitoSub` (the suite-level Cognito sub created in `beforeAll`). The test comment chain at lines 308, 474, 721 referenced "InvestorProfile already exists from ONBOARDING_COMPLETED materialization test" — downstream tests treat this test as a fixture for cognitoSub's row.

## Fix applied

`services/investor/investor-bff/test/integration/investor-bff.integration.test.ts:176`

```diff
 it('should atomically write composite InvestorProfile + Mandate row on ONBOARDING_COMPLETED', async () => {
   const userId = cognitoSub;
   const pk = `InvestorProfile#${ctx.tenantId}#${userId}`;

+  // Clear any rows under this pk so jest.retryTimes(1) finds a clean slate.
+  // Without this, a retry triggered by a downstream throw (e.g. the inner
+  // waitForEvent timing out) would re-fire ONBOARDING_COMPLETED against the
+  // row that the first attempt already wrote — turning the second Put into
+  // a CDC MODIFY and emitting INVESTOR_PROFILE_UPDATED instead of CREATED.
+  // Downstream tests in this suite that read by cognitoSub are unaffected;
+  // they observe the row this test re-creates.
+  await new StateResetFixture(ctx).reset([{ table: 'investor-bff', pk }]);
   ...
-  const created = await trap.waitForEvent({ detailType: 'INVESTOR_PROFILE_CREATED', timeoutMs: 60_000 });
-  const accepted = await trap.waitForEvent({ detailType: 'MANDATE_ISSUED', timeoutMs: 60_000 });
+  // 90s matches ctx.timings.eventTimeout default — CDC for two rows in one
+  // transactWrite can straddle DDB stream batches and exceed a 60s budget.
+  const created = await trap.waitForEvent({ detailType: 'INVESTOR_PROFILE_CREATED', timeoutMs: 90_000 });
+  const accepted = await trap.waitForEvent({ detailType: 'MANDATE_ISSUED', timeoutMs: 90_000 });
```

`StateResetFixture` already deletes all SKs under a given pk (see `libs/integration-testing/src/fixtures/state-reset.fixture.ts:14-36`), so the reset cleans InvestorProfile + Mandate + Deposit# items together. Downstream tests still find the cognitoSub row because this test re-creates it from a clean slate.

## Why not extend the existing `attribute_not_exists` Put guard?

The `transactWrite` in `onboarding-completed.ts` already creates the row unconditionally (no `attribute_not_exists` condition expected — there's only one writer in production). Adding a condition would change production semantics for a test-only edge case. The right place to isolate retries is in the test.

## Why not disable `jest.retryTimes(1)` for this test?

The retry is load-bearing for other tests in the suite (it absorbs trap-empty-family flakes). Per-test retry overrides exist but introduce a maintenance burden — the row-reset fix is local and self-explanatory.
