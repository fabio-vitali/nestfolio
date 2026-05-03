# InvestorProfile Single-Row Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `investor-bff`'s multi-row InvestorProfile decomposition (separate `Goal#${goalId}`, `RiskProfile`, `Mandate`, `OperatingModeRecord`, `AccountMode`, `InvestorProfile` rows) with a single composite `InvestorProfile` row per investor carrying nested groups; collapse 8 per-field events to 2 (`INVESTOR_PROFILE_CREATED`/`UPDATED`); rewire `decision-workflow-ctrl` to start Step Functions directly from EventBridge with `executionName` dedup (removing `WorkflowTrigger` row + `TriggerIngress` Lambda); add a separate `MandateStatus` row owning the mandate lifecycle (emitting `MANDATE_ACCEPTED`/`MANDATE_REVOKED`); complete the half-implemented `revokeMandate` flow.

**Architecture:** Nine-phase rollout. Phases 1-2 are the structural backbone (composite row write path + direct EB→SF). Phases 3-4 update consumers. Phase 5 closes the revoke gap with the `MandateStatus` sibling row. Phase 6 trims the cross-domain adapter forwarding rules. Phase 7 fixes the GraphQL surface + e2e tests. Phase 8 rotates docs + flow specs + service cards. Phase 9 is the hard cutover validation gate on dev (`feedback_no_deprecation.md` — dev is disposable, no migration code).

**Tech Stack:** TypeScript 5.x, Nx monorepo, AWS CDK 6-construct pattern (State, Ingress, Egress, Facade, AgentRuntime, Orchestration), AppSync JS Resolvers, DynamoDB Streams (CDC) → EventBridge, Step Functions (`executionName` dedup over redelivery/replay), Jest with `aws-sdk-client-mock` style mocks, `@nestfolio/event-processor` (materializeToTable + record/skip/project intents).

**Workstream conventions:**
- All commits go directly to `main` (no feature branch / PR ceremony).
- No `Co-Authored-By: Claude` attribution in commit messages.
- Phases 1-8 are local code + commits; safe to execute back-to-back.
- Phase 9 (deploy + truncate dev table + e2e validation gate) requires explicit user confirmation before destructive actions (`aws dynamodb delete-item` batch, deploy.sh).
- After every phase: run the verification command(s) listed under "Acceptance criteria" and STOP if any fail. Investigate root cause; do not bypass with `--skipTests` or similar.

**Spec reference:** `docs/superpowers/specs/2026-05-03-investor-profile-collapse-design.md` (commits `4d4c5679` + `b70f1996`).
**Deep-review reference:** `docs/superpowers/specs/2026-05-03-investor-profile-collapse-deep-review.md` (commit `6404b0b4`).

---

## Out of scope

Per CLAUDE.md backlog discipline. If any of these surface during execution, invoke `backlog-add` and continue:

- **Future audit-projection service** for entity-version history. Becomes its own workstream IF/WHEN regulatory or compliance need is articulated.
- **Future multi-goal product feature.** Would reintroduce a `Goal` collection with concrete requirements driving the schema.
- **The 147 stuck SF executions cleanup** (separate QUEUED entry — depends on Step 8/10 fix, not this collapse).
- **Account-state lifecycle redesign** (read-only / closed account states gated across execution-ctrl + broker-ctrl).
- **Production migration tooling.** Hard cutover applies to dev only. Production rollout is a separate workstream when/if production exists.
- **`MandateRevocation` row backwards-compat shim.** Drop it entirely; spec §3.3 says revocation is a clean slate.
- **`EditEvent` row reintroduction.** Drop from `update-goal.fn.js`, `update-mandate.fn.js`, `revoke-mandate.fn.js`. Reintroduce as separate workstream if a generic edit-log read model is requested.
- **Onboarding fan-out 3→1 as standalone fix** — naturally subsumed by Phase 1 (the composite row + Egress map collapse turns 3 distinct trigger events into 1 `INVESTOR_PROFILE_CREATED`).
- **`MANDATE_UPDATED` PARKING LOT entry as standalone fix** — naturally subsumed; mandate config edits emit `INVESTOR_PROFILE_UPDATED` via composite row CDC.
- **Re-acceptance flow** (REVOKED → ACCEPTED). Egress `MandateStatus` mapping is one-way (`modify: MANDATE_REVOKED`). YAGNI today; refactor when product asks.
- **Scoping of CashBalance and other non-profile rows** under InvestorProfile pk. Stay multi-row (different lifecycle).

---

## File Structure (what gets touched)

**Created:**
- `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` (replaced/rewritten — see Phase 2)
- No genuinely new source files; the collapse is pure simplification.

**Modified — `investor-bff` (Phase 1, 5):**
- `src/schema.graphql` — Goal/Mandate/RiskProfile/OperatingMode collapse to nested fields; `getGoals` removed; `updateGoal(input)` (no goalId)
- `src/domain/models.ts` — `InvestorProfile` interface gains nested `goal`, `riskProfile`, `mandate` fields; standalone `Goal`/`Mandate`/`RiskProfile` interfaces stay (used as nested types)
- `src/domain/events.ts` — drop GOAL_*/MANDATE_CREATED/MANDATE_UPDATED/RISK_PROFILE_*/OPERATING_MODE_SELECTED/OPERATING_MODE_CHANGED; add MANDATE_ACCEPTED
- `src/repositories/investor-profile.repository.ts` — rewrite setGoal/getGoals/updateGoal/grantMandate/setOperatingMode to operate on composite row; add `revokeMandateStatus()` for the sibling MandateStatus row
- `src/transforms/onboarding-completed.ts` — collapse from 7 entities to 3 (composite InvestorProfile + MandateStatus + conditional Deposit)
- `src/transforms/operating-mode-changed.ts` — write to composite row instead of OperatingModeRecord
- `src/graphql/js-function/get-profile.fn.js` — switch from GetItem to Query, return composite + MandateStatus merged
- `src/graphql/js-function/get-goals.fn.js` — DELETE (no longer needed)
- `src/graphql/js-function/update-goal.fn.js` — UpdateItem on composite InvestorProfile row, no `goalId`, drop `EditEvent` write
- `src/graphql/js-function/update-mandate.fn.js` — UpdateItem on composite InvestorProfile row (mandate.* nested fields), drop `EditEvent` write
- `src/graphql/js-function/revoke-mandate.fn.js` — single UpdateItem on MandateStatus row, drop MandateRevocation + EditEvent writes
- `src/service.stack.ts` — Egress eventTypes map: drop Goal/RiskProfile/Mandate/OperatingModeRecord shapes, add MandateStatus shape

**Modified — `decision-workflow-ctrl` (Phase 2):**
- `src/service.stack.ts` — Orchestration.triggers becomes 7-event list, drop TriggerIngress, drop WorkflowTrigger Egress mapping, set `executionName=$.id` on EB→SF rule
- `src/handlers/event-listener.ts` — DELETE (no more triggerHandler)
- `src/domain/events.ts` — drop TRIGGER_EVENT_TYPES + WORKFLOW_TRIGGER_CREATED/UPDATED
- `src/constructs/decision-state-machine.ts` — verify entry state UnpackTriggerEnvelope still flattens correctly (event.id at top level for executionName)

**Modified — `compliance-ctrl` (Phase 3):**
- `src/service.stack.ts` — Ingress subscriptions
- `src/handlers/event-listener.ts` — `processMandateEvent` resubscribes from `MANDATE_CREATED`/`UPDATED`/`OPERATING_MODE_CHANGED` to `INVESTOR_PROFILE_CREATED`/`UPDATED`; new `processMandateRevoked` handler for `MANDATE_REVOKED`
- `src/repositories/compliance.repository.ts` — verify `MandateSnapshot` schema accepts `status` field

**Modified — `dashboard-bff` (Phase 3):**
- `src/handlers/event-listener.ts` — drop GOAL_*/RISK_PROFILE_*/OPERATING_MODE_* subscriptions, add INVESTOR_PROFILE_CREATED/UPDATED
- `src/transforms/investor-snapshot.ts` — single branch reading composite `goal.objective`/`riskProfile.score`/`operatingMode`
- `src/service.stack.ts` — Ingress eventTypes list

**Modified — `investor-ctrl` (Phase 4):**
- `src/handlers/event-listener.ts` — subscriptions: drop MANDATE_CREATED/GOAL_UPDATED/OPERATING_MODE_CHANGED, add MANDATE_ACCEPTED/MANDATE_REVOKED/INVESTOR_PROFILE_UPDATED
- `src/services/notification-lifecycle.service.ts` — getNotificationContent map: drop MANDATE_CREATED, add MANDATE_ACCEPTED + MANDATE_REVOKED; new diff-detection branch for INVESTOR_PROFILE_UPDATED → fires Goal Updated / Operating Mode Changed via OldImage/NewImage compare
- `src/service.stack.ts` — Ingress eventTypes list

**Modified — `advisory-adpt` (Phase 6):**
- `src/service.stack.ts` — `fromInvestorEvents` array: drop 7 old events, add 4 new (INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ACCEPTED, MANDATE_REVOKED)
- `src/domain/events.ts` — `AdvisoryIngestEventTypes`: same swap

**Modified — Frontend + e2e (Phase 7):**
- `apps/e2e-feature-tests/src/profile/update-goal.e2e.test.ts` — rewrite GraphQL `getGoals` → `getProfile { goal { ... } }`; rewrite `updateGoal(goalId, input)` → `updateGoal(input)`
- `apps/e2e-feature-tests/src/profile/update-mandate.e2e.test.ts` — adapt to nested mandate
- `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts` — assert MandateStatus row + MANDATE_REVOKED event
- `apps/e2e-feature-tests/src/helpers/fixtures.ts` — `onboarded()` + `withDecision()` helpers updated for composite shape
- `apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts` — cosmetic step-label review (no data-binding migration)

**Modified — Tests (in lockstep with each phase):**

`investor-bff` (Phase 1 + Phase 5):
- `test/integration/investor-bff.integration.test.ts` (986 LOC) — full rewrite for composite shape (Task 1.9 + revoke re-enable Task 5.1)
- `test/unit/repositories/investor-profile.repository.test.ts` — method signatures rewritten (Task 1.5)
- `test/unit/transforms/onboarding-completed.test.ts` — rewrite TransactItems list assertions (Task 1.3)
- `test/unit/transforms/onboarding-completed-transform.test.ts` — race-regression coverage; reconcile to new shape (Task 1.10)
- `test/unit/transforms/operating-mode-changed.test.ts` — single composite UpdateItem assertion (Task 1.4)
- `test/unit/handlers/event-listener.test.ts` — verify no breakage from `createProfile` removal (Task 1.10 Step 1)
- `test/unit/handlers/broadcast-listener.test.ts` — verify untouched (Task 1.10 Step 1)
- `test/unit/transforms/{user-registered,balance-updated,notification-created}.test.ts` — verify untouched (Task 1.10 Step 1)
- `test/unit/domain/guardrail-params.test.ts` — verify untouched (Task 1.10 Step 1)
- `test/unit/graphql/publish-deposit-event.test.ts` — verify untouched (Task 1.10 Step 1)

`investor-bff` resolver tests (NEW — Tasks 1.10 + 5.x):
- Create `test/unit/graphql/get-profile.test.ts` (Task 1.10 Step 3)
- Create `test/unit/graphql/update-goal.test.ts` (Task 1.10 Step 4)
- Create `test/unit/graphql/update-mandate.test.ts` (Task 1.10 Step 5)
- Create `test/unit/graphql/revoke-mandate.test.ts` (Task 5.1 — see addendum below)

`decision-workflow-ctrl` (Phase 2):
- DELETE `test/unit/event-listener.test.ts` (Task 2.2)
- Rewrite `test/unit/service.stack.test.ts` for 7-event triggers + executionName + no TriggerIngress (Task 2.4)
- Rewrite `test/integration/decision-workflow-ctrl.integration.test.ts` (Task 2.5)

`compliance-ctrl` (Phase 3):
- Rewrite `test/unit/event-listener.test.ts` for INVESTOR_PROFILE_* + MANDATE_REVOKED (Task 3.1 Step 5)
- Append to `test/unit/mandate-validator.test.ts` — REVOKED gate cases (Task 3.3)
- Append to `test/unit/authority-resolver.test.ts` — REVOKED cases (Task 3.3)
- Append to `test/unit/rule-engine.test.ts` — end-to-end REVOKED flow (Task 3.3)
- Rewrite `test/integration/compliance-ctrl.integration.test.ts` (Task 3.4)

`dashboard-bff` (Phase 3):
- Rewrite `test/unit/handlers/event-listener.test.ts` — single INVESTOR_PROFILE_* branch (Task 3.2)
- Rewrite `test/unit/transforms/investor-snapshot.test.ts` — composite payload assertions (Task 3.2)

`investor-ctrl` (Phase 4):
- Rewrite `test/unit/event-listener.test.ts` + `test/unit/notification-lifecycle.service.test.ts` — diff-detection (Task 4.2 Step 5)
- Rewrite `test/integration/onboarding-notification.integration.test.ts` — MANDATE_ACCEPTED/REVOKED + INVESTOR_PROFILE_UPDATED diff scenarios (Task 4.3)

`advisory-adpt` (Phase 6):
- Rewrite `test/integration/from-investor.integration.test.ts` — assert new forwarded events (Task 6.1)
- Rewrite `test/service.stack.test.ts` — CDK assertion update (Task 6.1)

`apps/e2e-feature-tests` (Phase 7):
- Rewrite `src/profile/{update-goal,update-mandate,revoke-mandate}.e2e.test.ts` (Tasks 7.1-7.3)
- Rewrite `src/helpers/fixtures.ts` (Task 7.4)
- Rewrite `src/advisory/{operating-mode-authority,first-decision}.e2e.test.ts` (Task 7.6)
- Verify `src/advisory/{reconciliation-correction,accept-decision,reject-decision,rebalance-on-drift,view-decision-explanation}.e2e.test.ts` (Task 7.6 Step 4)
- Update `src/helpers/{agent-trace-trap,graphql-types,bff-client,wait-for-graphql}.ts` (Task 7.7)
- Final typecheck sweep across remaining e2e files: `src/{account,funding,notifications}/*.e2e.test.ts` (Task 7.8)

**Modified — Architecture docs (Phase 8):**
- `docs/architecture/SYSTEM-ARCHITECTURE.md` — §195 event-taxonomy table
- `docs/architecture/SERVICE-INVENTORY.md` — 6 service sections regenerated
- `flows/investor-onboarding.flow.yaml` — Phase 2a transactWrite items list, Phase 6 cross-domain forwards
- `flows/advisory-cycle.flow.yaml` — Phase 0 cross_domain list, Phase 1 receives list
- `flows/incident-escalation.flow.yaml` — line 84 comment update
- 6 service `CLAUDE.md` cards regenerated via `audit-service` skill

**Deleted:**
- `services/investor/investor-bff/src/graphql/js-function/get-goals.fn.js`
- `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts`
- `services/advisory/decision-workflow-ctrl/test/unit/event-listener.test.ts`

---

## Phase 1 — Composite InvestorProfile row + collapsed Egress

**Goal:** investor-bff writes a single composite row on onboarding (replacing 7 entities), Egress emits `INVESTOR_PROFILE_CREATED`/`UPDATED` only (replacing 8 per-field events). All AppSync resolvers and the schema are aligned. Unit + integration tests rewritten. `MandateStatus` row design is in place but only emits `MANDATE_ACCEPTED` (revocation logic comes in Phase 5).

### Task 1.1: Update `domain/events.ts` — drop per-field events, add MANDATE_ACCEPTED

**Files:**
- Modify: `services/investor/investor-bff/src/domain/events.ts`

- [ ] **Step 1: Replace InvestorBffEventTypes with the collapsed set**

Open `services/investor/investor-bff/src/domain/events.ts`. Replace the entire `InvestorBffEventTypes` object with:

```typescript
import { eventName } from '@nestfolio/event-types';

export const InvestorBffEventTypes = {
  USER_REGISTERED: eventName('USER_REGISTERED'),
  USER_AUTHENTICATED: eventName('USER_AUTHENTICATED'),
  USER_SESSION_EXPIRED: eventName('USER_SESSION_EXPIRED'),
  USER_DELETION_REQUESTED: eventName('USER_DELETION_REQUESTED'),
  PII_REMOVED: eventName('PII_REMOVED'),
  TENANT_ANONYMIZED: eventName('TENANT_ANONYMIZED'),
  ONBOARDING_ANSWER_RECORDED: eventName('ONBOARDING_ANSWER_RECORDED'),
  ONBOARDING_COMPLETED: eventName('ONBOARDING_COMPLETED'),
  INVESTOR_PROFILE_CREATED: eventName('INVESTOR_PROFILE_CREATED'),
  INVESTOR_PROFILE_UPDATED: eventName('INVESTOR_PROFILE_UPDATED'),
  MANDATE_ACCEPTED: eventName('MANDATE_ACCEPTED'),
  MANDATE_REVOKED: eventName('MANDATE_REVOKED'),
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
  DEPOSIT_UPDATED: eventName('DEPOSIT_UPDATED'),
  WITHDRAWAL_REQUESTED: eventName('WITHDRAWAL_REQUESTED'),
  WITHDRAWAL_UPDATED: eventName('WITHDRAWAL_UPDATED'),
  ACCOUNT_CLOSURE_REQUESTED: eventName('ACCOUNT_CLOSURE_REQUESTED'),
  ACCOUNT_CLOSED: eventName('ACCOUNT_CLOSED'),
  BROKER_AUTHORIZATION_REVOKED: eventName('BROKER_AUTHORIZATION_REVOKED'),
  NOTIFICATION_READ: eventName('NOTIFICATION_READ'),
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
  EXECUTION_MODE_CHANGE_UPDATED: eventName('EXECUTION_MODE_CHANGE_UPDATED'),
  GO_LIVE_CONFIRMED: eventName('GO_LIVE_CONFIRMED'),
  BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
  BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
} as const;
```

Removed: `GOAL_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_CREATED`, `RISK_PROFILE_UPDATED`, `MANDATE_CREATED`, `MANDATE_UPDATED`, `OPERATING_MODE_SELECTED`, `OPERATING_MODE_CHANGED`. Added: `MANDATE_ACCEPTED`.

- [ ] **Step 2: Run TypeScript build to surface every consumer**

Run: `pnpm nx build investor-bff`
Expected: FAIL with errors at every site referencing dropped event names. This is the workboard for the rest of Phase 1.

- [ ] **Step 3: Commit the events change in isolation**

```bash
git add services/investor/investor-bff/src/domain/events.ts
git commit -m "investor-bff: collapse per-field events to INVESTOR_PROFILE_*; add MANDATE_ACCEPTED"
```

### Task 1.2: Update domain models for composite shape

**Files:**
- Modify: `services/investor/investor-bff/src/domain/models.ts`

- [ ] **Step 1: Update `InvestorProfile` interface to nest goal/mandate/riskProfile**

Replace the `InvestorProfile` interface in `services/investor/investor-bff/src/domain/models.ts` with:

```typescript
export interface AccountMode {
  readonly mode: 'simulation' | 'live';
  readonly capitalAmount: number;
  readonly currency: string;
}

export interface InvestorProfile {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
  readonly operatingMode: OperatingMode;
  readonly executionMode: ExecutionMode;
  readonly accountMode: AccountMode;
  readonly goal: Goal;
  readonly riskProfile: RiskProfile;
  readonly mandate: Mandate;
  readonly onboardingCompletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MandateStatus {
  readonly tenantId: string;
  readonly userId: string;
  readonly status: 'ACCEPTED' | 'REVOKED';
  readonly acceptedAt: string;
  readonly revokedAt: string | null;
  readonly region: string;
}
```

Drop the `monthlyContributionCents`, `currency`, `name`, `age`, `locale` fields from `InvestorProfile` (none are used by code; legacy `createProfile()` ghost defaults). Drop `goals: ReadonlyArray<Goal>` (composite singular `goal`). Drop `mandate: Mandate | null` (always present after onboarding; set in transactWrite).

- [ ] **Step 2: Drop `version`, `assessedAt`, `effectiveDate` defaults from `Mandate`/`RiskProfile`**

In the same file, simplify:

```typescript
export interface RiskProfile {
  readonly score: number;
  readonly band: { readonly minEquity: number; readonly maxEquity: number };
  readonly toleranceResponse: 'cautious' | 'neutral' | 'bold';
  readonly experienceLevel: 'beginner' | 'intermediate' | 'expert';
}

export interface Mandate {
  readonly mandateId: string;
  readonly level: MandateLevel;
  readonly monthlyTurnoverCapPercent: number;
  readonly maxSingleTradePercent: number;
  readonly equityRiskBandPercent: number;
  readonly driftTriggerPercent: number;
  readonly singleEtfConcentrationPercent: number;
  readonly drawdownCircuitBreakerPercent: number;
  readonly rebalanceCadence: RebalanceCadence;
  readonly effectiveDate: string;
  readonly revokedAt: string | null;
  readonly status: 'ACTIVE' | 'REVOKED';
}

export interface Goal {
  readonly objective: string;
  readonly targetAmountCents: number;
  readonly currency: string;
  readonly timeHorizonMonths: number;
  readonly targetReturn: number;
}
```

Removed: `goalId` from `Goal` (singular), `tenantId` from `Mandate` (carried at composite level), `version` from `Mandate` + `RiskProfile` (set-once-never-incremented dead scaffolding per spec §2), `profileId/tenantId/assessedAt` from `RiskProfile`, `coolDownDays` from `Mandate` (replaced by 8-field guardrail set already used by `compliance-ctrl`). KEPT on `Mandate`: `mandateId` (per spec §3.2 payload shape) — useful for downstream correlation.

- [ ] **Step 3: Run typecheck**

Run: `pnpm nx run investor-bff:lint && pnpm nx run investor-bff:build 2>&1 | head -50`
Expected: errors at consumer sites; no model errors.

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-bff/src/domain/models.ts
git commit -m "investor-bff: collapse domain models to nested composite shape"
```

### Task 1.3: Rewrite `onboarding-completed.ts` transform — 7 entities → 3

**Files:**
- Modify: `services/investor/investor-bff/src/transforms/onboarding-completed.ts`

- [ ] **Step 1: Write the failing transform unit test**

Open `services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts` and replace its contents with:

```typescript
import { onboardingCompleted } from '../../../src/transforms/onboarding-completed';
import { InvestorProfileRepository } from '../../../src/repositories/investor-profile.repository';

jest.mock('../../../src/repositories/investor-profile.repository');

describe('onboardingCompleted transform', () => {
  const baseSubject = {
    tenantId: 't1',
    userId: 'u1',
    email: 'u1@example.com',
    goal: { objective: 'RETIREMENT' },
    horizonYears: 20,
    accountMode: 'simulation',
    capitalAmount: 100000,
    currency: 'EUR',
    riskTolerance: 3,
    riskExperience: 2,
    operatingMode: 'BALANCED',
    mandateAccepted: true as const,
  };
  const ctx = { region: 'us-east-1', tenantId: 't1', userId: 'u1', eventId: 'e1', eventType: 'ONBOARDING_COMPLETED', timestamp: '2026-05-03T00:00:00Z' };

  beforeEach(() => {
    (InvestorProfileRepository as jest.MockedClass<typeof InvestorProfileRepository>).prototype.transactWrite = jest.fn().mockResolvedValue(undefined);
    process.env.TABLE_NAME = 'test-table';
  });

  it('writes InvestorProfile composite row with nested goal, riskProfile, mandate', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    const profileItem = call.TransactItems[0].Put.Item;
    expect(profileItem.sk).toBe('InvestorProfile');
    expect(profileItem.__typename).toBe('InvestorProfile');
    expect(profileItem.goal).toMatchObject({ objective: 'RETIREMENT', timeHorizonMonths: 240, currency: 'EUR' });
    expect(profileItem.riskProfile).toMatchObject({ score: expect.any(Number), band: expect.any(Object) });
    expect(profileItem.mandate).toMatchObject({ level: expect.any(String), status: 'ACTIVE' });
    expect(profileItem.accountMode).toMatchObject({ mode: 'simulation', capitalAmount: 100000, currency: 'EUR' });
    expect(profileItem.operatingMode).toBe('BALANCED');
  });

  it('writes MandateStatus sibling row with status=ACCEPTED', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    const statusItem = call.TransactItems[1].Put.Item;
    expect(statusItem.sk).toBe('MandateStatus');
    expect(statusItem.__typename).toBe('MandateStatus');
    expect(statusItem.status).toBe('ACCEPTED');
    expect(statusItem.acceptedAt).toBeTruthy();
    expect(statusItem.revokedAt).toBeNull();
  });

  it('appends Deposit row when capitalAmount > 0', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems).toHaveLength(3);
    expect(call.TransactItems[2].Put.Item.__typename).toBe('Deposit');
  });

  it('omits Deposit row when capitalAmount === 0', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, capitalAmount: 0 } } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems).toHaveLength(2);
  });

  it('e2e tenants get ADVISORY mandate level by default', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, tenantId: 'e2e-t1' } } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems[0].Put.Item.mandate.level).toBe('ADVISORY');
  });

  it('production tenants get DISCRETIONARY mandate level by default', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems[0].Put.Item.mandate.level).toBe('DISCRETIONARY');
  });

  it('mandateLevel override on payload wins over default', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, tenantId: 'e2e-t1', mandateLevel: 'DISCRETIONARY' } } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems[0].Put.Item.mandate.level).toBe('DISCRETIONARY');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `pnpm nx test investor-bff -- --testPathPattern=onboarding-completed`
Expected: FAIL — current transform writes 7 separate entities; tests expect 3.

- [ ] **Step 3: Rewrite the transform**

Replace `services/investor/investor-bff/src/transforms/onboarding-completed.ts` with:

```typescript
import { skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { computeRiskProfile } from '../domain/risk-profile.service';
import { resolveGuardrailParams } from '../domain/guardrail-params';

interface OnboardingCompletedSubject {
  tenantId: string;
  userId: string;
  email: string;
  goal: { objective: string };
  horizonYears: number;
  accountMode: 'simulation' | 'live';
  capitalAmount: number;
  currency: string;
  riskTolerance: number;
  riskExperience: number;
  operatingMode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  mandateLevel?: 'ADVISORY' | 'DISCRETIONARY';
  mandateAccepted: true;
}

export async function onboardingCompleted(
  payload: EventPayload,
  ctx: EventContext,
): Promise<WriteIntent> {
  const s = payload.subject as unknown as OnboardingCompletedSubject;
  const tableName = process.env['TABLE_NAME']!;
  const repo = new InvestorProfileRepository(tableName);
  const now = getTime();
  const pk = `InvestorProfile#${s.tenantId}#${s.userId}`;
  const risk = computeRiskProfile(s.riskTolerance, s.riskExperience);
  const mandateId = getUUID();
  const depositId = getUUID();
  const mandateLevel =
    s.mandateLevel ?? (s.tenantId.startsWith('e2e-') ? 'ADVISORY' : 'DISCRETIONARY');
  const guardrails = resolveGuardrailParams(s.operatingMode);

  await repo.transactWrite({
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: {
            pk,
            sk: 'InvestorProfile',
            __typename: 'InvestorProfile',
            tenantId: s.tenantId,
            userId: s.userId,
            region: ctx.region,
            email: s.email,
            operatingMode: s.operatingMode,
            executionMode: 'simulation',
            accountMode: { mode: s.accountMode, capitalAmount: s.capitalAmount, currency: s.currency },
            goal: {
              objective: s.goal.objective,
              timeHorizonMonths: s.horizonYears * 12,
              targetAmountCents: 0,
              currency: s.currency,
              targetReturn: 0,
            },
            riskProfile: {
              score: risk.score,
              band: risk.band,
              toleranceResponse: risk.tolerance,
              experienceLevel: risk.experienceLevel,
            },
            mandate: {
              mandateId,
              level: mandateLevel,
              monthlyTurnoverCapPercent: guardrails.monthlyTurnoverCapPercent,
              maxSingleTradePercent: guardrails.maxSingleTradePercent,
              equityRiskBandPercent: guardrails.equityRiskBandPercent,
              driftTriggerPercent: guardrails.driftTriggerPercent,
              singleEtfConcentrationPercent: guardrails.singleEtfConcentrationPercent,
              drawdownCircuitBreakerPercent: guardrails.drawdownCircuitBreakerPercent,
              rebalanceCadence: guardrails.rebalanceCadence,
              effectiveDate: now,
              revokedAt: null,
              status: 'ACTIVE',
            },
            onboardingCompletedAt: now,
            createdAt: now,
            updatedAt: now,
            timestamp: now,
          } satisfies TableEntry,
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            pk,
            sk: 'MandateStatus',
            __typename: 'MandateStatus',
            tenantId: s.tenantId,
            userId: s.userId,
            region: ctx.region,
            status: 'ACCEPTED',
            acceptedAt: now,
            revokedAt: null,
            createdAt: now,
            updatedAt: now,
            timestamp: now,
          } satisfies TableEntry,
        },
      },
      ...(s.capitalAmount > 0
        ? [
            {
              Put: {
                TableName: tableName,
                Item: {
                  pk,
                  sk: `Deposit#${depositId}`,
                  __typename: 'Deposit',
                  tenantId: s.tenantId,
                  userId: s.userId,
                  region: ctx.region,
                  createdAt: now,
                  depositId,
                  amountCents: s.capitalAmount,
                  currency: s.currency,
                  status: 'INITIATED',
                  initiatedAt: now,
                  timestamp: now,
                } satisfies TableEntry,
              },
            },
          ]
        : []),
    ],
  });

  return skip();
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm nx test investor-bff -- --testPathPattern=onboarding-completed`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/transforms/onboarding-completed.ts services/investor/investor-bff/test/unit/transforms/onboarding-completed.test.ts
git commit -m "investor-bff: collapse onboarding transform to composite InvestorProfile + MandateStatus"
```

### Task 1.4: Rewrite `operating-mode-changed.ts` transform

**Files:**
- Modify: `services/investor/investor-bff/src/transforms/operating-mode-changed.ts`

- [ ] **Step 1: Read the current implementation**

Run: `cat services/investor/investor-bff/src/transforms/operating-mode-changed.ts`
Note the current pattern: writes both an `OperatingModeRecord` row AND updates the `InvestorProfile` row.

- [ ] **Step 2: Rewrite to update composite InvestorProfile only**

Replace the file with:

```typescript
import { type WriteIntent, type EventPayload, type EventContext, project } from '@nestfolio/event-processor';
import { getTime } from '@nestfolio/event-processor';

interface OperatingModeChangedSubject {
  tenantId: string;
  userId: string;
  mode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
}

export function operatingModeChanged(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const s = payload.subject as unknown as OperatingModeChangedSubject;
  const tenantId = s.tenantId ?? ctx.tenantId;
  const userId = s.userId ?? ctx.userId;
  const now = getTime();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  return project(
    'InvestorProfile',
    {
      tenantId,
      userId,
      operatingMode: s.mode,
      updatedAt: now,
      timestamp: now,
    },
    { pk, sk: 'InvestorProfile' },
  );
}
```

Note: this no longer writes a separate `OperatingModeRecord` — the lifecycle is captured via `INVESTOR_PROFILE_UPDATED` CDC. Mandate guardrails are NOT auto-recomputed here because the spec settled that operating-mode-driven guardrail re-tuning is a separate workstream (file via `backlog-add` if surfaced).

- [ ] **Step 3: Update the unit test**

Open `services/investor/investor-bff/test/unit/transforms/operating-mode-changed.test.ts`. Replace any "writes 2 items" assertions with single-item composite-row update assertions:

```typescript
import { operatingModeChanged } from '../../../src/transforms/operating-mode-changed';

describe('operatingModeChanged transform', () => {
  it('emits a single project intent on the composite InvestorProfile row', () => {
    const intent = operatingModeChanged(
      { subject: { tenantId: 't1', userId: 'u1', mode: 'AGGRESSIVE' } } as any,
      { tenantId: 't1', userId: 'u1', region: 'us-east-1', eventId: 'e1', eventType: 'OPERATING_MODE_CHANGED', timestamp: 'now' } as any,
    );
    expect(intent).toMatchObject({
      type: 'project',
      __typename: 'InvestorProfile',
      key: { pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' },
      attributes: expect.objectContaining({ operatingMode: 'AGGRESSIVE' }),
    });
  });
});
```

(Adapt the `expect.objectContaining` assertion to whatever shape `project()` returns in your event-processor version — run the existing test once to see.)

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm nx test investor-bff -- --testPathPattern=operating-mode-changed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/transforms/operating-mode-changed.ts services/investor/investor-bff/test/unit/transforms/operating-mode-changed.test.ts
git commit -m "investor-bff: operating-mode-changed updates composite InvestorProfile only"
```

### Task 1.5: Rewrite `investor-profile.repository.ts` — composite row methods

**Files:**
- Modify: `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`
- Modify: `services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts`

- [ ] **Step 1: Write failing tests for the new method shapes**

Open `services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts`. Update the `describe` blocks for `setGoal`, `getGoals`, `updateGoal`, `grantMandate`, `revokeMandate`, `setOperatingMode` to assert composite-row writes. Replace the file's `setGoal` tests with:

```typescript
describe('setGoal (composite row)', () => {
  it('updates the InvestorProfile.goal nested attribute', async () => {
    const repo = new InvestorProfileRepository('test-table', mockClient);
    await repo.setGoal({ tenantId: 't1', userId: 'u1', region: 'us-east-1' }, {
      objective: 'GROWTH',
      targetAmountCents: 500000,
      currency: 'EUR',
      timeHorizonMonths: 60,
      targetReturn: 0.07,
    });
    const call = updateCommandSpy.mock.calls[0][0];
    expect(call.input.Key).toEqual({ pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' });
    expect(call.input.UpdateExpression).toContain('goal = :goal');
  });
});
```

Replace `getGoals` tests with a single `getProfile` test that asserts the composite read (via Query, returning the InvestorProfile + MandateStatus item collection). DELETE the `getGoals` describe block — the method is removed.

- [ ] **Step 2: Run tests — expect failure**

Run: `pnpm nx test investor-bff -- --testPathPattern=investor-profile.repository`
Expected: FAIL — current `setGoal` writes a separate `Goal#${goalId}` row.

- [ ] **Step 3: Rewrite the repository**

Open `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`. Make these changes:

(a) Drop `createProfile` (USER_REGISTERED no longer creates a placeholder profile — onboarding is the single writer).

(b) Replace `getProfile` with a Query returning composite + MandateStatus:

```typescript
readonly getProfile = this.log('getProfile',
  async (tenantId: string, userId: string): Promise<{ profile: Record<string, unknown>; mandateStatus: Record<string, unknown> | null }> => {
    const pk = profilePk(tenantId, userId);
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk IN (:profileSk, :statusSk)',
        ExpressionAttributeValues: { ':pk': pk, ':profileSk': 'InvestorProfile', ':statusSk': 'MandateStatus' },
      }),
    );
    const items = result.Items ?? [];
    const profile = items.find((i) => i.sk === 'InvestorProfile');
    const mandateStatus = items.find((i) => i.sk === 'MandateStatus') ?? null;
    if (!profile) {
      throw new EntityNotFoundError('InvestorProfile', `${tenantId}#${userId}`);
    }
    return { profile, mandateStatus };
  },
);
```

(Note: DynamoDB `KeyConditionExpression` does not support `IN` for sk — split into two GetItems via BatchGet, or just do two GetItems in parallel. Use BatchGet:)

```typescript
readonly getProfile = this.log('getProfile',
  async (tenantId: string, userId: string): Promise<{ profile: Record<string, unknown>; mandateStatus: Record<string, unknown> | null }> => {
    const pk = profilePk(tenantId, userId);
    const result = await this.docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: [
              { pk, sk: 'InvestorProfile' },
              { pk, sk: 'MandateStatus' },
            ],
          },
        },
      }),
    );
    const items = result.Responses?.[this.tableName] ?? [];
    const profile = items.find((i) => i.sk === 'InvestorProfile');
    const mandateStatus = items.find((i) => i.sk === 'MandateStatus') ?? null;
    if (!profile) {
      throw new EntityNotFoundError('InvestorProfile', `${tenantId}#${userId}`);
    }
    return { profile, mandateStatus };
  },
);
```

Add `BatchGetCommand` to the imports from `@aws-sdk/lib-dynamodb`.

(c) Replace `setGoal` to update the composite nested `goal` attribute:

```typescript
readonly setGoal = this.log('setGoal',
  async (
    ctx: RequestContext,
    goal: {
      objective: string;
      targetAmountCents: number;
      currency: string;
      timeHorizonMonths: number;
      targetReturn: number;
    },
  ): Promise<Goal> => {
    validateGoalFields(goal);
    const pk = profilePk(ctx.tenantId, ctx.userId);
    const now = getTime();
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'InvestorProfile' },
        UpdateExpression: 'SET goal = :goal, updatedAt = :now, #ts = :ts',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':goal': goal, ':now': now, ':ts': now },
        ConditionExpression: 'attribute_exists(pk)',
      }),
    );
    return goal as unknown as Goal;
  },
);
```

(d) Drop `getGoals` entirely (caller `get-goals.fn.js` is being deleted in Task 1.7).

(e) Replace `updateGoal(tenantId, userId, goalId, updates)` with `updateGoal(ctx, updates)` (no goalId — there's only one nested goal):

```typescript
readonly updateGoal = this.log('updateGoal',
  async (
    ctx: RequestContext,
    updates: Partial<{
      objective: string;
      targetAmountCents: number;
      currency: string;
      timeHorizonMonths: number;
      targetReturn: number;
    }>,
  ): Promise<Goal> => {
    validateGoalFields(updates);
    const pk = profilePk(ctx.tenantId, ctx.userId);
    const now = getTime();
    const setExprs: string[] = ['updatedAt = :now', '#ts = :ts'];
    const exprNames: Record<string, string> = { '#ts': 'timestamp' };
    const exprValues: Record<string, unknown> = { ':now': now, ':ts': now };
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      setExprs.push(`goal.#${k} = :${k}`);
      exprNames[`#${k}`] = k;
      exprValues[`:${k}`] = v;
    }
    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'InvestorProfile' },
        UpdateExpression: `SET ${setExprs.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ConditionExpression: 'attribute_exists(pk)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    if (!result.Attributes) {
      throw new EntityNotFoundError('Goal', `${ctx.tenantId}#${ctx.userId}`);
    }
    return result.Attributes.goal as unknown as Goal;
  },
);
```

(f) Replace `grantMandate` with composite update:

```typescript
readonly grantMandate = this.log('grantMandate',
  async (
    ctx: RequestContext,
    mandate: {
      level: MandateLevel;
      monthlyTurnoverCapPercent: number;
      maxSingleTradePercent: number;
      rebalanceCadence: RebalanceCadence;
    },
  ): Promise<Mandate> => {
    if (mandate.monthlyTurnoverCapPercent < 0 || mandate.monthlyTurnoverCapPercent > 100) {
      throw new NotRetryableError('monthlyTurnoverCapPercent must be between 0 and 100');
    }
    if (mandate.maxSingleTradePercent < 0 || mandate.maxSingleTradePercent > 100) {
      throw new NotRetryableError('maxSingleTradePercent must be between 0 and 100');
    }
    const pk = profilePk(ctx.tenantId, ctx.userId);
    const now = getTime();
    const setExprs: string[] = ['updatedAt = :now', '#ts = :ts'];
    const exprNames: Record<string, string> = { '#ts': 'timestamp' };
    const exprValues: Record<string, unknown> = { ':now': now, ':ts': now };
    for (const [k, v] of Object.entries(mandate)) {
      setExprs.push(`mandate.#${k} = :${k}`);
      exprNames[`#${k}`] = k;
      exprValues[`:${k}`] = v;
    }
    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'InvestorProfile' },
        UpdateExpression: `SET ${setExprs.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ConditionExpression: 'attribute_exists(pk)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    if (!result.Attributes) throw new EntityNotFoundError('Mandate', `${ctx.tenantId}#${ctx.userId}`);
    return result.Attributes.mandate as unknown as Mandate;
  },
);
```

(g) Drop `revokeMandate` from the repository entirely. The new revocation flow goes through `revoke-mandate.fn.js` (AppSync JS Resolver) writing directly to the `MandateStatus` row — no Lambda repository method needed. (Phase 5 will wire this end-to-end.)

(h) Replace `setOperatingMode` with a single UpdateItem on the composite row (matches what `operating-mode-changed.ts` transform now does):

```typescript
readonly setOperatingMode = this.log('setOperatingMode',
  async (ctx: RequestContext, mode: OperatingMode): Promise<{ mode: OperatingMode }> => {
    const pk = profilePk(ctx.tenantId, ctx.userId);
    const now = getTime();
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: 'InvestorProfile' },
        UpdateExpression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :ts',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':mode': mode, ':now': now, ':ts': now },
        ConditionExpression: 'attribute_exists(pk)',
      }),
    );
    return { mode };
  },
);
```

(i) Drop `setRiskProfile` (RiskProfile is set once during onboarding inside the composite row; no standalone "set risk" flow exists — verify with `grep -r "setRiskProfile" services/investor/investor-bff/src/` returns no callers besides onboarding which now writes inline).

- [ ] **Step 4: Run tests — expect pass**

Run: `pnpm nx test investor-bff -- --testPathPattern=investor-profile.repository`
Expected: PASS.

- [ ] **Step 5: Run typecheck on the whole service**

Run: `pnpm nx build investor-bff 2>&1 | tail -30`
Expected: errors at remaining `*.fn.js` resolver consumers + integration test (next tasks).

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/src/repositories/investor-profile.repository.ts services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts
git commit -m "investor-bff: rewrite repository for composite InvestorProfile + BatchGet getProfile"
```

### Task 1.6: Update GraphQL schema (`schema.graphql`)

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql`

- [ ] **Step 1: Replace types/queries/mutations to match composite shape**

Open `services/investor/investor-bff/src/schema.graphql` and replace lines 1-210 (the whole content above `# --- Deposit event` block) with:

```graphql
type Query {
  getProfile: InvestorProfile!
  getNotifications(limit: Int, cursor: String): NotificationConnection!
  getUnreadCount: Int!
  getFeatureFlags: [FeatureFlag!]!
}

type Mutation {
  updateGoal(input: GoalInput!): Goal!
  updateMandate(input: MandateInput!): Mandate!
  revokeMandate: MandateStatus!
  initiateDeposit(input: DepositInput!): DepositIntent!
  requestWithdrawal(input: WithdrawalInput!): WithdrawalRequest!
  requestAccountClosure: ClosureRequest!
  markNotificationRead(notificationId: ID!): Notification!
  updateFeatureFlag(name: String!, enabled: Boolean!, reason: String): FeatureFlag!
    @aws_iam
  publishDepositEvent(input: DepositEventInput!): DepositEvent!
    @aws_iam
}

type Subscription {
  onNotification: Notification!
    @aws_subscribe(mutations: ["markNotificationRead"])
  onFeatureFlagUpdate: FeatureFlag
    @aws_subscribe(mutations: ["updateFeatureFlag"])
  onDepositEvent(depositId: ID!): DepositEvent
    @aws_subscribe(mutations: ["publishDepositEvent"])
}

type FeatureFlag @aws_cognito_user_pools @aws_iam {
  name: String!
  enabled: Boolean!
  reason: String
}

# --- Enums ---

enum OperatingMode {
  CONSERVATIVE
  BALANCED
  AGGRESSIVE
}

enum MandateLevel {
  ADVISORY
  DISCRETIONARY
}

enum MandateStatusValue {
  ACTIVE
  REVOKED
}

enum RebalanceCadence {
  WEEKLY
  BI_WEEKLY
  MONTHLY
  QUARTERLY
}

enum NotificationChannel {
  PUSH
  EMAIL
  SMS
  IN_APP
}

enum NotificationStatus {
  CREATED
  SENT
  DELIVERED
  READ
}

# --- Types (composite shape) ---

type AccountMode {
  mode: String!
  capitalAmount: Int!
  currency: String!
}

type Goal {
  objective: String!
  targetAmountCents: Int!
  currency: String!
  timeHorizonMonths: Int!
  targetReturn: Float!
}

type RiskProfile {
  score: Int!
  band: RiskBand!
  toleranceResponse: String!
  experienceLevel: String!
}

type RiskBand {
  minEquity: Float!
  maxEquity: Float!
}

type Mandate {
  mandateId: ID!
  level: MandateLevel!
  status: MandateStatusValue!
  monthlyTurnoverCapPercent: Float!
  maxSingleTradePercent: Float!
  equityRiskBandPercent: Float!
  driftTriggerPercent: Float!
  singleEtfConcentrationPercent: Float!
  drawdownCircuitBreakerPercent: Float!
  rebalanceCadence: RebalanceCadence!
  effectiveDate: String!
  revokedAt: String
}

type MandateStatus {
  status: MandateStatusValue!
  acceptedAt: String!
  revokedAt: String
}

type InvestorProfile {
  tenantId: ID!
  userId: String!
  email: String!
  operatingMode: OperatingMode!
  accountMode: AccountMode!
  goal: Goal!
  riskProfile: RiskProfile!
  mandate: Mandate!
  onboardingCompletedAt: String
  createdAt: String!
  updatedAt: String!
}

type DepositIntent {
  depositId: ID!
  amountCents: Int!
  currency: String!
  status: String!
  initiatedAt: String!
}

type WithdrawalRequest {
  withdrawalId: ID!
  amountCents: Int!
  currency: String!
  status: String!
  requestedAt: String!
}

type ClosureRequest {
  closureId: ID!
  status: String!
  requestedAt: String!
}

type Notification {
  notificationId: ID!
  tenantId: ID!
  channel: NotificationChannel!
  title: String!
  body: String!
  status: NotificationStatus!
  relatedEntityType: String!
  relatedEntityId: String!
  createdAt: String!
  sentAt: String
  deliveredAt: String
  readAt: String
}

type NotificationConnection {
  items: [Notification!]!
  nextCursor: String
}

# --- Inputs ---

input GoalInput {
  objective: String
  targetAmountCents: Int
  currency: String
  timeHorizonMonths: Int
  targetReturn: Float
}

input MandateInput {
  level: MandateLevel
  monthlyTurnoverCapPercent: Float
  maxSingleTradePercent: Float
  equityRiskBandPercent: Float
  driftTriggerPercent: Float
  singleEtfConcentrationPercent: Float
  drawdownCircuitBreakerPercent: Float
  rebalanceCadence: RebalanceCadence
}

input DepositInput {
  amountCents: Int!
  currency: String!
}

input WithdrawalInput {
  amountCents: Int!
  currency: String!
}
```

Keep the `# --- Deposit event ...` block at the bottom unchanged.

- [ ] **Step 2: Commit the schema**

```bash
git add services/investor/investor-bff/src/schema.graphql
git commit -m "investor-bff: collapse GraphQL schema to nested composite InvestorProfile"
```

### Task 1.7: Rewrite AppSync JS resolvers

**Files:**
- Delete: `services/investor/investor-bff/src/graphql/js-function/get-goals.fn.js`
- Modify: `services/investor/investor-bff/src/graphql/js-function/get-profile.fn.js`
- Modify: `services/investor/investor-bff/src/graphql/js-function/update-goal.fn.js`
- Modify: `services/investor/investor-bff/src/graphql/js-function/update-mandate.fn.js`

(`revoke-mandate.fn.js` is rewritten in Phase 5 because it depends on the `MandateStatus` row Egress mapping; for now leave it alone — it's already half-broken.)

- [ ] **Step 1: Delete `get-goals.fn.js`**

```bash
rm services/investor/investor-bff/src/graphql/js-function/get-goals.fn.js
```

- [ ] **Step 2: Rewrite `get-profile.fn.js` to BatchGet composite + MandateStatus**

Replace `services/investor/investor-bff/src/graphql/js-function/get-profile.fn.js` with:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  return {
    operation: 'BatchGetItem',
    tables: {
      [ctx.stash.tableName]: {
        keys: [
          util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
          util.dynamodb.toMapValues({ pk, sk: 'MandateStatus' }),
        ],
        consistentRead: false,
      },
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result.data[ctx.stash.tableName] || [];
  const profile = items.find((i) => i.sk === 'InvestorProfile');
  const mandateStatus = items.find((i) => i.sk === 'MandateStatus');
  if (!profile) util.error('Profile not found', 'NotFound');
  if (mandateStatus && profile.mandate) {
    profile.mandate.status = mandateStatus.status;
    profile.mandate.revokedAt = mandateStatus.revokedAt;
  }
  return profile;
}
```

- [ ] **Step 3: Rewrite `update-goal.fn.js`**

Replace `services/investor/investor-bff/src/graphql/js-function/update-goal.fn.js` with:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;

  const sets = ['updatedAt = :now', '#ts = :ts'];
  const names = { '#ts': 'timestamp' };
  const values = { ':now': now, ':ts': now };

  for (const [key, val] of Object.entries(input)) {
    if (val === undefined || val === null) continue;
    sets.push(`goal.#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = val;
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
    update: {
      expression: `SET ${sets.join(', ')}`,
      expressionNames: names,
      expressionValues: util.dynamodb.toMapValues(values),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.goal;
}
```

Note: dropped the `EditEvent` PutItem (per spec §3.3 — no audit row). Dropped `goalId` parameter (no plurality).

- [ ] **Step 4: Rewrite `update-mandate.fn.js`**

Replace `services/investor/investor-bff/src/graphql/js-function/update-mandate.fn.js` with:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const input = ctx.arguments.input || {};
  if (input.monthlyTurnoverCapPercent !== undefined && (input.monthlyTurnoverCapPercent < 0 || input.monthlyTurnoverCapPercent > 100)) util.error('monthlyTurnoverCapPercent 0-100', 'ValidationError');
  if (input.maxSingleTradePercent !== undefined && (input.maxSingleTradePercent < 0 || input.maxSingleTradePercent > 100)) util.error('maxSingleTradePercent 0-100', 'ValidationError');
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;

  const sets = ['updatedAt = :now', '#ts = :ts'];
  const names = { '#ts': 'timestamp' };
  const values = { ':now': now, ':ts': now };
  for (const [key, val] of Object.entries(input)) {
    if (val === undefined || val === null) continue;
    sets.push(`mandate.#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = val;
  }

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk, sk: 'InvestorProfile' }),
    update: {
      expression: `SET ${sets.join(', ')}`,
      expressionNames: names,
      expressionValues: util.dynamodb.toMapValues(values),
    },
    condition: { expression: 'attribute_exists(pk)' },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return ctx.result.mandate;
}
```

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/
git commit -m "investor-bff: rewrite resolvers for composite InvestorProfile (drop EditEvent)"
```

### Task 1.8: Update Egress mapping in `service.stack.ts`

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`

- [ ] **Step 1: Replace the Egress eventTypes map**

Open `services/investor/investor-bff/src/service.stack.ts`. Replace the `Egress` block (lines ~60-97) with:

```typescript
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'InvestorProfile': {
          insert: InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
          modify: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
        },
        'MandateStatus': {
          insert: InvestorBffEventTypes.MANDATE_ACCEPTED,
          modify: InvestorBffEventTypes.MANDATE_REVOKED,
        },
        'Deposit': {
          insert: InvestorBffEventTypes.DEPOSIT_INITIATED,
          modify: InvestorBffEventTypes.DEPOSIT_UPDATED,
        },
        'Withdrawal': {
          insert: InvestorBffEventTypes.WITHDRAWAL_REQUESTED,
          modify: InvestorBffEventTypes.WITHDRAWAL_UPDATED,
        },
        'ExecutionModeChange': {
          insert: InvestorBffEventTypes.EXECUTION_MODE_CHANGED,
          modify: InvestorBffEventTypes.EXECUTION_MODE_CHANGE_UPDATED,
        },
        'Notification': { modify: InvestorBffEventTypes.NOTIFICATION_READ },
      },
    });
```

- [ ] **Step 2: Synth to verify CDK**

Run: `pnpm nx run investor-bff:synth`
Expected: success — Egress has 6 entity types mapped to 11 event names total (5 insert + 5 modify + 1 NOTIFICATION_READ).

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-bff/src/service.stack.ts
git commit -m "investor-bff: collapse Egress eventTypes to InvestorProfile + MandateStatus + 4 unchanged shapes"
```

### Task 1.9: Rewrite `investor-bff.integration.test.ts`

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

This is the largest single rewrite (986 LOC). Approach: keep all the test scaffolding (deployment, AppSync mutations, TestEnv); rewrite only the assertion blocks that reference per-entity rows or per-field events.

- [ ] **Step 1: Read the full integration test**

Run: `wc -l services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`
Then read it in chunks. Identify every block that asserts:
- Multiple TableEntry items per investor (per-entity rows) → assert single composite row
- `GOAL_CREATED`/`MANDATE_CREATED`/`RISK_PROFILE_CREATED`/`OPERATING_MODE_SELECTED` events → assert `INVESTOR_PROFILE_CREATED`
- `GOAL_UPDATED`/`MANDATE_UPDATED`/`OPERATING_MODE_CHANGED` events → assert `INVESTOR_PROFILE_UPDATED`
- `MANDATE_REVOKED` from old MandateRevocation row → defer to Phase 5 (mark with `it.skip` and a TODO referencing Phase 5)

- [ ] **Step 2: Rewrite the onboarding assertion blocks**

For each `describe('onboarding completion', ...)` block, change the assertions to:

```typescript
// Single composite row written
const items = await getInvestorProfileItems(tenantId, userId);
const profile = items.find((i) => i.sk === 'InvestorProfile');
const status = items.find((i) => i.sk === 'MandateStatus');
expect(profile).toBeDefined();
expect(profile.goal).toMatchObject({ objective: 'RETIREMENT', timeHorizonMonths: expect.any(Number) });
expect(profile.riskProfile).toMatchObject({ score: expect.any(Number), band: expect.any(Object) });
expect(profile.mandate).toMatchObject({ level: expect.any(String), status: 'ACTIVE' });
expect(status).toMatchObject({ status: 'ACCEPTED', acceptedAt: expect.any(String) });

// Two events emitted (composite + status), not 8
const events = await trap.collect();
const eventTypes = events.map((e) => e['detail-type']);
expect(eventTypes).toEqual(expect.arrayContaining(['INVESTOR_PROFILE_CREATED', 'MANDATE_ACCEPTED']));
expect(eventTypes).not.toContain('GOAL_CREATED');
expect(eventTypes).not.toContain('RISK_PROFILE_CREATED');
expect(eventTypes).not.toContain('MANDATE_CREATED');
```

- [ ] **Step 3: Rewrite `updateGoal` block**

Change the mutation invocation to use the new signature (`updateGoal(input: GoalInput!)` — no `goalId`), assert the composite `goal.*` field is updated, and assert `INVESTOR_PROFILE_UPDATED` (not `GOAL_UPDATED`) is emitted.

- [ ] **Step 4: Rewrite `updateMandate` block**

Same pattern. Assert composite `mandate.*` fields updated; `INVESTOR_PROFILE_UPDATED` emitted.

- [ ] **Step 5: Skip the `revokeMandate` block — defer to Phase 5**

Mark each `revokeMandate` integration assertion with `it.skip(name, ..., /* TODO Phase 5 */)`. Reasoning: Phase 1 leaves `revoke-mandate.fn.js` unchanged (writes to `MandateRevocation` row that's no longer in Egress map → no event emitted, but no breakage). Phase 5 will rewrite the resolver and re-enable these tests.

- [ ] **Step 6: Run unit tests first**

Run: `pnpm nx test investor-bff`
Expected: PASS (unit tests).

- [ ] **Step 7: Commit (integration test rewrite)**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "investor-bff: rewrite integration tests for composite shape (revoke deferred to Phase 5)"
```

(Integration tests run in Phase 9 against deployed dev. Don't run them now — investor-bff is not yet redeployed and would conflict with the in-flight migration.)

### Task 1.10: Sweep remaining investor-bff unit tests + add resolver tests

**Goal:** ensure every test file under `services/investor/investor-bff/test/unit/` passes after the collapse, and add unit tests for the 4 rewritten AppSync JS resolvers (TDD coverage).

**Files:**
- Verify: `services/investor/investor-bff/test/unit/handlers/event-listener.test.ts`
- Verify: `services/investor/investor-bff/test/unit/handlers/broadcast-listener.test.ts`
- Verify: `services/investor/investor-bff/test/unit/transforms/user-registered.test.ts`
- Verify: `services/investor/investor-bff/test/unit/transforms/balance-updated.test.ts`
- Verify: `services/investor/investor-bff/test/unit/transforms/notification-created.test.ts`
- Verify: `services/investor/investor-bff/test/unit/domain/guardrail-params.test.ts`
- Verify: `services/investor/investor-bff/test/unit/graphql/publish-deposit-event.test.ts`
- Modify: `services/investor/investor-bff/test/unit/transforms/onboarding-completed-transform.test.ts` — duplicate-named regression test for USER_REGISTERED↔ONBOARDING_COMPLETED race; reconcile with `onboarding-completed.test.ts`
- Create: `services/investor/investor-bff/test/unit/graphql/get-profile.test.ts`
- Create: `services/investor/investor-bff/test/unit/graphql/update-goal.test.ts`
- Create: `services/investor/investor-bff/test/unit/graphql/update-mandate.test.ts`

(Phase 5 will add `services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts` after the resolver is rewritten.)

- [ ] **Step 1: Run the full unit-test suite to identify breakage**

Run: `pnpm nx test investor-bff 2>&1 | tee /tmp/inv-bff-test.log | tail -80`
Expected: tests for `handlers/event-listener.test.ts`, `transforms/user-registered.test.ts`, `transforms/balance-updated.test.ts`, `transforms/notification-created.test.ts`, `domain/guardrail-params.test.ts`, `graphql/publish-deposit-event.test.ts` all PASS without changes (they don't touch dropped event types or method signatures).

If any fail, read the failure and fix in-line. The expected fixes are minimal — the only structural change that could ripple is `createProfile` removal from the repository. `user-registered.ts` transform calls `record()` directly (not `createProfile`), so it should be unaffected.

- [ ] **Step 2: Reconcile `onboarding-completed-transform.test.ts` (regression race coverage)**

Read `services/investor/investor-bff/test/unit/transforms/onboarding-completed-transform.test.ts` — it's a regression test for the documented USER_REGISTERED↔ONBOARDING_COMPLETED race (memory/project_decision_workflow_stuck.md). It asserts `TransactItems[0]` is a `Put` (not Update+attribute_exists).

After the collapse, the transactWrite has 2-3 items (composite + MandateStatus + optional Deposit) instead of 7. The race-coverage assertion stays valid: `TransactItems[0].Put` is the composite InvestorProfile.

Update its assertions to match the new shape:

```typescript
expect(transactWriteSpy).toHaveBeenCalledTimes(1);
const call = transactWriteSpy.mock.calls[0][0];
expect(call.TransactItems[0]).toHaveProperty('Put');
expect(call.TransactItems[0].Put.Item.sk).toBe('InvestorProfile');
expect(call.TransactItems[0].Put.Item.__typename).toBe('InvestorProfile');
// No ConditionExpression on the Put — race-safe by design (idempotent overwrite of any sparse user-registered row)
expect(call.TransactItems[0].Put.ConditionExpression).toBeUndefined();
```

- [ ] **Step 3: Write `get-profile.test.ts`**

Create `services/investor/investor-bff/test/unit/graphql/get-profile.test.ts`:

```typescript
import { request, response } from '../../../src/graphql/js-function/get-profile.fn.js';

describe('get-profile resolver', () => {
  const stash = { tenantId: 't1', userId: 'u1', tableName: 'inv-bff' };

  it('request: builds a BatchGetItem for InvestorProfile + MandateStatus on the same pk', () => {
    const op = request({ stash });
    expect(op.operation).toBe('BatchGetItem');
    const keys = op.tables['inv-bff'].keys;
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual({ pk: { S: 'InvestorProfile#t1#u1' }, sk: { S: 'InvestorProfile' } });
    expect(keys[1]).toEqual({ pk: { S: 'InvestorProfile#t1#u1' }, sk: { S: 'MandateStatus' } });
  });

  it('response: merges MandateStatus.status into mandate.status when present', () => {
    const ctx = {
      stash,
      result: {
        data: {
          'inv-bff': [
            { sk: 'InvestorProfile', mandate: { mandateId: 'm1', level: 'ADVISORY', status: 'ACTIVE' } },
            { sk: 'MandateStatus', status: 'REVOKED', acceptedAt: 't0', revokedAt: 't1' },
          ],
        },
      },
    };
    const result = response(ctx);
    expect(result.mandate.status).toBe('REVOKED');
    expect(result.mandate.revokedAt).toBe('t1');
  });

  it('response: leaves mandate.status alone when MandateStatus row absent', () => {
    const ctx = {
      stash,
      result: {
        data: {
          'inv-bff': [{ sk: 'InvestorProfile', mandate: { mandateId: 'm1', level: 'ADVISORY', status: 'ACTIVE' } }],
        },
      },
    };
    const result = response(ctx);
    expect(result.mandate.status).toBe('ACTIVE');
  });

  it('response: errors with NotFound when InvestorProfile row absent', () => {
    const utilErrorSpy = jest.fn(() => { throw new Error('Profile not found'); });
    jest.mock('@aws-appsync/utils', () => ({ util: { error: utilErrorSpy } }), { virtual: true });
    const ctx = { stash, result: { data: { 'inv-bff': [] } } };
    expect(() => response(ctx)).toThrow();
  });
});
```

- [ ] **Step 4: Write `update-goal.test.ts`**

Create `services/investor/investor-bff/test/unit/graphql/update-goal.test.ts`:

```typescript
import { request, response } from '../../../src/graphql/js-function/update-goal.fn.js';

describe('update-goal resolver', () => {
  const stash = { tenantId: 't1', userId: 'u1', tableName: 'inv-bff' };

  it('request: targets the composite InvestorProfile row, NOT a Goal#${id} sk', () => {
    const op = request({ stash, arguments: { input: { objective: 'GROWTH', targetAmountCents: 500000 } } });
    expect(op.operation).toBe('UpdateItem');
    expect(op.key).toEqual({ pk: { S: 'InvestorProfile#t1#u1' }, sk: { S: 'InvestorProfile' } });
  });

  it('request: nests update under goal.<field>, never top-level', () => {
    const op = request({ stash, arguments: { input: { objective: 'GROWTH' } } });
    expect(op.update.expression).toContain('goal.#objective = :objective');
    expect(op.update.expression).not.toMatch(/\bobjective\b/);
  });

  it('request: drops undefined/null fields from input', () => {
    const op = request({ stash, arguments: { input: { objective: 'GROWTH', currency: null } } });
    expect(op.update.expression).toContain('goal.#objective');
    expect(op.update.expression).not.toContain('goal.#currency');
  });

  it('request: includes attribute_exists(pk) precondition', () => {
    const op = request({ stash, arguments: { input: { objective: 'GROWTH' } } });
    expect(op.condition.expression).toBe('attribute_exists(pk)');
  });

  it('response: returns the goal sub-object from the updated item', () => {
    const result = response({ result: { goal: { objective: 'GROWTH', targetAmountCents: 500000 } } });
    expect(result).toEqual({ objective: 'GROWTH', targetAmountCents: 500000 });
  });
});
```

- [ ] **Step 5: Write `update-mandate.test.ts`**

Create `services/investor/investor-bff/test/unit/graphql/update-mandate.test.ts`:

```typescript
import { request, response } from '../../../src/graphql/js-function/update-mandate.fn.js';

describe('update-mandate resolver', () => {
  const stash = { tenantId: 't1', userId: 'u1', tableName: 'inv-bff' };

  it('request: nests update under mandate.<field> on composite InvestorProfile row', () => {
    const op = request({ stash, arguments: { input: { level: 'DISCRETIONARY', monthlyTurnoverCapPercent: 30 } } });
    expect(op.operation).toBe('UpdateItem');
    expect(op.key).toEqual({ pk: { S: 'InvestorProfile#t1#u1' }, sk: { S: 'InvestorProfile' } });
    expect(op.update.expression).toContain('mandate.#level = :level');
    expect(op.update.expression).toContain('mandate.#monthlyTurnoverCapPercent');
  });

  it('request: rejects monthlyTurnoverCapPercent out of [0,100]', () => {
    expect(() => request({ stash, arguments: { input: { monthlyTurnoverCapPercent: 150 } } })).toThrow();
  });

  it('request: rejects maxSingleTradePercent out of [0,100]', () => {
    expect(() => request({ stash, arguments: { input: { maxSingleTradePercent: -1 } } })).toThrow();
  });

  it('response: returns mandate sub-object', () => {
    const result = response({ result: { mandate: { mandateId: 'm1', level: 'ADVISORY' } } });
    expect(result).toEqual({ mandateId: 'm1', level: 'ADVISORY' });
  });
});
```

- [ ] **Step 6: Run full unit suite — expect pass**

Run: `pnpm nx test investor-bff`
Expected: PASS, all suites green.

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-bff/test/unit/
git commit -m "investor-bff: unit tests for collapsed resolvers (get-profile, update-goal, update-mandate); reconcile race-regression test"
```

### Acceptance criteria for Phase 1

- [ ] **Verify build passes:**
  Run: `pnpm nx run investor-bff:build`
  Expected: success.

- [ ] **Verify lint passes:**
  Run: `pnpm nx run investor-bff:lint`
  Expected: success.

- [ ] **Verify all unit tests pass:**
  Run: `pnpm nx test investor-bff`
  Expected: success — all 12 unit-test files green (existing 8 + 3 new graphql + 1 reconciled).

- [ ] **Verify CDK synth:**
  Run: `pnpm nx run investor-bff:synth`
  Expected: success; emitted CFN template has only 6 entity-type CDC mappings.

- [ ] **Verify event-name removal at module boundary:**
  Run: `grep -nE 'GOAL_CREATED|GOAL_UPDATED|RISK_PROFILE_CREATED|RISK_PROFILE_UPDATED|MANDATE_CREATED|MANDATE_UPDATED|OPERATING_MODE_SELECTED|OPERATING_MODE_CHANGED' services/investor/investor-bff/src/`
  Expected: zero matches inside investor-bff/src (other services may still reference these — they're addressed in Phases 3, 4, 6).

---

## Phase 2 — Direct EB → SF in decision-workflow-ctrl

**Goal:** Step Functions execution starts directly from EventBridge with `executionName=$.id` (idempotent across redelivery, replay, cross-region retries). Remove `WorkflowTrigger` row, `TriggerIngress` Lambda, `triggerHandler`, `materializeToTable` for triggers, `WORKFLOW_TRIGGER_*` event types. The 7-event trigger list per spec §3.1.

### Task 2.1: Update `domain/events.ts` — drop trigger materialization, swap trigger list

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/events.ts`

- [ ] **Step 1: Replace the file**

Replace contents of `services/advisory/decision-workflow-ctrl/src/domain/events.ts` with:

```typescript
import { eventName } from '@nestfolio/event-types';

export const DecisionWorkflowEventTypes = {
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
  DECISION_PACKET_UPDATED: eventName('DECISION_PACKET_UPDATED'),

  ANALYZE_INVESTOR_PROFILE: eventName('ANALYZE_INVESTOR_PROFILE'),
  ANALYZE_MARKET: eventName('ANALYZE_MARKET'),
  CONSTRUCT_PORTFOLIO: eventName('CONSTRUCT_PORTFOLIO'),
  GENERATE_NARRATIVE: eventName('GENERATE_NARRATIVE'),

  RECOMMENDATION_PROPOSED: eventName('RECOMMENDATION_PROPOSED'),
  USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),

  DECISION_FEEDBACK: eventName('DECISION_FEEDBACK'),
  DECISION_WORKFLOW_FAILED: eventName('DECISION_WORKFLOW_FAILED'),

  AGENT_OUTPUT_CREATED: eventName('AGENT_OUTPUT_CREATED'),
  AGENT_OUTPUT_UPDATED: eventName('AGENT_OUTPUT_UPDATED'),
} as const;

export const TRIGGER_EVENT_TYPES = [
  eventName('INVESTOR_PROFILE_CREATED'),
  eventName('INVESTOR_PROFILE_UPDATED'),
  eventName('PORTFOLIO_DRIFT_DETECTED'),
  eventName('ORDER_FILLED'),
  eventName('ORDER_REJECTED'),
  eventName('ORDER_CANCELLED'),
  eventName('DEPOSIT_DETECTED'),
] as const;

export const AGENT_COMPLETION_EVENT_TYPES = [
  eventName('INVESTOR_PROFILE_COMPLETED'),
  eventName('MARKET_ANALYSIS_COMPLETED'),
  eventName('PORTFOLIO_COMPLETED'),
  eventName('NARRATIVE_COMPLETED'),
] as const;

export const COMPLIANCE_EVENT_TYPES = [
  eventName('DECISION_APPROVED'),
  eventName('DECISION_BLOCKED'),
] as const;

export const USER_RESPONSE_EVENT_TYPES = [
  eventName('USER_CONFIRMED'),
  eventName('USER_REJECTED'),
] as const;

export const ALL_INBOUND_EVENT_TYPES = [
  ...AGENT_COMPLETION_EVENT_TYPES,
  ...COMPLIANCE_EVENT_TYPES,
  ...USER_RESPONSE_EVENT_TYPES,
] as const;
```

Removed: `WORKFLOW_TRIGGER_CREATED`, `WORKFLOW_TRIGGER_UPDATED`. Note: `TRIGGER_EVENT_TYPES` is now ONLY used to populate the EB→SF rule pattern in `service.stack.ts`; it's NOT in `ALL_INBOUND_EVENT_TYPES` because triggers go to SF, not the Lambda Ingress.

- [ ] **Step 2: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/domain/events.ts
git commit -m "decision-workflow-ctrl: trigger list = 7 events incl INVESTOR_PROFILE_*; drop WORKFLOW_TRIGGER_*"
```

### Task 2.2: Delete `event-listener.ts` + its test

**Files:**
- Delete: `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts`
- Delete: `services/advisory/decision-workflow-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Delete the files**

```bash
rm services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts
rm services/advisory/decision-workflow-ctrl/test/unit/event-listener.test.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A services/advisory/decision-workflow-ctrl/src/handlers services/advisory/decision-workflow-ctrl/test/unit
git commit -m "decision-workflow-ctrl: delete triggerHandler — SF starts directly from EB"
```

### Task 2.3: Rewire `service.stack.ts` — Orchestration.triggers + executionName + drop TriggerIngress

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`

- [ ] **Step 1: Verify the Orchestration construct supports `executionName`**

Run: `grep -n "executionName" libs/cdk-constructs/core/src/orchestration/`
Expected: existing `executionNameField` or `executionName` prop on `Orchestration`. From CLAUDE.md memory: "Orchestration: `executionName` skips EB rules + exposes `grantStartExecution()`".

If the construct supports it as a prop (e.g. `executionNameField: '$.detail.id'` or similar JSONPath), use it. Otherwise extend the construct (out-of-scope file-and-continue: `backlog-add` "extend Orchestration construct to expose executionName JSONPath prop").

For this plan we assume the prop is `executionNameField: string` taking a JSONPath into the EB event. Verify before proceeding.

- [ ] **Step 2: Rewrite the stack**

Replace the body of `DecisionWorkflowCtrlStack` constructor (everything after `super(...)`) with:

```typescript
    const state = new State(this, 'State');

    // --- AgentCore Memory ---
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));
    const sonnetModel = new BedrockFoundationModel(modelSonnetId);

    const memory = new agentcore.Memory(this, 'AgentMemory', {
      memoryName: `nestfolio_${props.prefix}_agent_memory`,
      description: 'Shared agent memory for cross-decision learning',
      expirationDuration: Duration.days(90),
      memoryStrategies: [
        agentcore.MemoryStrategy.usingUserPreference({
          name: 'InvestorPreferenceLearner',
          namespaces: ['/investor-profile/{actorId}/preferences'],
          customExtraction: { model: sonnetModel, appendToPrompt: 'Extract investment preferences: risk tolerance level, asset class preferences, ESG constraints, liquidity needs, time horizon, and any stated return targets. Ignore conversational filler.' },
          customConsolidation: { model: sonnetModel, appendToPrompt: 'When consolidating investor preferences, newer statements override older ones for the same dimension. Flag contradictions (e.g., high growth vs conservative).' },
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'MarketSignalExtractor',
          namespaces: ['/market-intelligence/{actorId}/signals'],
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'AllocationRationaleExtractor',
          namespaces: ['/portfolio-engine/{actorId}/rationale'],
          customExtraction: { model: sonnetModel, appendToPrompt: 'Extract portfolio allocation rationale: why each asset class was weighted, which constraints were binding, what trade-offs were made, and confidence level of each recommendation.' },
          customConsolidation: { model: sonnetModel, appendToPrompt: 'Consolidate allocation rationale chronologically. Preserve the reasoning chain — don\'t collapse distinct decisions into a summary.' },
        }),
        agentcore.MemoryStrategy.usingUserPreference({
          name: 'NarrativePreferenceLearner',
          namespaces: ['/advisory-narrative/{actorId}/preferences'],
          customExtraction: { model: sonnetModel, appendToPrompt: 'Extract communication preferences: preferred explanation depth (simple/detailed), terminology level (retail/professional), format preferences (bullet points/prose), and topics the investor engages with most.' },
          customConsolidation: { model: sonnetModel, appendToPrompt: 'Consolidate communication preferences using most recent signals. Weight explicit feedback (I prefer simpler explanations) higher than inferred patterns.' },
        }),
        agentcore.MemoryStrategy.usingSummarization({
          name: 'NarrativeSessionSummarizer',
          namespaces: ['/advisory-narrative/{actorId}/sessions/{sessionId}'],
        }),
      ],
    });

    if (memory.executionRole) {
      memory.executionRole.addToPrincipalPolicy(new PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:GetFoundationModel', 'bedrock:GetInferenceProfile'],
        resources: [
          `arn:aws:bedrock:${Stack.of(this).region}:*:inference-profile/us.*`,
          `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/*`,
        ],
      }));
    }

    new StringParameter(this, 'MemoryIdParam', {
      parameterName: this.naming.ssmParameterPath('memory/id'),
      stringValue: memory.memoryId,
    });

    const assemblePacketFn = new NodejsFunction(this, 'AssemblePacket', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'assemble-packet.ts'),
      environment: {
        MEMORY_ID: memory.memoryId,
        TABLE_NAME: state.getTable().tableName,
      },
    });
    memory.grantRead(assemblePacketFn);
    state.getTable().grantWriteData(assemblePacketFn);

    const decisionWorkflow = new DecisionWorkflowDefinition(this, 'DecisionWorkflow', {
      eventBus: this.eventBus,
      table: state.getTable(),
      serviceName: this.serviceName,
      assemblePacketFnArn: assemblePacketFn.functionArn,
    });

    const orchestration = new Orchestration(this, 'DecisionStateMachine', {
      state,
      definitionBody: decisionWorkflow.definitionBody,
      // Direct EB → SF: 7 trigger events start the state machine. SF rejects
      // duplicate StartExecution calls with the same executionName within 90
      // days — stronger dedup than DDB conditional writes (covers redelivery,
      // replay, cross-region retries). See spec §3.1.
      triggers: [...TRIGGER_EVENT_TYPES],
      executionNameField: '$.detail.id',
      timeout: Duration.hours(72),
    });
    assemblePacketFn.grantInvoke(orchestration.stateMachine);
    this.eventBus.grantPutEventsTo(orchestration.stateMachine);

    // CallbackIngress remains: agent completions + compliance + user responses
    // resume the SF via SendTaskSuccess. No more TriggerIngress.
    const callbackIngress = new Ingress(this, 'CallbackIngress', {
      state,
      eventTypes: [...ALL_INBOUND_EVENT_TYPES],
      entry: join(__dirname, 'handlers', 'sfn-callback.ts'),
    });
    orchestration.grantCallbackAccess(callbackIngress.handler);

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'DecisionPacket': {
          insert: DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
          modify: DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
        },
        'AgentOutput': {
          insert: DecisionWorkflowEventTypes.AGENT_OUTPUT_CREATED,
          modify: DecisionWorkflowEventTypes.AGENT_OUTPUT_UPDATED,
        },
      },
    });

    this.addObservability({
      ingress: callbackIngress,
      egress,
      orchestration,
    });
```

Update the imports at the top of the file:

```typescript
import {
  TRIGGER_EVENT_TYPES,
  ALL_INBOUND_EVENT_TYPES,
} from './domain/events';
```

(Remove `AGENT_COMPLETION_EVENT_TYPES`, `COMPLIANCE_EVENT_TYPES`, `USER_RESPONSE_EVENT_TYPES` from the named imports — they're rolled into `ALL_INBOUND_EVENT_TYPES`.)

- [ ] **Step 3: Verify CDK synth**

Run: `pnpm nx run decision-workflow-ctrl:synth`
Expected: success. Inspect the synthesized template for the SF EB rule:

Run: `cat services/advisory/decision-workflow-ctrl/cdk.out/dev-decision-workflow-ctrl.template.json | jq '.Resources | to_entries | map(select(.value.Type == "AWS::Events::Rule")) | .[].Properties.EventPattern'`
Expected: 1 rule with `detail-type: [INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED]` targeting the SF.

Verify `executionName` is set in the SF target. Look for `RoleArn` + the StartExecution target's `Input` configuration referencing `$.detail.id`.

If `executionNameField` prop doesn't exist on `Orchestration` (verify Step 1 of this task): file-and-continue via `backlog-add` "extend Orchestration construct to expose executionNameField"; for this phase use the escape hatch — drop down to `CfnRule` and set `Target.SqsParameters` / `Target.RoleArn` directly. If escape hatch is needed, add this comment to the stack: `// HACK: bypass Orchestration construct's missing executionNameField prop. Filed in BACKLOG.`

- [ ] **Step 4: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts
git commit -m "decision-workflow-ctrl: SF starts directly from EB w/ executionName=event.id; drop TriggerIngress"
```

### Task 2.4: Rewrite `service.stack.test.ts`

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Read the existing test**

Run: `cat services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 2: Replace assertions**

Update assertions to:

```typescript
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DecisionWorkflowCtrlStack } from '../../src/service.stack';

describe('DecisionWorkflowCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new DecisionWorkflowCtrlStack(app, 'TestStack', {
      prefix: 'test',
      subsystem: 'advisory',
      service: 'decision-workflow-ctrl',
    } as any);
    template = Template.fromStack(stack);
  });

  it('has a single EB→SF rule with 7 trigger events', () => {
    const rules = template.findResources('AWS::Events::Rule', {
      Properties: {
        EventPattern: {
          'detail-type': [
            'INVESTOR_PROFILE_CREATED',
            'INVESTOR_PROFILE_UPDATED',
            'PORTFOLIO_DRIFT_DETECTED',
            'ORDER_FILLED',
            'ORDER_REJECTED',
            'ORDER_CANCELLED',
            'DEPOSIT_DETECTED',
          ],
        },
      },
    });
    expect(Object.keys(rules)).toHaveLength(1);
  });

  it('does NOT create a TriggerIngress (no event-listener.ts handler)', () => {
    const fns = template.findResources('AWS::Lambda::Function', {
      Properties: { Description: expect.stringContaining('TriggerIngress') } as any,
    });
    expect(Object.keys(fns)).toHaveLength(0);
  });

  it('does NOT emit WORKFLOW_TRIGGER_* events from Egress', () => {
    const synthesized = JSON.stringify(template.toJSON());
    expect(synthesized).not.toContain('WORKFLOW_TRIGGER_CREATED');
    expect(synthesized).not.toContain('WORKFLOW_TRIGGER_UPDATED');
  });
});
```

- [ ] **Step 3: Run unit tests — expect pass**

Run: `pnpm nx test decision-workflow-ctrl`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "decision-workflow-ctrl: stack tests assert direct EB→SF + no WORKFLOW_TRIGGER"
```

### Task 2.5: Update `decision-workflow-ctrl.integration.test.ts`

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: Read existing test**

Run: `wc -l services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 2: Collapse 8 trigger event tests to 2 unified**

Find all `describe('trigger: <event>', ...)` or `it('starts SF on <event>', ...)` blocks. For:
- `MANDATE_CREATED`, `GOAL_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_CREATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED` → **DELETE** these (subsumed by INVESTOR_PROFILE_*).
- Keep tests for `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED` (cross-domain triggers — unchanged behavior).
- Add 2 new tests: `it('starts SF on INVESTOR_PROFILE_CREATED with executionName=event.id')` and `it('starts SF on INVESTOR_PROFILE_UPDATED with executionName=event.id')`.

For the new tests:

```typescript
it('starts SF on INVESTOR_PROFILE_CREATED with executionName=event.id', async () => {
  const eventId = 'test-event-' + Date.now();
  await emitEvent('INVESTOR_PROFILE_CREATED', { tenantId, userId, /* composite payload */ }, { id: eventId });
  await waitForSfExecution({ executionName: eventId });
  // Re-emit same eventId (simulate redelivery)
  await emitEvent('INVESTOR_PROFILE_CREATED', { tenantId, userId, /* composite payload */ }, { id: eventId });
  // Assert NO second execution started (executionName collision)
  const executions = await listSfExecutions({ executionName: eventId });
  expect(executions).toHaveLength(1);
});
```

- [ ] **Step 3: Commit (don't run integration yet — see Phase 9)**

```bash
git add services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
git commit -m "decision-workflow-ctrl: integration tests collapse 6 trigger events to INVESTOR_PROFILE_*"
```

### Acceptance criteria for Phase 2

- [ ] **Build passes:**
  Run: `pnpm nx run decision-workflow-ctrl:build`
- [ ] **Synth shows direct EB→SF rule:**
  Run: `pnpm nx run decision-workflow-ctrl:synth && grep -c "INVESTOR_PROFILE_CREATED" services/advisory/decision-workflow-ctrl/cdk.out/*.template.json`
  Expected: ≥1.
- [ ] **No `event-listener.ts`:**
  Run: `ls services/advisory/decision-workflow-ctrl/src/handlers/`
  Expected: only `assemble-packet.ts`, `event-publisher.ts`, `sfn-callback.ts`.
- [ ] **Unit tests pass:**
  Run: `pnpm nx test decision-workflow-ctrl`
- [ ] **No `WORKFLOW_TRIGGER_*` references in src:**
  Run: `grep -rn "WORKFLOW_TRIGGER" services/advisory/decision-workflow-ctrl/src/`
  Expected: zero matches.

---

## Phase 3 — Compliance + Dashboard consumers re-subscribe

**Goal:** `compliance-ctrl` reads mandate config from `INVESTOR_PROFILE_*` payloads (idempotent re-write of MandateSnapshot on every change), and gates on `MANDATE_REVOKED` (new minimal handler). `dashboard-bff` reads composite payload (single switch branch).

### Task 3.1: Rewire `compliance-ctrl` event-listener

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/compliance-ctrl/src/service.stack.ts`

- [ ] **Step 1: Update Ingress subscriptions in service.stack.ts**

Open `services/advisory/compliance-ctrl/src/service.stack.ts`. Find the Ingress eventTypes list. Replace:
- `MANDATE_CREATED, MANDATE_UPDATED, OPERATING_MODE_CHANGED` (3 events)
With:
- `INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_REVOKED` (3 events).

Also update the import:

```typescript
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
// or whichever cross-domain barrel re-exports it via investor-adpt — verify
```

- [ ] **Step 2: Rewrite `processMandateEvent`**

Replace the `processMandateEvent` function in `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` with:

```typescript
function processInvestorProfileEvent(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject;
  const tenantId = (subject?.tenantId as string) ?? ctx.tenantId;
  const userId = (subject?.userId as string) ?? tenantId;
  const mandate = (subject?.mandate ?? {}) as Record<string, unknown>;
  const operatingMode = subject?.operatingMode as string | undefined;

  if (!mandate.mandateId || !mandate.level) {
    throw new NotRetryableError(
      `Missing required mandate fields in INVESTOR_PROFILE_* payload: mandateId=${mandate.mandateId}, level=${mandate.level}`,
    );
  }

  logger.info('MandateSnapshot projected from composite InvestorProfile event', {
    tenantId,
    userId,
    eventType: ctx.eventType,
    operatingMode,
  });

  return project(
    'MandateSnapshot',
    {
      tenantId,
      userId,
      mandateId: mandate.mandateId,
      level: mandate.level,
      monthlyTurnoverCapPercent: (mandate.monthlyTurnoverCapPercent as number) ?? 25,
      maxSingleTradePercent: (mandate.maxSingleTradePercent as number) ?? 10,
      equityRiskBandPercent: (mandate.equityRiskBandPercent as number) ?? 6,
      driftTriggerPercent: (mandate.driftTriggerPercent as number) ?? 4,
      singleEtfConcentrationPercent: (mandate.singleEtfConcentrationPercent as number) ?? 30,
      drawdownCircuitBreakerPercent: (mandate.drawdownCircuitBreakerPercent as number) ?? 12,
      effectiveDate: mandate.effectiveDate as string,
      revokedAt: (mandate.revokedAt as string) ?? null,
      status: 'ACTIVE',
    },
    { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' },
  );
}

function processMandateRevoked(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const revokedAt = (subject.revokedAt as string) ?? new Date().toISOString();

  logger.info('Mandate revoked — gating MandateSnapshot.status=REVOKED', { tenantId, userId });

  return project(
    'MandateSnapshot',
    {
      tenantId,
      userId,
      status: 'REVOKED',
      revokedAt,
    },
    { pk: guardrailPolicyPk(tenantId, userId), sk: 'MandateSnapshot' },
  );
}
```

- [ ] **Step 3: Update `createHandlers` to register new handlers**

Replace the `for (const type of [MANDATE_CREATED, MANDATE_UPDATED, OPERATING_MODE_CHANGED])` loop with:

```typescript
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
// at top

// inside createHandlers:
handlers[InvestorBffEventTypes.INVESTOR_PROFILE_CREATED] = (payload, ctx) =>
  processInvestorProfileEvent(payload, ctx);
handlers[InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED] = (payload, ctx) =>
  processInvestorProfileEvent(payload, ctx);
handlers[InvestorBffEventTypes.MANDATE_REVOKED] = (payload, ctx) =>
  processMandateRevoked(payload, ctx);
```

(If `compliance-ctrl` imports through `advisory-adpt/domain` rather than directly from `investor-bff/events`, use the cross-domain barrel — see Phase 6.)

- [ ] **Step 4: Update `AuthorityResolver` to gate on `status === 'REVOKED'`**

Open `services/advisory/compliance-ctrl/src/rules/authority-resolver.ts`. Find the resolution logic. Add a gate at the top:

```typescript
if (input.mandate.status === 'REVOKED') {
  // Treat as BLOCKED with synthetic violation
  return 'L2'; // forces user-confirmation, but BLOCKED is set by mandate-validator
}
```

And in `mandate-validator.ts`, add a check at the top of `validate()`:

```typescript
if ((input.mandate as any).status === 'REVOKED') {
  return {
    name: 'MANDATE_REVOKED',
    passed: false,
    details: 'Mandate has been revoked; no further trades may be authorized',
  };
}
```

(Adjust the `MandateSnapshot` interface in `rule-engine.ts:7` to add `status?: 'ACTIVE' | 'REVOKED'` field.)

- [ ] **Step 5: Update unit tests**

Open `services/advisory/compliance-ctrl/test/unit/event-listener.test.ts`. Replace mandate-event tests with INVESTOR_PROFILE_* projection tests + MANDATE_REVOKED tests.

- [ ] **Step 6: Run unit tests**

Run: `pnpm nx test compliance-ctrl`
Expected: PASS.

- [ ] **Step 7: Synth + commit**

Run: `pnpm nx run compliance-ctrl:synth`
Expected: success.

```bash
git add services/advisory/compliance-ctrl/
git commit -m "compliance-ctrl: subscribe to INVESTOR_PROFILE_*+MANDATE_REVOKED; gate rule engine on status"
```

### Task 3.2: Rewire `dashboard-bff` event-listener

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`
- Modify: `services/investor/dashboard-bff/src/service.stack.ts`

- [ ] **Step 1: Update Ingress subscriptions**

Open `services/investor/dashboard-bff/src/service.stack.ts`. Find the Ingress eventTypes list. Replace:
- `GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED` (6 events)
With:
- `INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED` (2 events).

Keep all other subscriptions unchanged.

- [ ] **Step 2: Rewrite `investor-snapshot.ts`**

Replace contents of `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts` with:

```typescript
import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const investorSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as Record<string, unknown>;

  const goal = payload.goal as Record<string, unknown> | undefined;
  const riskProfile = payload.riskProfile as Record<string, unknown> | undefined;

  const updates: Record<string, unknown> = {
    tenantId,
    userId,
    region,
  };
  if (goal?.objective !== undefined) updates.goalType = goal.objective;
  if (riskProfile?.score !== undefined) updates.riskLevel = String(riskProfile.score);
  if (payload.operatingMode !== undefined) updates.operatingMode = payload.operatingMode;
  if (event.type === 'INVESTOR_PROFILE_CREATED') {
    updates.onboardedAt = event.timestamp;
  }

  return project('InvestorSnapshot', updates, {
    pk: `T#${tenantId}`,
    sk: 'InvestorSnapshot',
  });
};
```

- [ ] **Step 3: Update event-listener.ts**

Open `services/investor/dashboard-bff/src/handlers/event-listener.ts`. Replace the 6 entries (GOAL_CREATED through OPERATING_MODE_CHANGED) with 2:

```typescript
[InvestorBffEventTypes.INVESTOR_PROFILE_CREATED]: (payload: EventPayload, ctx: EventContext) =>
  investorSnapshot(toUow(payload, ctx)),
[InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
  investorSnapshot(toUow(payload, ctx)),
```

- [ ] **Step 4: Update unit tests**

Update `services/investor/dashboard-bff/test/unit/transforms/investor-snapshot.test.ts` and `services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts` to use composite payload shape.

- [ ] **Step 5: Run tests**

Run: `pnpm nx test dashboard-bff`
Expected: PASS.

- [ ] **Step 6: Synth + commit**

Run: `pnpm nx run dashboard-bff:synth`

```bash
git add services/investor/dashboard-bff/
git commit -m "dashboard-bff: subscribe to INVESTOR_PROFILE_* (composite payload, single branch)"
```

### Task 3.3: Update compliance-ctrl rule unit tests for MANDATE_REVOKED gate

**Goal:** unit-level coverage of the new `status === 'REVOKED'` gating in mandate-validator → authority-resolver → rule-engine.

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/unit/mandate-validator.test.ts`
- Modify: `services/advisory/compliance-ctrl/test/unit/authority-resolver.test.ts`
- Modify: `services/advisory/compliance-ctrl/test/unit/rule-engine.test.ts`

- [ ] **Step 1: Add `MANDATE_REVOKED` precondition test to `mandate-validator.test.ts`**

Append to the existing test file:

```typescript
describe('mandate-validator (REVOKED gate)', () => {
  it('returns failed CheckResult with name=MANDATE_REVOKED when input.mandate.status === "REVOKED"', () => {
    const validator = new MandateValidator();
    const result = validator.validate({
      mandate: { status: 'REVOKED', mandateId: 'm1', level: 'ADVISORY' /* ...other fields */ } as any,
      proposedTrades: [],
      portfolioValue: 100000,
      riskScore: 5,
      currentPositions: [],
      decisionPacketId: 'd1',
      tenantId: 't1',
      userId: 'u1',
    });
    expect(result.passed).toBe(false);
    expect(result.name).toBe('MANDATE_REVOKED');
    expect(result.details).toMatch(/revoked/i);
  });

  it('passes when status is undefined (legacy snapshots without status field)', () => {
    const validator = new MandateValidator();
    const result = validator.validate({
      mandate: { mandateId: 'm1', level: 'ADVISORY' /* no status field */ } as any,
      // ... rest
    } as any);
    // Legacy snapshots without explicit status field default to allowed; preserves backwards-compat for in-flight cycles
    expect(result.passed).toBe(true);
  });
});
```

(Adapt object shapes to match the actual `MandateValidator.validate` signature in your codebase — read `services/advisory/compliance-ctrl/src/rules/mandate-validator.ts` first.)

- [ ] **Step 2: Add gate test to `authority-resolver.test.ts`**

Append:

```typescript
describe('authority-resolver (REVOKED gate)', () => {
  it('returns L2 when mandate.status === "REVOKED" so cycle blocks at user-confirm', () => {
    const resolver = new AuthorityResolver();
    const level = resolver.resolve(
      { mandate: { status: 'REVOKED' /* ... */ } as any, /* rest */ } as any,
      [],
    );
    expect(level).toBe('L2');
  });
});
```

- [ ] **Step 3: Add end-to-end REVOKED flow to `rule-engine.test.ts`**

Append:

```typescript
describe('RuleEngine.evaluate (REVOKED end-to-end)', () => {
  it('returns BLOCKED with MANDATE_REVOKED violation when mandate is revoked', () => {
    const engine = new RuleEngine(
      new MandateValidator(),
      new GuardrailEvaluator(),
      new SuitabilityChecker(),
      new AuthorityResolver(),
    );
    const output = engine.evaluate({
      mandate: { mandateId: 'm1', level: 'ADVISORY', status: 'REVOKED' /* ...required fields with defaults */ } as any,
      proposedTrades: [{ symbol: 'VTI', assetClass: 'ETF', side: 'BUY', quantityOrAmountCents: 1000_00, targetWeightPercent: 10, rationale: '' }],
      portfolioValue: 100000,
      riskScore: 5,
      currentPositions: [],
      decisionPacketId: 'd1',
      tenantId: 't1',
      userId: 'u1',
    });
    expect(output.result).toBe('BLOCKED');
    expect(output.violations.some((v) => v.rule === 'MANDATE_REVOKED')).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx test compliance-ctrl -- --testPathPattern='mandate-validator|authority-resolver|rule-engine'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/compliance-ctrl/test/unit/
git commit -m "compliance-ctrl: unit tests for MANDATE_REVOKED gate (validator + resolver + engine)"
```

### Task 3.4: Refactor compliance-ctrl integration test

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

- [ ] **Step 1: Read existing scenarios**

Run: `grep -n "MANDATE_CREATED\|MANDATE_UPDATED\|OPERATING_MODE_CHANGED\|RECOMMENDATION_PROPOSED" services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

- [ ] **Step 2: Replace mandate-projection scenarios**

Replace `it('projects MandateSnapshot from MANDATE_CREATED', ...)` with `it('projects MandateSnapshot from INVESTOR_PROFILE_CREATED composite payload', ...)`. The emitted event subject now has `mandate: { mandateId, level, monthlyTurnoverCapPercent, ... }` nested. Assertions update to read `mandate.*` from subject.

Replace `it('updates MandateSnapshot from MANDATE_UPDATED', ...)` with `it('updates MandateSnapshot from INVESTOR_PROFILE_UPDATED', ...)`.

DELETE `it('skips OPERATING_MODE_CHANGED', ...)` — that branch is removed; operating mode is folded into INVESTOR_PROFILE_UPDATED.

- [ ] **Step 3: Add MANDATE_REVOKED scenario**

```typescript
it('sets MandateSnapshot.status=REVOKED on MANDATE_REVOKED event', async () => {
  // Seed MandateSnapshot via INVESTOR_PROFILE_CREATED
  await emitEvent('INVESTOR_PROFILE_CREATED', { tenantId, userId, mandate: { mandateId: 'm1', level: 'ADVISORY', /* ... */ } });
  await waitForProjection({ pk: `GuardrailPolicy#${tenantId}#${userId}`, sk: 'MandateSnapshot', expected: { status: 'ACTIVE' } });

  // Revoke
  await emitEvent('MANDATE_REVOKED', { tenantId, userId, revokedAt: '2026-05-03T10:00:00Z' });
  await waitForProjection({ pk: `GuardrailPolicy#${tenantId}#${userId}`, sk: 'MandateSnapshot', expected: { status: 'REVOKED', revokedAt: '2026-05-03T10:00:00Z' } });
});
```

- [ ] **Step 4: Add REVOKED-blocks-cycle scenario**

```typescript
it('RECOMMENDATION_PROPOSED returns BLOCKED+MANDATE_REVOKED when MandateSnapshot.status=REVOKED', async () => {
  // seed snapshot in REVOKED state, then propose, assert ComplianceCheck.violations contains MANDATE_REVOKED
});
```

- [ ] **Step 5: Commit (don't run integration; runs in Phase 9)**

```bash
git add services/advisory/compliance-ctrl/test/integration/
git commit -m "compliance-ctrl: integration tests for INVESTOR_PROFILE_*+MANDATE_REVOKED projections"
```

### Acceptance criteria for Phase 3

- [ ] `pnpm nx run-many --target=test --projects=compliance-ctrl,dashboard-bff` PASSES (all 7 unit-test files for compliance-ctrl + 8 for dashboard-bff).
- [ ] `pnpm nx run-many --target=synth --projects=compliance-ctrl,dashboard-bff` PASSES.
- [ ] `grep -rn 'GOAL_CREATED\|MANDATE_CREATED\|MANDATE_UPDATED' services/advisory/compliance-ctrl/src/ services/investor/dashboard-bff/src/` returns zero matches.
- [ ] `grep -rn 'MANDATE_CREATED' services/advisory/compliance-ctrl/test/` returns zero matches (after Task 3.4).

---

## Phase 4 — Notification-lifecycle redesign (`investor-ctrl`)

**Goal:** `investor-ctrl` fires:
- `MANDATE_ACCEPTED` → "Investment Mandate Activated" (replaces `MANDATE_CREATED`)
- `MANDATE_REVOKED` → "Mandate Revoked" (NEW)
- `INVESTOR_PROFILE_UPDATED` → diff-detect `goal.*` → "Goal Updated"; diff-detect `operatingMode` → "Operating Mode Changed"

Mandate lifecycle is dedicated events (no diff). Remaining diff-detection only for goal + operatingMode.

### Task 4.1: Update Ingress subscriptions

**Files:**
- Modify: `services/investor/investor-ctrl/src/service.stack.ts`

- [ ] **Step 1: Replace Ingress eventTypes**

Find Ingress block. Drop `MANDATE_CREATED, GOAL_UPDATED, OPERATING_MODE_CHANGED`. Add `MANDATE_ACCEPTED, MANDATE_REVOKED, INVESTOR_PROFILE_UPDATED`.

Final list: `ONBOARDING_COMPLETED, MANDATE_ACCEPTED, MANDATE_REVOKED, INVESTOR_PROFILE_UPDATED, DEPOSIT_INITIATED, DECISION_APPROVED, ORDER_FILLED, BALANCE_UPDATED, ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_COMPLETED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED` (14 events).

- [ ] **Step 2: Synth**

Run: `pnpm nx run investor-ctrl:synth`

### Task 4.2: Rewrite `notification-lifecycle.service.ts` + handler

**Files:**
- Modify: `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts`
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`

- [ ] **Step 1: Update NOTIFICATION_TEMPLATES map**

Open `services/investor/investor-ctrl/src/handlers/event-listener.ts`. Modify the `NOTIFICATION_TEMPLATES` constant:
- DROP: `MANDATE_CREATED`, `GOAL_UPDATED`, `OPERATING_MODE_CHANGED`
- ADD:
  - `MANDATE_ACCEPTED`: `{ title: 'Investment Mandate Activated', body: 'Your investment mandate has been granted. We will start managing your portfolio.', channel: 'push' }`
  - `MANDATE_REVOKED`: `{ title: 'Mandate Revoked', body: 'Your investment mandate has been revoked. No further automated trades will be authorized.', channel: 'push' }`
- KEEP: `GOAL_UPDATED` template (used by diff-detection branch — keep title/body)
- KEEP: `OPERATING_MODE_CHANGED` template (used by diff-detection branch)

- [ ] **Step 2: Add diff-detection helpers**

Append to the same file (above `EVENT_TYPES`):

```typescript
interface InvestorProfileSubject {
  goal?: { objective?: string; targetAmountCents?: number; timeHorizonMonths?: number; targetReturn?: number; currency?: string };
  operatingMode?: string;
}

function deriveProfileUpdateNotifications(
  oldImage: InvestorProfileSubject | null,
  newImage: InvestorProfileSubject,
  ctx: EventContext,
): WriteIntent[] {
  const tenantId = ctx.tenantId;
  const now = getTime();
  const intents: WriteIntent[] = [];

  const goalChanged =
    !oldImage ||
    JSON.stringify(oldImage.goal ?? {}) !== JSON.stringify(newImage.goal ?? {});
  if (goalChanged && newImage.goal) {
    const tmpl = NOTIFICATION_TEMPLATES['GOAL_UPDATED'];
    intents.push(
      record(
        'Notification',
        {
          __typename: 'Notification',
          tenantId,
          notificationId: `${ctx.eventId}:goal`,
          type: 'GOAL_UPDATED',
          title: tmpl.title,
          body: tmpl.body,
          channel: tmpl.channel,
          status: 'DELIVERED',
          sourceEventId: ctx.eventId,
          timestamp: now,
          createdAt: now,
          updatedAt: now,
        },
        { pk: `Notification#${tenantId}#${ctx.eventId}:goal`, sk: 'Notification' },
      ),
    );
  }

  const modeChanged = !oldImage || oldImage.operatingMode !== newImage.operatingMode;
  if (modeChanged && newImage.operatingMode) {
    const tmpl = NOTIFICATION_TEMPLATES['OPERATING_MODE_CHANGED'];
    intents.push(
      record(
        'Notification',
        {
          __typename: 'Notification',
          tenantId,
          notificationId: `${ctx.eventId}:mode`,
          type: 'OPERATING_MODE_CHANGED',
          title: tmpl.title,
          body: tmpl.body,
          channel: tmpl.channel,
          status: 'DELIVERED',
          sourceEventId: ctx.eventId,
          timestamp: now,
          createdAt: now,
          updatedAt: now,
        },
        { pk: `Notification#${tenantId}#${ctx.eventId}:mode`, sk: 'Notification' },
      ),
    );
  }

  return intents;
}
```

- [ ] **Step 3: Add INVESTOR_PROFILE_UPDATED handler**

Inside `createHandlers`, add a dedicated branch (do NOT include `INVESTOR_PROFILE_UPDATED` in `EVENT_TYPES` array — its handler is bespoke):

```typescript
return {
  ...Object.fromEntries(
    EVENT_TYPES.map((type) => [
      type,
      // existing buildNotificationRecord(...) + ORDER_FILLED special-case
      // (unchanged from current code)
    ]),
  ),
  ...Object.fromEntries(
    SYSTEM_EVENT_TYPES.map((type) => [type, /* unchanged */]),
  ),
  [InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent | WriteIntent[]> => {
    const newImage = (payload.subject ?? {}) as InvestorProfileSubject;
    const oldImage = (payload.previousSubject ?? null) as InvestorProfileSubject | null;
    return deriveProfileUpdateNotifications(oldImage, newImage, ctx);
  },
};
```

Note: `payload.previousSubject` is the CDC OldImage, populated by event-processor's CDC publisher. If your event-processor version doesn't surface this, fall back to the raw EB event's `detail.previousSubject` field. **VERIFY** by reading `libs/event-processor/src/cdc/` — if `previousSubject` is not exposed, file via `backlog-add` and use a feature flag: skip diff (always fire both notifications) until OldImage propagation is wired through. For now, assume it works.

- [ ] **Step 4: Add MANDATE_ACCEPTED + MANDATE_REVOKED to EVENT_TYPES**

```typescript
const EVENT_TYPES = [
  InvestorBffEventTypes.ONBOARDING_COMPLETED,
  InvestorBffEventTypes.MANDATE_ACCEPTED,
  InvestorBffEventTypes.MANDATE_REVOKED,
  InvestorBffEventTypes.DEPOSIT_INITIATED,
  AdvisoryCrossDomainEventTypes.DECISION_APPROVED,
  ExecutionCrossDomainEventTypes.ORDER_FILLED,
  LedgerCrossDomainEventTypes.BALANCE_UPDATED,
  ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED,
  AdvisoryCrossDomainEventTypes.DECISION_BLOCKED,
] as const;
```

(Removed: `MANDATE_CREATED`, `GOAL_UPDATED`, `OPERATING_MODE_CHANGED`. Added: `MANDATE_ACCEPTED`, `MANDATE_REVOKED`.)

- [ ] **Step 5: Write/update unit tests**

Open `services/investor/investor-ctrl/test/unit/services/notification-lifecycle.service.test.ts` (or wherever the relevant tests live). Add cases:

- `MANDATE_ACCEPTED` → "Investment Mandate Activated" notification with notificationId=eventId
- `MANDATE_REVOKED` → "Mandate Revoked" notification
- `INVESTOR_PROFILE_UPDATED` with `goal.objective` change only → 1 notification (notificationId=eventId:goal)
- `INVESTOR_PROFILE_UPDATED` with `operatingMode` change only → 1 notification (notificationId=eventId:mode)
- `INVESTOR_PROFILE_UPDATED` with both changed → 2 notifications
- `INVESTOR_PROFILE_UPDATED` with NO change (e.g., timestamp-only refresh) → 0 notifications
- `INVESTOR_PROFILE_UPDATED` with null OldImage → 2 notifications (treat as all fields appearing)

- [ ] **Step 6: Run tests**

Run: `pnpm nx test investor-ctrl`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-ctrl/
git commit -m "investor-ctrl: MANDATE_ACCEPTED/REVOKED notifications + INVESTOR_PROFILE_UPDATED diff-gate"
```

### Task 4.3: Refactor investor-ctrl onboarding-notification integration test

**Files:**
- Modify: `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`

- [ ] **Step 1: Read existing scenarios**

Run: `grep -n "detailType:" services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`

Expected (from inventory): scenarios for `MANDATE_CREATED`, `GOAL_UPDATED`, `OPERATING_MODE_CHANGED` among others.

- [ ] **Step 2: Replace MANDATE_CREATED scenario with MANDATE_ACCEPTED**

```typescript
it('emits "Investment Mandate Activated" notification on MANDATE_ACCEPTED', async () => {
  await emitEvent('MANDATE_ACCEPTED', { tenantId, userId, status: 'ACCEPTED', acceptedAt: '...' });
  await waitForNotification({ tenantId, type: 'MANDATE_ACCEPTED' });
  // notificationId = eventId (no diff suffix — dedicated event)
});
```

- [ ] **Step 3: Add MANDATE_REVOKED scenario**

```typescript
it('emits "Mandate Revoked" notification on MANDATE_REVOKED', async () => {
  await emitEvent('MANDATE_REVOKED', { tenantId, userId, revokedAt: '...' });
  await waitForNotification({ tenantId, type: 'MANDATE_REVOKED' });
});
```

- [ ] **Step 4: Replace GOAL_UPDATED + OPERATING_MODE_CHANGED with INVESTOR_PROFILE_UPDATED diff scenarios**

```typescript
it('INVESTOR_PROFILE_UPDATED with goal change → 1 "Goal Updated" notification (notificationId = eventId:goal)', async () => {
  await emitEvent('INVESTOR_PROFILE_UPDATED', {
    tenantId, userId,
    goal: { objective: 'GROWTH', /* ... */ },
    /* unchanged operatingMode */
  }, {
    previousSubject: { goal: { objective: 'RETIREMENT', /* ... */ }, operatingMode: 'BALANCED' },
  });
  const notifications = await listNotificationsByTenant(tenantId);
  expect(notifications.filter((n) => n.type === 'GOAL_UPDATED')).toHaveLength(1);
  expect(notifications.filter((n) => n.type === 'OPERATING_MODE_CHANGED')).toHaveLength(0);
});

it('INVESTOR_PROFILE_UPDATED with operatingMode change → 1 "Operating Mode Changed" notification', async () => {
  // similar — assert exactly 1 OPERATING_MODE_CHANGED, 0 GOAL_UPDATED
});

it('INVESTOR_PROFILE_UPDATED with both changed → 2 notifications with distinct notificationIds', async () => {
  // emit with both goal + operatingMode changed; assert 2 notifications, notificationIds = [eventId:goal, eventId:mode]
});

it('INVESTOR_PROFILE_UPDATED with no semantic change → 0 notifications', async () => {
  // emit with NewImage === OldImage (e.g. timestamp-only refresh); assert no notifications written
});

it('INVESTOR_PROFILE_UPDATED with null OldImage (CDC race / first observation) → notifications fire for all populated fields', async () => {
  // emit without previousSubject; assert 2 notifications
});
```

- [ ] **Step 5: Verify the existing `ONBOARDING_COMPLETED → "Welcome"` scenario is still correct**

The "Welcome to Nestfolio" notification is emitted from ONBOARDING_COMPLETED — unchanged behavior. Verify the assertion still holds.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts
git commit -m "investor-ctrl: integration tests for MANDATE_ACCEPTED/REVOKED + INVESTOR_PROFILE_UPDATED diff notifications"
```

### Acceptance criteria for Phase 4

- [ ] `pnpm nx test investor-ctrl` PASSES (all 4 unit-test files green).
- [ ] `pnpm nx run investor-ctrl:synth` PASSES.
- [ ] No reference to `MANDATE_CREATED` in investor-ctrl/src.
- [ ] `grep -rn 'detailType:.*MANDATE_CREATED\|detailType:.*GOAL_UPDATED\|detailType:.*OPERATING_MODE_CHANGED' services/investor/investor-ctrl/test/integration/` returns zero matches (the literal strings inside event-emission helpers).

---

## Phase 5 — `revokeMandate` resolver — single UpdateItem on MandateStatus

**Goal:** Close the half-implemented `revokeMandate` flow (PARKING LOT entry, commit `53a20777`). The resolver writes ONE UpdateItem on `MandateStatus` row → CDC MODIFY → `MANDATE_REVOKED` event. The composite `InvestorProfile` row is NOT touched (no spurious `INVESTOR_PROFILE_UPDATED` triggering a wasted decision cycle).

### Task 5.1: Rewrite `revoke-mandate.fn.js`

**Files:**
- Modify: `services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js`

- [ ] **Step 1: Replace the resolver**

Replace contents with:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const now = util.time.nowISO8601();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ pk, sk: 'MandateStatus' }),
    update: {
      expression: 'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now',
      expressionNames: { '#status': 'status', '#ts': 'timestamp' },
      expressionValues: util.dynamodb.toMapValues({ ':revoked': 'REVOKED', ':now': now }),
    },
    condition: { expression: 'attribute_exists(pk) AND #status = :active', expressionNames: { '#status': 'status' }, expressionValues: util.dynamodb.toMapValues({ ':active': 'ACCEPTED' }) },
  };
}

export function response(ctx) {
  if (ctx.error) {
    if (ctx.error.type === 'DynamoDB:ConditionalCheckFailedException') {
      util.error('Mandate is not active or already revoked', 'InvalidState');
    }
    util.error(ctx.error.message, ctx.error.type);
  }
  return {
    status: ctx.result.status,
    acceptedAt: ctx.result.acceptedAt,
    revokedAt: ctx.result.revokedAt,
  };
}
```

Removed: `MandateRevocation` row write, `EditEvent` row write. Added: `attribute_exists` + `status = ACCEPTED` precondition prevents double-revocation. Returns the schema-aligned `MandateStatus` shape.

- [ ] **Step 2: Re-enable the integration tests deferred in Phase 1**

Open `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`. Change every `it.skip(/* TODO Phase 5 */, ...)` for revoke-mandate scenarios to `it(...)`. Update the assertions:

```typescript
it('revokes mandate via single UpdateItem on MandateStatus row, emits MANDATE_REVOKED', async () => {
  // Onboard tenant
  await onboarded(tenantId, userId);

  // Revoke
  await mutateRevokeMandate(tenantId, userId);

  // Assert MandateStatus row state
  const items = await getInvestorProfileItems(tenantId, userId);
  const status = items.find((i) => i.sk === 'MandateStatus');
  expect(status).toMatchObject({ status: 'REVOKED', revokedAt: expect.any(String) });

  // Assert composite InvestorProfile row UNTOUCHED (status not changed)
  const profile = items.find((i) => i.sk === 'InvestorProfile');
  expect(profile.mandate.status).toBe('ACTIVE'); // NOT REVOKED
  // Note: get-profile.fn.js merges MandateStatus into the response; this assertion
  // is on the raw row, which intentionally diverges.

  // Assert MANDATE_REVOKED event emitted; no INVESTOR_PROFILE_UPDATED
  const events = await trap.collect();
  const types = events.map((e) => e['detail-type']);
  expect(types).toContain('MANDATE_REVOKED');
  expect(types).not.toContain('INVESTOR_PROFILE_UPDATED');
});

it('rejects revoke when mandate already revoked', async () => {
  await onboarded(tenantId, userId);
  await mutateRevokeMandate(tenantId, userId);
  await expect(mutateRevokeMandate(tenantId, userId)).rejects.toThrow(/InvalidState/);
});

it('rejects revoke when MandateStatus row missing (not onboarded)', async () => {
  await expect(mutateRevokeMandate('non-existent', 'non-existent')).rejects.toThrow();
});
```

- [ ] **Step 3: Write `revoke-mandate.test.ts` resolver unit test**

Create `services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts`:

```typescript
import { request, response } from '../../../src/graphql/js-function/revoke-mandate.fn.js';

describe('revoke-mandate resolver', () => {
  const stash = { tenantId: 't1', userId: 'u1', tableName: 'inv-bff' };

  it('request: targets MandateStatus row (NOT InvestorProfile composite — avoid spurious INVESTOR_PROFILE_UPDATED)', () => {
    const op = request({ stash });
    expect(op.operation).toBe('UpdateItem');
    expect(op.key).toEqual({ pk: { S: 'InvestorProfile#t1#u1' }, sk: { S: 'MandateStatus' } });
  });

  it('request: sets status=REVOKED + revokedAt=now', () => {
    const op = request({ stash });
    expect(op.update.expression).toContain('#status = :revoked');
    expect(op.update.expression).toContain('revokedAt = :now');
    expect(op.update.expressionValues[':revoked']).toEqual({ S: 'REVOKED' });
  });

  it('request: includes attribute_exists(pk) AND status=ACCEPTED precondition', () => {
    const op = request({ stash });
    expect(op.condition.expression).toContain('attribute_exists(pk)');
    expect(op.condition.expression).toContain('#status = :active');
    expect(op.condition.expressionValues[':active']).toEqual({ S: 'ACCEPTED' });
  });

  it('response: returns the MandateStatus shape', () => {
    const result = response({
      result: { status: 'REVOKED', acceptedAt: 't0', revokedAt: 't1' },
    });
    expect(result).toEqual({ status: 'REVOKED', acceptedAt: 't0', revokedAt: 't1' });
  });

  it('response: maps ConditionalCheckFailedException to InvalidState (already-revoked guard)', () => {
    const ctx = { error: { type: 'DynamoDB:ConditionalCheckFailedException', message: '...' } };
    expect(() => response(ctx)).toThrow();
  });
});
```

- [ ] **Step 4: Run unit + integration test sets locally**

Run: `pnpm nx test investor-bff -- --testPathPattern='revoke-mandate'`
Expected: PASS for the new resolver unit test.

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js services/investor/investor-bff/test/integration/investor-bff.integration.test.ts services/investor/investor-bff/test/unit/graphql/revoke-mandate.test.ts
git commit -m "investor-bff: revokeMandate single UpdateItem on MandateStatus → MANDATE_REVOKED CDC + unit test"
```

### Task 5.2: Verify `compliance-ctrl` consumes MANDATE_REVOKED

The compliance handler was already added in Phase 3. Verify it's still wired:

- [ ] **Step 1: Confirm subscription + handler**

```bash
grep -n "MANDATE_REVOKED" services/advisory/compliance-ctrl/src/
```

Expected: at least 2 matches (Ingress eventTypes list + handler registration).

### Task 5.3: Verify `investor-ctrl` consumes MANDATE_REVOKED

Already added in Phase 4. Verify:

- [ ] **Step 1: Confirm**

```bash
grep -n "MANDATE_REVOKED" services/investor/investor-ctrl/src/
```

Expected: at least 2 matches.

### Acceptance criteria for Phase 5

- [ ] `pnpm nx run investor-bff:synth` PASSES.
- [ ] `pnpm nx test investor-bff` PASSES (including the un-skipped revoke tests' unit-test counterparts).
- [ ] No reference to `MandateRevocation` row in investor-bff/src.

---

## Phase 6 — `advisory-adpt` cross-domain forwarding rule update

**Goal:** Drop 7 old events from `fromInvestorEvents`, add 4 new (`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `MANDATE_ACCEPTED`, `MANDATE_REVOKED`). Net: 7 → 4 events forwarded.

### Task 6.1: Update `advisory-adpt` event types + stack

**Files:**
- Modify: `services/advisory/advisory-adpt/src/domain/events.ts`
- Modify: `services/advisory/advisory-adpt/src/service.stack.ts`

- [ ] **Step 1: Update `AdvisoryIngestEventTypes` in domain/events.ts**

Replace the `// From Investor` block:

```typescript
// From Investor
INVESTOR_PROFILE_CREATED: eventName('INVESTOR_PROFILE_CREATED'),
INVESTOR_PROFILE_UPDATED: eventName('INVESTOR_PROFILE_UPDATED'),
MANDATE_ACCEPTED: eventName('MANDATE_ACCEPTED'),
MANDATE_REVOKED: eventName('MANDATE_REVOKED'),
```

Removed: `GOAL_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_CREATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_CREATED`, `MANDATE_UPDATED`.

- [ ] **Step 2: Update service.stack.ts `fromInvestorEvents` array**

Open `services/advisory/advisory-adpt/src/service.stack.ts`. Replace the `fromInvestorEvents` array with:

```typescript
const fromInvestorEvents = [
  AdvisoryIngestEventTypes.INVESTOR_PROFILE_CREATED,
  AdvisoryIngestEventTypes.INVESTOR_PROFILE_UPDATED,
  AdvisoryIngestEventTypes.MANDATE_ACCEPTED,
  AdvisoryIngestEventTypes.MANDATE_REVOKED,
];
```

- [ ] **Step 3: Update CDK stack tests**

Open `services/advisory/advisory-adpt/test/service.stack.test.ts`. Find the assertion on `detail-type` for the `FromInvestor` rule. Replace the array of expected events with the 4 new ones.

- [ ] **Step 4: Update integration tests**

Open `services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts`. Replace `GOAL_UPDATED` with `INVESTOR_PROFILE_UPDATED` in the test scenarios (or add separate scenarios for each new event).

- [ ] **Step 5: Run unit tests + synth**

Run: `pnpm nx test advisory-adpt && pnpm nx run advisory-adpt:synth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-adpt/
git commit -m "advisory-adpt: forward INVESTOR_PROFILE_*+MANDATE_*; drop 7 old events"
```

### Acceptance criteria for Phase 6

- [ ] `pnpm nx test advisory-adpt` PASSES.
- [ ] `pnpm nx run advisory-adpt:synth` PASSES.
- [ ] `grep -n "MANDATE_CREATED\|MANDATE_UPDATED\|GOAL_CREATED" services/advisory/advisory-adpt/src/` returns zero matches.

---

## Phase 7 — Frontend GraphQL + e2e test updates

**Goal:** Update e2e feature tests for the new schema (`getProfile.goal`, `updateGoal(input)` w/o goalId, `revokeMandate` returning `MandateStatus`). Update `apps/e2e-feature-tests/src/helpers/fixtures.ts`. Cosmetic review of `go-live-wizard.component.ts`.

### Task 7.1: Update `update-goal.e2e.test.ts`

**Files:**
- Modify: `apps/e2e-feature-tests/src/profile/update-goal.e2e.test.ts`

- [ ] **Step 1: Read the file**

Run: `cat apps/e2e-feature-tests/src/profile/update-goal.e2e.test.ts`

- [ ] **Step 2: Replace GraphQL queries**

Change every `getGoals { ... }` to `getProfile { goal { ... } }`. Change every `updateGoal(goalId: $goalId, input: $input)` to `updateGoal(input: $input)`. Drop the `goalId` argument.

Update assertion `result.data.getGoals[0]` → `result.data.getProfile.goal`.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/src/profile/update-goal.e2e.test.ts
git commit -m "e2e: update-goal scenario uses getProfile.goal + updateGoal(input)"
```

### Task 7.2: Update `update-mandate.e2e.test.ts`

**Files:**
- Modify: `apps/e2e-feature-tests/src/profile/update-mandate.e2e.test.ts`

- [ ] **Step 1: Adapt mutation**

Update `updateMandate` mutation to use the simplified MandateInput (drop `coolDownDays`, drop the version field assertion). Read `getProfile.mandate.*` for assertions.

- [ ] **Step 2: Commit**

```bash
git add apps/e2e-feature-tests/src/profile/update-mandate.e2e.test.ts
git commit -m "e2e: update-mandate uses composite InvestorProfile.mandate"
```

### Task 7.3: Update `revoke-mandate.e2e.test.ts`

**Files:**
- Modify: `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts`

- [ ] **Step 1: Update mutation return type**

`revokeMandate` now returns `MandateStatus { status, acceptedAt, revokedAt }`. Update assertions accordingly. Add EB trap assertions for `MANDATE_REVOKED` event emission.

- [ ] **Step 2: Commit**

```bash
git add apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts
git commit -m "e2e: revoke-mandate asserts MandateStatus return + MANDATE_REVOKED event"
```

### Task 7.4: Update `fixtures.ts`

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts`

- [ ] **Step 1: Read fixtures**

Run: `grep -n "Goal\|Mandate\|RiskProfile\|InvestorProfile" apps/e2e-feature-tests/src/helpers/fixtures.ts`

- [ ] **Step 2: Update `onboarded()` helper**

If it asserts intermediate row writes (Goal#, RiskProfile, Mandate, OperatingModeRecord, AccountMode), replace with composite-row + MandateStatus assertion. Update any `getGoals`-based queries to `getProfile.goal`.

- [ ] **Step 3: Update `withDecision()` helper**

If it stubs INVESTOR_PROFILE_* events differently, regenerate. Verify it now correctly triggers a SF execution via INVESTOR_PROFILE_CREATED (instead of MANDATE_CREATED or GOAL_CREATED).

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/fixtures.ts
git commit -m "e2e: fixtures use composite InvestorProfile + MandateStatus shape"
```

### Task 7.5: Cosmetic review of `go-live-wizard.component.ts`

**Files:**
- Modify (if needed): `apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts`

- [ ] **Step 1: Read**

Run: `cat apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts | grep -i "goal\|mandate\|risk"`

- [ ] **Step 2: Update step labels if any reference the old plural shape**

If any text says "Review your goals" change to "Review your goal" (singular). If no mention, no change needed.

- [ ] **Step 3: Commit if changes were made**

```bash
git add apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts
git commit -m "investor-mfe: cosmetic step-label update for singular goal"
```

(Skip commit if no changes.)

### Task 7.6: Sweep advisory e2e tests for dropped event references

**Goal:** the inventory grep showed `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts` and `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` reference dropped event types. Update them.

**Files:**
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`
- Verify: `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts`
- Verify: `apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts`
- Verify: `apps/e2e-feature-tests/src/advisory/reject-decision.e2e.test.ts`
- Verify: `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts`
- Verify: `apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts`

- [ ] **Step 1: Inventory references**

Run: `grep -n "GOAL_CREATED\|GOAL_UPDATED\|RISK_PROFILE\|MANDATE_CREATED\|MANDATE_UPDATED\|OPERATING_MODE_SELECTED\|OPERATING_MODE_CHANGED\|WORKFLOW_TRIGGER" apps/e2e-feature-tests/src/advisory/`
Expected: matches in operating-mode-authority + first-decision + maybe reconciliation-correction.

- [ ] **Step 2: Update `operating-mode-authority.e2e.test.ts`**

This test verifies that operating mode (CONSERVATIVE/BALANCED/AGGRESSIVE) determines authority level. After collapse:
- Operating-mode changes are now triggered via `INVESTOR_PROFILE_UPDATED` (composite payload `subject.operatingMode`), NOT `OPERATING_MODE_CHANGED`.
- The decision-workflow-ctrl SF starts on `INVESTOR_PROFILE_UPDATED`.
- The cycle is exactly ONE per mode change (not the previous fan-out).

Replace any direct EB emission of `OPERATING_MODE_CHANGED` with mutating the operatingMode field via the BFF (the production path) or with directly emitting `INVESTOR_PROFILE_UPDATED` with the new mode in the subject. Update assertions on the trigger event the trap captures.

- [ ] **Step 3: Update `first-decision.e2e.test.ts`**

Find any assertions referencing `MANDATE_CREATED`/`GOAL_CREATED`/`RISK_PROFILE_CREATED` as the SF trigger and replace with `INVESTOR_PROFILE_CREATED`. Verify assertion that "decision-workflow-ctrl SF executes exactly once per onboarding" still holds (it should now hold tighter — single SF execution from a single trigger event).

- [ ] **Step 4: Verify untouched advisory tests still typecheck**

Run: `pnpm nx run e2e-feature-tests:typecheck`
Expected: PASS for all advisory e2e tests.

If `reconciliation-correction.e2e.test.ts`, `accept-decision.e2e.test.ts`, `reject-decision.e2e.test.ts`, `rebalance-on-drift.e2e.test.ts`, `view-decision-explanation.e2e.test.ts` reference dropped types via `agent-trace-trap` traps (handled in Task 7.7 below), update accordingly.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/advisory/
git commit -m "e2e: advisory scenarios use INVESTOR_PROFILE_* triggers"
```

### Task 7.7: Review `agent-trace-trap.ts` + `graphql-types.ts`

**Files:**
- Verify: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`
- Verify: `apps/e2e-feature-tests/src/helpers/graphql-types.ts`
- Verify: `apps/e2e-feature-tests/src/helpers/bff-client.ts`
- Verify: `apps/e2e-feature-tests/src/helpers/wait-for-graphql.ts`

- [ ] **Step 1: Grep for dropped event names + GraphQL field renames**

Run: `grep -n "GOAL_CREATED\|MANDATE_CREATED\|OPERATING_MODE_CHANGED\|getGoals\|goalId\|RISK_PROFILE_CREATED" apps/e2e-feature-tests/src/helpers/`
Expected: matches in some helpers — likely `agent-trace-trap.ts` (if it has trap entries for those events), `graphql-types.ts` (if it has codegen-generated types referencing the old schema), `bff-client.ts` (if it has typed query helpers).

- [ ] **Step 2: Update `agent-trace-trap.ts`**

If it has named trap entries (e.g., `mandateLifecycle`, `goalLifecycle`) keyed on dropped event types, decide:
- Drop them entirely if no test consumer remains, OR
- Rename to `investorProfileLifecycle` keyed on `INVESTOR_PROFILE_CREATED|UPDATED`

Per spec §3.3 + memory `project_advisory_pipeline_consolidation.md`, the `decisionLifecycle` trap was already removed in 2026-04-30; check no further removal is needed.

- [ ] **Step 3: Update `graphql-types.ts`**

If it has hand-written or codegen TypeScript types matching the BFF schema (Goal, Mandate, RiskProfile shapes), regenerate or update to match the new composite shape (nested under `InvestorProfile`).

If codegen is configured (e.g., `graphql-codegen.yml`), run:
```bash
pnpm nx run e2e-feature-tests:codegen
```
to regenerate from the updated `services/investor/investor-bff/src/schema.graphql`.

- [ ] **Step 4: Update `bff-client.ts`**

If it has typed mutation helpers like `updateGoalMutation(goalId, input)` change to `updateGoalMutation(input)`. If `getGoalsQuery` exists, replace with `getProfileQuery` selecting `goal { ... }`.

- [ ] **Step 5: Run full typecheck**

Run: `pnpm nx run e2e-feature-tests:typecheck && pnpm nx run e2e-feature-tests:lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/
git commit -m "e2e helpers: align traps + types + bff-client with composite InvestorProfile schema"
```

### Task 7.8: Final e2e sweep — run all e2e tests' typecheck after cascading helper changes

**Files:**
- Verify all under: `apps/e2e-feature-tests/src/`

- [ ] **Step 1: Run typecheck across the whole e2e tree**

Run: `pnpm nx run e2e-feature-tests:typecheck`
Expected: PASS. Helper renames + fixture updates may ripple into:
- `account/circuit-breaker-lifecycle.e2e.test.ts`
- `account/request-closure.e2e.test.ts`
- `funding/fund-account.e2e.test.ts`
- `funding/withdraw-cash.e2e.test.ts`
- `notifications/mark-notification-read.e2e.test.ts`

If any fail, fix in-line (most likely a dropped helper method or a renamed type).

- [ ] **Step 2: Final grep verifying no dropped names linger**

Run: `grep -rn "getGoals\|goalId\|GOAL_CREATED\|GOAL_UPDATED\|MANDATE_CREATED\|MANDATE_UPDATED\|RISK_PROFILE_CREATED\|RISK_PROFILE_UPDATED\|OPERATING_MODE_SELECTED\|OPERATING_MODE_CHANGED\|WORKFLOW_TRIGGER" apps/e2e-feature-tests/src/`
Expected: zero matches.

- [ ] **Step 3: Commit (if any cascade fixes were needed)**

```bash
git add apps/e2e-feature-tests/src/
git commit -m "e2e: cascade fixture/helper renames across remaining scenarios"
```

(Skip commit if no changes.)

### Acceptance criteria for Phase 7

- [ ] `pnpm nx run e2e-feature-tests:lint && pnpm nx run e2e-feature-tests:typecheck` PASSES (do not run e2e itself yet — see Phase 9).
- [ ] `grep -rn "getGoals\|goalId" apps/e2e-feature-tests/src/profile/` returns zero matches.
- [ ] `grep -rn "GOAL_CREATED\|MANDATE_CREATED\|MANDATE_UPDATED\|RISK_PROFILE_CREATED\|OPERATING_MODE_SELECTED\|OPERATING_MODE_CHANGED\|WORKFLOW_TRIGGER" apps/e2e-feature-tests/src/` returns zero matches across the whole e2e tree.

---

## Phase 8 — Architecture docs + service cards regeneration

**Goal:** SYSTEM-ARCHITECTURE.md §195 event-taxonomy table reflects collapsed events; SERVICE-INVENTORY.md regenerated for 6 services; flow specs updated; per-service `CLAUDE.md` cards regenerated via `audit-service` skill.

### Task 8.1: Update `SYSTEM-ARCHITECTURE.md` event taxonomy

**Files:**
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md`

- [ ] **Step 1: Read §195 (event taxonomy table)**

Run: `awk '/^### .*Event Taxonomy/,/^## /' docs/architecture/SYSTEM-ARCHITECTURE.md | head -50`

- [ ] **Step 2: Update the row for User & Mandate (and any other rows referencing dropped events)**

In the event taxonomy table:
- Replace `MANDATE_DEFINED` (typo) with `INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED`.
- Add `MANDATE_ACCEPTED, MANDATE_REVOKED` to the User & Mandate row.
- Drop `GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED` from any row that lists them.

(The §21 OQ "MANDATE_DEFINED typo" item from spec §5 is opportunistically resolved here.)

- [ ] **Step 3: Update §13 (Decision Lifecycle) trigger list**

If §13 lists the 11 trigger events for decision-workflow-ctrl, change to the 7-event list per spec §3.1.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/SYSTEM-ARCHITECTURE.md
git commit -m "docs(arch): update event taxonomy + decision-lifecycle triggers for InvestorProfile collapse"
```

### Task 8.2: Update `flows/investor-onboarding.flow.yaml`

**Files:**
- Modify: `flows/investor-onboarding.flow.yaml`

- [ ] **Step 1: Rewrite Phase 2a transactWrite items list**

Replace 7-item list with 3-item list (composite InvestorProfile + MandateStatus + conditional Deposit).

- [ ] **Step 2: Rewrite Phase 6 cross-domain forwards**

Replace `GOAL_CREATED, RISK_PROFILE_CREATED, OPERATING_MODE_SELECTED, MANDATE_CREATED` with `INVESTOR_PROFILE_CREATED, MANDATE_ACCEPTED`.

- [ ] **Step 3: Update success_criteria + failure_modes**

Adapt to the new trigger semantics (1 SF execution per onboarding, not 3-4).

- [ ] **Step 4: Run flow validation**

Run: `pnpm validate-flow flows/investor-onboarding.flow.yaml` (or whichever the validate-flow skill exposes — check the skill).

- [ ] **Step 5: Commit**

```bash
git add flows/investor-onboarding.flow.yaml
git commit -m "flow: investor-onboarding reflects InvestorProfile single-row + MandateStatus"
```

### Task 8.3: Update `flows/advisory-cycle.flow.yaml`

**Files:**
- Modify: `flows/advisory-cycle.flow.yaml`

- [ ] **Step 1: Phase 0 cross_domain list**

Replace 7-event list with 4-event (INVESTOR_PROFILE_*, MANDATE_*).

- [ ] **Step 2: Phase 1 receives list collapse**

Update SF entry from `WORKFLOW_TRIGGER_CREATED` to direct trigger event handling (the 7 spec §3.1 events).

- [ ] **Step 3: Commit**

```bash
git add flows/advisory-cycle.flow.yaml
git commit -m "flow: advisory-cycle direct EB→SF trigger list (7 events)"
```

### Task 8.4: Update `flows/incident-escalation.flow.yaml`

**Files:**
- Modify: `flows/incident-escalation.flow.yaml`

- [ ] **Step 1: Update line 84 comment**

Find the comment referencing `MANDATE_*` events. Update to current collapsed names.

- [ ] **Step 2: Commit**

```bash
git add flows/incident-escalation.flow.yaml
git commit -m "flow: incident-escalation comment update for collapsed mandate events"
```

### Task 8.5: Regenerate service cards via `audit-service` skill

**Files:**
- Modify: `services/investor/investor-bff/CLAUDE.md`
- Modify: `services/investor/dashboard-bff/CLAUDE.md`
- Modify: `services/investor/investor-ctrl/CLAUDE.md`
- Modify: `services/advisory/compliance-ctrl/CLAUDE.md`
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md`
- Modify: `services/advisory/advisory-adpt/CLAUDE.md`

- [ ] **Step 1: Regen one at a time using audit-service skill**

For each service, invoke the `audit-service` skill (run `/audit-service <serviceName>` or read `.claude/skills/audit-service/SKILL.md` and follow it).

- [ ] **Step 2: Commit per service or batched**

```bash
git add services/{investor,advisory}/{investor-bff,dashboard-bff,investor-ctrl,compliance-ctrl,decision-workflow-ctrl,advisory-adpt}/CLAUDE.md
git commit -m "docs: regenerate service cards for InvestorProfile collapse (6 services)"
```

### Task 8.6: Update `SERVICE-INVENTORY.md`

**Files:**
- Modify: `docs/architecture/SERVICE-INVENTORY.md`

- [ ] **Step 1: Update each affected service section**

For investor-bff, dashboard-bff, investor-ctrl, compliance-ctrl, decision-workflow-ctrl, advisory-adpt:
- Update "Events published" / "Events consumed" lists.
- Update "Egress shapes" count for investor-bff (9 → 6).
- Update decision-workflow-ctrl "TRIGGER_EVENT_TYPES" list.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/SERVICE-INVENTORY.md
git commit -m "docs(inventory): regenerate 6 service sections for InvestorProfile collapse"
```

### Acceptance criteria for Phase 8

- [ ] `pnpm validate-flow flows/investor-onboarding.flow.yaml` PASSES.
- [ ] `pnpm validate-flow flows/advisory-cycle.flow.yaml` PASSES.
- [ ] No reference to `MANDATE_DEFINED` in `docs/architecture/`.
- [ ] No reference to `WORKFLOW_TRIGGER_CREATED` in flow specs (was removed in Phase 2).

---

## Phase 9 — Hard cutover on dev + validation gate

**Goal:** Deploy all changed services, truncate dev investor-bff table (or scoped delete of `InvestorProfile#*` items), re-run e2e suite + 5-run Playwright e2e gate. **DESTRUCTIVE OPERATIONS — explicit user confirmation required at each step.**

### Task 9.1: Pre-deploy verification

- [ ] **Step 1: Dry-run all affected service synths**

```bash
pnpm nx run-many --target=synth --projects=investor-bff,investor-ctrl,dashboard-bff,advisory-adpt,compliance-ctrl,decision-workflow-ctrl
```
Expected: all PASS.

- [ ] **Step 2: Run all unit + service tests**

```bash
pnpm nx run-many --target=test --projects=investor-bff,investor-ctrl,dashboard-bff,advisory-adpt,compliance-ctrl,decision-workflow-ctrl,e2e-feature-tests
```
Expected: all PASS.

- [ ] **Step 3: ASK user to confirm deploy**

Stop here. Surface to user: "Phase 9 begins now. About to deploy 6 services to dev (`bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,investor-ctrl,dashboard-bff,advisory-adpt,compliance-ctrl,decision-workflow-ctrl`). Proceed?"

### Task 9.2: Deploy all changed services

- [ ] **Step 1: After explicit user confirmation, deploy**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,investor-ctrl,dashboard-bff,advisory-adpt,compliance-ctrl,decision-workflow-ctrl
```
Expected: success, all 6 stacks updated. Total time ~10-20 minutes.

- [ ] **Step 2: Verify SF EB rule + executionName via AWS CLI**

```bash
aws events list-rules --event-bus-name dev-advisory-bus --query 'Rules[?starts_with(Name, `DecisionWorkflowCtrl`)].Name'
```
Expected: a rule whose pattern matches the 7-event trigger list.

```bash
aws events describe-rule --event-bus-name dev-advisory-bus --name <rule-name> | jq -r '.EventPattern'
```
Expected: `detail-type` array contains `INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, ...`.

### Task 9.3: Truncate dev investor-bff table

- [ ] **Step 1: ASK user to confirm destructive truncate**

Stop. Surface: "About to scoped-delete every `InvestorProfile#*` item from `dev-investor-bff-table`. This is the hard cutover step (per spec §3.4). Proceed?"

- [ ] **Step 2: After explicit confirmation, scope-delete**

Run a scan + batch-delete script:

```bash
TABLE_NAME=dev-investor-bff-table
aws dynamodb scan --table-name $TABLE_NAME --projection-expression 'pk,sk' --filter-expression 'begins_with(pk, :prefix)' --expression-attribute-values '{":prefix":{"S":"InvestorProfile#"}}' --output json > /tmp/items-to-delete.json

# Then iterate batch-delete-item in chunks of 25
node tools/scripts/batch-delete.mjs $TABLE_NAME /tmp/items-to-delete.json
```

(If `tools/scripts/batch-delete.mjs` doesn't exist, write it inline as a 30-line Node script using `BatchWriteItemCommand` from `@aws-sdk/client-dynamodb`. File via `backlog-add` if scope creep.)

- [ ] **Step 3: Verify table empty (within InvestorProfile scope)**

```bash
aws dynamodb scan --table-name $TABLE_NAME --projection-expression 'pk' --filter-expression 'begins_with(pk, :prefix)' --expression-attribute-values '{":prefix":{"S":"InvestorProfile#"}}' --output json | jq '.Count'
```
Expected: `0`.

### Task 9.4: Run integration test suite against deployed dev

- [ ] **Step 1: Run service integration tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many --target=test-integration --projects=investor-bff,investor-ctrl,dashboard-bff,advisory-adpt,compliance-ctrl,decision-workflow-ctrl
```
Expected: PASS.

- [ ] **Step 2: Run e2e feature tests**

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features
```
Expected: PASS, including `update-goal.e2e.test.ts`, `update-mandate.e2e.test.ts`, `revoke-mandate.e2e.test.ts`, `advisory/operating-mode-authority.e2e.test.ts`, `advisory/first-decision.e2e.test.ts`.

### Task 9.5: 5-run Playwright e2e gate

- [ ] **Step 1: Run Playwright against deployed dev, 5 fresh users**

```bash
pnpm nx run nestfolio-e2e:e2e --runs=5
```
(Or whatever the canonical 5-run invocation is — check `apps/nestfolio-e2e/project.json` for the right script.)
Expected: 5/5 onboarding completions succeed.

- [ ] **Step 2: Verify exactly 1 SF execution per fresh user via CloudWatch**

For each tenant:

```bash
aws stepfunctions list-executions --state-machine-arn <dev-decision-workflow-ctrl-decisionstatemachine-arn> --max-items 50 | jq -r '.executions[] | select(.input | contains("'<tenantId>'")) | .name'
```

Expected: count = 1 per tenant. (The collapse turns the previous 3-execution-per-onboarding storm into 1.)

- [ ] **Step 3: Verify revocation path end-to-end**

Run a manual revocation against a deployed tenant:
- Mutate `revokeMandate` via AppSync (use `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts` as a one-shot).
- Assert in DDB: `MandateStatus.status='REVOKED'`, `revokedAt=now`.
- Assert in EB archive (or live trap): `MANDATE_REVOKED` event observed.
- Assert compliance-ctrl `MandateSnapshot.status='REVOKED'` in GuardrailPolicy table.
- Assert investor-ctrl Notification "Mandate Revoked" written.
- Assert NO `INVESTOR_PROFILE_UPDATED` event from this revocation (composite row not touched).
- Assert NO new SF execution started.

- [ ] **Step 4: Verify acceptance path during onboarding**

For a fresh tenant, post-onboarding:
- Assert MandateStatus row INSERT.
- Assert `MANDATE_ACCEPTED` event.
- Assert investor-ctrl "Investment Mandate Activated" notification.

### Acceptance criteria for Phase 9

- [ ] All 6 services deployed cleanly to dev.
- [ ] dev `dev-investor-bff-table` shows zero stale multi-row InvestorProfile data.
- [ ] All service integration tests PASS against deployed dev.
- [ ] All e2e feature tests PASS.
- [ ] Playwright 5-run: 5/5 onboarding completions; exactly 1 SF execution per fresh user.
- [ ] Manual revocation: 4 expected effects observed; 2 expected NON-effects verified.
- [ ] `audit-system` skill report shows zero drift.

---

## Plan-wide acceptance — final ship checklist

- [ ] **Phase 1-8 commits land on `main` cleanly.**
- [ ] **Phase 9 deploy + validation gate complete.**
- [ ] **`docs/BACKLOG.md` ACTIVE entry updated to "shipped" with commit refs; PARKING LOT entries (revokeMandate latent bug `53a20777`, MANDATE_UPDATED entry `677032db`) marked subsumed.**
- [ ] **5-minute boundary review of `docs/BACKLOG.md`** — re-rank PARKING LOT, promote QUEUED items if they've grown teeth, drop aged items. (Per CLAUDE.md backlog discipline.)
- [ ] **Update auto-memory:**
  - `MEMORY.md`: drop the InvestorProfile collapse ACTIVE entry; add a "shipped 2026-MM-DD" line in Recently Completed Work
  - `project_investor_profile_collapse.md`: append final ship note with commit refs + e2e validation result
  - `project_decision_workflow_stuck.md`: mark resolved (the SF stuck-at-WaitForCompliance issue is a separate workstream but the trigger-side simplification removes the misdiagnosis surface)

---

## Risks + mitigations (final)

| Risk | Mitigation |
|---|---|
| `Orchestration` construct lacks `executionNameField` prop | Phase 2 Task 2.3 Step 1 verifies; if missing, `backlog-add` + escape hatch via `CfnRule` direct manipulation |
| `event-processor` doesn't propagate CDC `previousSubject` | Phase 4 Task 4.2 Step 3 falls back to "always fire both notifications" until propagation is wired (file via `backlog-add`) |
| Direct EB→SF executionName collision in dev (replay of same eventId) | Dev hard-cutover (Phase 9.3) prevents stale eventIds from colliding; production not in scope |
| `compliance-ctrl` MandateSnapshot misses revocation if `MANDATE_REVOKED` fires before `INVESTOR_PROFILE_UPDATED` | Both events project into the same MandateSnapshot row idempotently. Per spec §9 — no race; revocation only touches MandateStatus row, so no parallel INVESTOR_PROFILE_UPDATED is emitted |
| Test rewrite scope larger than estimated | Phase-by-phase commits provide rollback granularity; if any phase blows past 50% over its estimate, halt and re-scope with user |
| Pre-existing doc drift surfaces during Phase 8 | `audit-system` skill at the end catches; file separately if found |
| `BatchGetCommand` returns items in unspecified order | Phase 1 Task 1.5 + Task 1.7 use `.find((i) => i.sk === 'InvestorProfile')` — order-independent |
| Dev table truncate Phase 9 nukes data needed by other in-flight tests | All e2e fixtures regenerate; verify `apps/e2e-feature-tests/` doesn't depend on persistent state via `grep -l "describeBeforeAll" apps/e2e-feature-tests/src/` |
