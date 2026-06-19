# WS-1 — Authorizing Events Carry proposedTrades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make compliance-ctrl's `DECISION_APPROVED`/`DECISION_BLOCKED` and advisory-bff's `USER_CONFIRMED` events carry `proposedTrades` on their subject, so the execution domain can later read the real trades (today it hard-codes `proposedTrades: []`).

**Architecture:** Both events are CDC-emitted from a DynamoDB row via the typed-subject publisher (`changeDataCapture({schemas})`), which emits `schema.parse(row)`. So the carriage is: (1) add an OPTIONAL `proposedTrades` field to the row's zod subject schema, (2) write `proposedTrades` onto the row (the data is already reachable in both producers — no new GetItem/pipeline step), (3) the CDC publisher then emits it automatically. WS-1 carries the array **opaque** (`z.array(z.unknown())`); the typed `ProposedTradeSchema` parse happens at the consumer in WS-2.

**Tech Stack:** TypeScript, zod, AWS AppSync JS resolvers (`@aws-appsync/utils`), `@nestfolio/event-processor` CDC pipelines, Jest, Nx, AWS CDK.

## Global Constraints

- Services communicate via events only — never API calls. (No change here; WS-1 is producer-side only.)
- All Lambda handlers use event-processor pipelines (no raw handlers).
- Tests live in `test/` (services: `test/unit/` + `test/integration/`), NOT `src/__tests__/`.
- DRY domain subjects — identity (tenantId/userId/region) travels in the event **context** (RequestContext), NOT on the subject. `proposedTrades` is a genuine payload field, so it belongs ON the subject.
- Run all tasks through `pnpm nx`, never the underlying tool directly. Nx auto-loads repo-root `.env` (carries `AWS_PROFILE=nestfolio-dev`) — no prefix needed for `pnpm nx`; prefix raw `aws` calls with `AWS_PROFILE=nestfolio-dev`.
- `proposedTrades` is OPTIONAL on both schemas (`z.array(z.unknown()).optional()`): the inbound `RecommendationProposedSchema.proposedTrades` is always present but `DecisionReadModel.proposedTrades` is `.optional()` (minimal cycle-status builder omits it), and `DECISION_BLOCKED`/status-only emissions need not carry trades — making it required would risk a CDC `schema.parse` failure that drops the event. Optional also keeps every existing typed test fixture valid, so `tools/check-typed-fixtures.mjs` stays green with zero fixture edits.
- No new governed read-model rows are introduced (both `ComplianceCheck` and `UserConfirmation` already exist + are registered), so the `event-processor:read-model-drift` gate is unaffected.
- Out of scope (see backlog `advisory-authorizing-events-carry-proposed-trades.md`): execution-ctrl consumption / per-trade Order expansion (WS-2); broker SF + ORDER_FILLED (WS-3); ledger RecordFill (WS-4); operating-mode L1/L2 authority redesign; changing `RECOMMENDATION_PROPOSED` or the decision-packet contract.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `services/advisory/compliance-ctrl/src/domain/contracts.ts` | Modify (`ComplianceCheckSchema` ~L18-39 + comment ~L16) | Add `proposedTrades` to the DECISION_APPROVED/BLOCKED subject contract |
| `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` | Modify (`happySubject` ~L115-130) | Write the already-extracted `proposedTrades` (L85) onto the ComplianceCheck row |
| `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts` | Modify (the APPROVED test ~L164-204) | Assert `proposedTrades` lands on the ComplianceCheck intent |
| `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts` | Modify (~L37-70) | Assert `proposedTrades` round-trips onto the DECISION_APPROVED subject |
| `services/advisory/advisory-bff/src/domain/contracts.ts` | Modify (`UserConfirmationSchema` ~L70-76) | Add `proposedTrades` to the USER_CONFIRMED subject contract |
| `services/advisory/advisory-bff/src/graphql/js-function/confirm-decision.fn.js` | Modify (request fn) | Read `ctx.prev.result.proposedTrades`, stamp onto the UserConfirmation row |
| `services/advisory/advisory-bff/test/unit/graphql/mutation-region.test.ts` | Modify (or sibling) | Assert the resolver writes `proposedTrades` when present, omits when absent |
| `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` | Modify (~L516-603) | Assert `proposedTrades` on the UserConfirmation row + USER_CONFIRMED subject |

---

## Task 1: compliance-ctrl — DECISION_APPROVED/BLOCKED carries proposedTrades

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/domain/contracts.ts`
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Test: `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts`
- Test: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

**Interfaces:**
- Consumes: inbound `RecommendationProposedSchema` (`@nestfolio/decision-workflow-ctrl/contracts`), whose `proposedTrades: z.array(z.unknown())` is already parsed into the local `proposedTrades` variable at `event-listener.ts:85`.
- Produces: `ComplianceCheck` subject now includes `proposedTrades?: unknown[]` → CDC emits it on `DECISION_APPROVED` / `DECISION_BLOCKED`. (Consumed by execution-ctrl in WS-2.)

- [ ] **Step 1: Write the failing unit test.**

In `test/unit/event-listener.test.ts`, the existing APPROVED test (~L164) already drives `decisionPayload` (which carries `proposedTrades`). Add a new assertion test right after it:

```typescript
it('writes proposedTrades from RECOMMENDATION_PROPOSED onto the ComplianceCheck row', async () => {
  getMandateSnapshot.mockResolvedValue(mandate);
  evaluateSpy.mockReturnValue({ result: 'APPROVED', violations: [], authorityLevel: 'L1' });

  const harness = makeHarness();
  const result = await harness.process([
    fakeSqsRecord('RECOMMENDATION_PROPOSED', decisionPayload, { tenantId: 't-1' }),
  ]);

  expect(result.intents[0]).toMatchObject({
    _tag: 'record',
    typename: 'ComplianceCheck',
    fields: expect.objectContaining({
      proposedTrades: decisionPayload.proposedTrades,
    }),
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm nx test compliance-ctrl -- --testPathPatterns event-listener.test`
Expected: FAIL — the new test errors because `fields.proposedTrades` is `undefined` (the row does not yet carry it).

- [ ] **Step 3: Add `proposedTrades` to `ComplianceCheckSchema`.**

In `src/domain/contracts.ts`, update the comment (~L16) and add the field to `ComplianceCheckSchema` (after `authorityLevel`, before `sourceEventId`):

```typescript
  authorityLevel: z.enum(['L1', 'L2']),
  // Carried so the execution domain can create per-trade orders (WS-1 of the
  // order-execution money path). Opaque here — the typed ProposedTradeSchema
  // parse happens at the execution-ctrl consumer (WS-2). Optional: DECISION_BLOCKED
  // / fallback emissions need not carry trades.
  proposedTrades: z.array(z.unknown()).optional(),
  sourceEventId: z.string(),
```

- [ ] **Step 4: Write `proposedTrades` onto the ComplianceCheck row.**

In `src/handlers/event-listener.ts`, in the `happySubject: ComplianceCheck = { ... }` object literal (~L115), add the field (the local `proposedTrades` already exists from L85):

```typescript
    authorityLevel: output.authorityLevel,
    proposedTrades,
    sourceEventId: ctx.eventId,
```

- [ ] **Step 5: Run the unit test to verify it passes.**

Run: `pnpm nx test compliance-ctrl -- --testPathPatterns event-listener.test`
Expected: PASS (both the new test and the existing APPROVED/BLOCKED tests — the added field is additive).

- [ ] **Step 6: Add the integration round-trip assertion.**

In `test/integration/compliance-ctrl.integration.test.ts`, the existing test (~L37) already injects `RECOMMENDATION_PROPOSED` with `proposedTrades` and traps `DECISION_APPROVED|DECISION_BLOCKED`. Add an assertion after the existing `taskToken` check:

```typescript
  expect(subject['taskToken']).toBe(taskToken);
  // WS-1: proposedTrades must round-trip onto the DECISION_APPROVED/BLOCKED subject
  expect(Array.isArray(subject['proposedTrades'])).toBe(true);
  expect((subject['proposedTrades'] as unknown[]).length).toBeGreaterThan(0);
```

(Integration runs against deployed dev in Task 3 — do not run it locally here.)

- [ ] **Step 7: Run unit + lint for the affected project.**

Run: `pnpm nx run-many -t test,lint -p compliance-ctrl`
Expected: PASS (lint 0 errors; all unit suites green).

- [ ] **Step 8: Commit.**

```bash
git add services/advisory/compliance-ctrl/src/domain/contracts.ts \
        services/advisory/compliance-ctrl/src/handlers/event-listener.ts \
        services/advisory/compliance-ctrl/test/unit/event-listener.test.ts \
        services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
git commit --no-verify -m "feat(compliance-ctrl): carry proposedTrades on DECISION_APPROVED/BLOCKED (WS-1)"
```

(`--no-verify`: the worktree pre-commit hook can't run nx-affected — see `feedback-worktree-commit-no-verify`. Verify the commit landed with `git log --oneline -1`.)

---

## Task 2: advisory-bff — USER_CONFIRMED carries proposedTrades

**Files:**
- Modify: `services/advisory/advisory-bff/src/domain/contracts.ts`
- Modify: `services/advisory/advisory-bff/src/graphql/js-function/confirm-decision.fn.js`
- Test: `services/advisory/advisory-bff/test/unit/graphql/mutation-region.test.ts`
- Test: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`

**Interfaces:**
- Consumes: `ctx.prev.result` (the `DecisionReadModel` row, supplied by the `get-decision-readback.fn.js` pre-step), whose `proposedTrades?: unknown[]` is persisted by the decision-snapshot transform.
- Produces: `UserConfirmation` row + `UserConfirmationSchema` now include `proposedTrades?: unknown[]` → CDC emits it on `USER_CONFIRMED`. (Consumed by execution-ctrl in WS-2.)

- [ ] **Step 1: Write the failing unit test.**

In `test/unit/graphql/mutation-region.test.ts` (it already imports `confirmRequest` and a `stash` fixture), add:

```typescript
it('confirm-decision writes proposedTrades from the readback row onto the UserConfirmation row', () => {
  const op = confirmRequest({
    stash,
    arguments: { decisionId: 'decision-1' },
    prev: { result: { taskToken: 'tok-1', proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500_000 }] } },
  });
  expect(op.attributeValues.proposedTrades).toBeDefined();
});

it('confirm-decision omits proposedTrades when the readback row has none', () => {
  const op = confirmRequest({
    stash,
    arguments: { decisionId: 'decision-1' },
    prev: { result: {} },
  });
  expect(op.attributeValues.proposedTrades).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `pnpm nx test advisory-bff -- --testPathPatterns mutation-region`
Expected: FAIL — the first new test errors because `op.attributeValues.proposedTrades` is `undefined` (resolver does not yet copy it).

- [ ] **Step 3: Stamp `proposedTrades` in the resolver.**

In `src/graphql/js-function/confirm-decision.fn.js`, in the `request` function, read `proposedTrades` alongside the existing `taskToken` read, and conditionally add it (mirroring the `if (taskToken)` pattern) so it is omitted when absent:

```javascript
  const taskToken = ctx.prev?.result?.taskToken;
  const proposedTrades = ctx.prev?.result?.proposedTrades;
```

```javascript
  if (taskToken) {
    userConfirmationAttrs.taskToken = taskToken;
  }
  if (proposedTrades) {
    userConfirmationAttrs.proposedTrades = proposedTrades;
  }
```

- [ ] **Step 4: Add `proposedTrades` to `UserConfirmationSchema`.**

In `src/domain/contracts.ts`, add the field to `UserConfirmationSchema` (~L70):

```typescript
export const UserConfirmationSchema = z.object({
  decisionId: z.string(),
  confirmedAt: z.string(),
  confirmedBy: z.string(),
  timestamp: z.string(),
  taskToken: z.string().optional(),
  // Carried for the execution domain (WS-1 of the order-execution money path).
  // Opaque — typed parse at the execution-ctrl consumer (WS-2). Optional: the
  // DecisionReadModel readback row may omit it (minimal cycle-status builder).
  proposedTrades: z.array(z.unknown()).optional(),
});
```

- [ ] **Step 5: Run the unit test to verify it passes.**

Run: `pnpm nx test advisory-bff -- --testPathPatterns mutation-region`
Expected: PASS (both new tests + the existing region test).

- [ ] **Step 6: Add the integration assertions.**

In `test/integration/advisory-bff.integration.test.ts`, in the existing `confirmDecision writes the UserConfirmation intent row + re-emits USER_CONFIRMED` test (~L516, which already seeds the decision with `proposedTrades` and traps `USER_CONFIRMED`), add after the existing `taskToken` row assertion:

```typescript
  expect(confirmations[0]['taskToken']).toBe('tok-confirm');
  // WS-1: proposedTrades copied from the DecisionReadModel onto the UserConfirmation row
  expect(Array.isArray(confirmations[0]['proposedTrades'])).toBe(true);
```

And after the `USER_CONFIRMED` trap (`const event = await trap.waitForEvent(...)`):

```typescript
  expect(event.detailType).toBe('USER_CONFIRMED');
  // WS-1: proposedTrades flows out on the USER_CONFIRMED subject
  const ucSubject = (event.detail as Record<string, unknown>).subject as Record<string, unknown>;
  expect(Array.isArray(ucSubject['proposedTrades'])).toBe(true);
```

(Integration runs against deployed dev in Task 3.)

- [ ] **Step 7: Run unit + lint for the affected project.**

Run: `pnpm nx run-many -t test,lint -p advisory-bff`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add services/advisory/advisory-bff/src/domain/contracts.ts \
        services/advisory/advisory-bff/src/graphql/js-function/confirm-decision.fn.js \
        services/advisory/advisory-bff/test/unit/graphql/mutation-region.test.ts \
        services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts
git commit --no-verify -m "feat(advisory-bff): carry proposedTrades on USER_CONFIRMED (WS-1)"
```

(Verify the commit landed.)

---

## Task 3: Deploy + integration validation + service-card regen

**Files:**
- Modify (regen): `services/advisory/compliance-ctrl/CLAUDE.md`, `services/advisory/advisory-bff/CLAUDE.md` (only if `audit-service` reports drift from the contract change)

**Interfaces:** none (validation + docs).

- [ ] **Step 1: Verify the true-affected projects build green.**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
pnpm nx run-many -t test,lint -p "$AFFECTED"
```
Expected: PASS. (Confirms nothing else in the affected closure regressed from the two contract changes.)

- [ ] **Step 2: Deploy the two services to dev.**

Run:
```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=compliance-ctrl,advisory-bff 2>&1 | tee /tmp/ws1-deploy.log
```
Expected: both stacks `UPDATE_COMPLETE`. (Pre-authorized dev deploy.)

- [ ] **Step 3: Run the two integration suites against deployed dev.**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
pnpm nx run-many -t test-integration -p "$AFFECTED"
```
Expected: PASS — including the new `proposedTrades` round-trip assertions on `DECISION_APPROVED` (compliance-ctrl) and the `UserConfirmation` row + `USER_CONFIRMED` subject (advisory-bff). If a suite fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing (`feedback-flake-means-broken`).

- [ ] **Step 4: Regenerate service cards if drift is reported.**

The contract change (new `proposedTrades` field on `ComplianceCheckSchema` / `UserConfirmationSchema`) may drift the service cards' Contracts section. Run `audit-service compliance-ctrl` and `audit-service advisory-bff`; if either reports drift, regenerate + commit the card in this workstream (source + derived ship together).

- [ ] **Step 5: Commit any regen.**

```bash
git add services/advisory/compliance-ctrl/CLAUDE.md services/advisory/advisory-bff/CLAUDE.md
git commit --no-verify -m "docs(advisory): regen service cards for proposedTrades carriage (WS-1)"
```

(Skip if no drift. Then the workstream is ready for the `/backlog-next` closing phase: ship the backlog file with the deploy-log + integration evidence, then `finishing-a-development-branch`.)

---

## Self-Review

- **Spec coverage** (spec §4 hop 1 + §7 WS-1 + §8): ✅ DECISION_APPROVED carriage (Task 1), ✅ USER_CONFIRMED carriage (Task 2), ✅ "USER_CONFIRMED producer pin" resolved (the readback pre-step already supplies `proposedTrades`; no GetItem needed — Task 2 Step 3), ✅ "double-trigger guard" — out of WS-1 scope per backlog `out_of_scope` (WS-1 only adds the field; mutual-exclusion is unchanged), ✅ amount-denomination preserved (carried opaque; no quantity math here), ✅ typed-fixture gate (optional field → no fixture edits, gate green — Global Constraints).
- **Placeholder scan:** no TBD/TODO; every code step shows the exact diff.
- **Type consistency:** `proposedTrades: z.array(z.unknown()).optional()` used identically on both schemas; the resolver and handler both write `proposedTrades` verbatim; tests assert `Array.isArray(...)` / `toBeDefined()` (shape-agnostic, since the array is opaque at this layer).
