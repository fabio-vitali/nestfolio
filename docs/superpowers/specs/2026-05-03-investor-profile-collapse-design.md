# Design: InvestorProfile single-row collapse

**Date:** 2026-05-03
**Status:** Spec — pending user review before writing-plans.
**ACTIVE workstream:** see `docs/BACKLOG.md` ACTIVE.
**Pivoted from:** the tactical "Onboarding fan-out 3 → 1" entry. The fan-out is a symptom of multi-row decomposition of a single logical entity; this collapse dissolves it at root.

---

## 1. Goal

Replace `services/investor/investor-bff/`'s multi-row InvestorProfile decomposition (separate `Goal#${goalId}`, `RiskProfile`, `Mandate`, `OperatingModeRecord`, `AccountMode`, `InvestorProfile` rows per investor) with a **single composite `InvestorProfile` row per investor**, carrying nested groups for goal / mandate / riskProfile / operatingMode / accountMode.

Side-effects of the collapse (not the goal, but they fall out automatically):
- Onboarding produces ONE decision cycle (was 3 — the original BACKLOG bug).
- Per-field `_CREATED` / `_UPDATED` events (GOAL_*, MANDATE_*, RISK_PROFILE_*, OPERATING_MODE_*) collapse to `INVESTOR_PROFILE_CREATED` / `INVESTOR_PROFILE_UPDATED`.
- Dead `version: 1` scaffolding removed (set-once-never-incremented on Mandate, RiskProfile, OperatingModeRecord).
- Speculative `Goal#${goalId}` plurality removed (no spec or product flow uses >1 goal per investor).
- Half-implemented `revokeMandate` flow completed (separate PARKING LOT entry naturally subsumed).
- `MANDATE_UPDATED` PARKING LOT entry naturally subsumed (now triggers via `INVESTOR_PROFILE_UPDATED`).
- Decision-workflow-ctrl `WorkflowTrigger` row + TriggerIngress Lambda removed; SF starts directly from EB events with `executionName` dedup.

## 2. Why

**Premise verified empirically (2026-05-03):** the multi-row decomposition is **YAGNI scaffolding**, not anchored to product specs.

- **Plural Goals:** every reference to "goals" in `specifications/01-04-*.md` is generic plural ("the user's goals"). The onboarding wizard captures ONE goal. `apps/e2e-feature-tests/.../update-goal.e2e.test.ts` reads `getGoals[0]`. No multi-goal UI exists or is planned.
- **`version: 1` field on Mandate / RiskProfile / OperatingModeRecord:** literally `1` everywhere; no code increments it; no `04-governance.md` requirement for entity-version history at the BFF layer.
- **`assessedAt` on RiskProfile / `effectiveDate` + `revokedAt` on Mandate:** state markers, not history mechanism. Today's `revokeMandate` mutation does an UpdateExpression on the same row, doesn't preserve a prior version.
- **Decision Packets** are the canonical audited entity (per `SYSTEM-ARCHITECTURE.md` §10.1) and are properly versioned via separate INSERT/UPDATE events on a dedicated row. The InvestorProfile multi-row pattern is the **anomaly** that doesn't follow this.

**CQRS-correct:** a BFF is a read model + command handler. Audit / history is a different read model with different access patterns (point-in-time, immutable append, retention) and belongs to a future audit-projection service (`docs/architecture/SYSTEM-ARCHITECTURE.md` §11 codifies single-writer per row + idempotency, which the collapse continues to honor).

## 3. Settled design decisions

### 3.1 (Q1) Trigger path — direct EB → SF with `executionName` dedup

`decision-workflow-ctrl`'s `Orchestration.triggers` prop is rewired to subscribe **directly** to **7 events**:
- `INVESTOR_PROFILE_CREATED` (new initial-cycle trigger; emitted once per investor on the row's CDC INSERT)
- `INVESTOR_PROFILE_UPDATED` (new re-cycle trigger; emitted on every profile change)
- `PORTFOLIO_DRIFT_DETECTED` (unchanged)
- `ORDER_FILLED` (unchanged)
- `ORDER_REJECTED` (unchanged)
- `ORDER_CANCELLED` (unchanged)
- `DEPOSIT_DETECTED` (unchanged)

Note: `MANDATE_REVOKED` is intentionally NOT in this list — see §3.3 ("revocation is a stop-deciding signal, not a decide-what-to-do trigger"). It's consumed by `compliance-ctrl` only.

The EB rule targets `SF.StartExecution` directly with `executionName = ${event.id}`. AWS Step Functions rejects duplicate `StartExecution` calls with the same `executionName` within 90 days — **stronger dedup than today's DDB conditional write** (works across redelivery, replay, cross-region retries).

**Removed:**
- `WorkflowTrigger` DDB entity (entirely).
- `TriggerIngress` Lambda + SQS queue + DLQ.
- `WORKFLOW_TRIGGER_CREATED` / `WORKFLOW_TRIGGER_UPDATED` event types (no consumers besides today's SF wiring; verified via grep).
- The `triggerHandler` in `decision-workflow-ctrl/src/handlers/event-listener.ts` and the `materializeToTable` invocation for it.

**Validation:** the `libs/event-processor/src/pipelines/resume-state-machine.ts` pattern (used by SF callbacks) confirms the canonical "events drive SF entry / resume directly" pattern. Direct EB→SF for entry is symmetric with direct EB→SF for resume.

**No diff-gate.** Per the YAGNI argument settled during brainstorm: every InvestorProfile field today is trigger-relevant (goal, riskProfile, mandate, operatingMode, accountMode, executionMode-via-go-live). If a future non-trigger field is added (nickname, marketing prefs), diff-gating gets added then.

### 3.2 (Q2) Event payload shape — nested groups

```jsonc
{
  "id": "<event uuid>",
  "type": "INVESTOR_PROFILE_UPDATED",
  "timestamp": "2026-05-03T12:34:56.789Z",
  "source": "investor-bus@investor-bff",
  "subject": {
    "tenantId": "...",
    "userId": "...",
    "region": "us-east-1",
    "email": "...",
    "operatingMode": "BALANCED",
    "accountMode": { "mode": "simulation", "capitalAmount": 0, "currency": "EUR" },
    "goal": {
      "objective": "RETIREMENT",
      "timeHorizonMonths": 240,
      "targetAmountCents": 1000000_00,
      "currency": "EUR",
      "targetReturn": 0
    },
    "riskProfile": {
      "score": 34,
      "band": { "minEquity": 0.3, "maxEquity": 0.6 },
      "toleranceResponse": "cautious",
      "experienceLevel": "beginner"
    },
    "mandate": {
      "mandateId": "<uuid>",
      "level": "ADVISORY",
      "status": "ACTIVE",          // see §3.3
      "monthlyTurnoverCapPercent": 25,
      "maxSingleTradePercent": 6,
      "equityRiskBandPercent": 60,
      "driftTriggerPercent": 4,
      "singleEtfConcentrationPercent": 30,
      "drawdownCircuitBreakerPercent": 12,
      "rebalanceCadence": "QUARTERLY",
      "effectiveDate": "...",
      "revokedAt": null            // ISO timestamp when status='REVOKED'
    },
    "onboardingCompletedAt": "..."
  },
  "context": {
    "tenantId": "...",
    "userId": "...",
    "region": "us-east-1"
  }
}
```

Rationale: nested groups preserve human readability of payloads, mirror the existing `MandateSnapshot` shape in `compliance-ctrl/src/rules/rule-engine.ts:7`, keep diff-detection per-group rather than per-flat-field, and don't bloat field names with prefixes (`mandateMonthlyTurnoverCapPercent` etc.).

### 3.3 (Q3) Mandate revocation — distinct event, denormalized state

User insight (verified): revocation is a **distinct semantic action**, not a field check. The current code already half-implements this pattern (`MandateRevocation` __typename + `MANDATE_REVOKED` event type both exist) but the wiring is incomplete (the row is written but the event is never emitted; the InvestorProfile mandate state is never updated to reflect revocation).

**Design completes the existing intent:**

- **`InvestorProfile.mandate.status: 'ACTIVE' | 'REVOKED'`** + `mandate.revokedAt: ISO | null` — denormalized current-state on the composite row, for fast single-row frontend reads ("is my mandate active right now?" answers from one DDB read, no event-history scan).
- **`MandateRevocation` stays as a separate sibling row** (`pk = InvestorProfile#${tenantId}#${userId}`, `sk = MandateRevocation#${autoId}`, `__typename = 'MandateRevocation'`). It's an **event row**, not state — preserves audit trail.
- **Egress eventTypes maps `'MandateRevocation': { insert: MANDATE_REVOKED }`** — closes the latent dead-code gap (event type already exists in `domain/events.ts` but isn't wired today).
- **`revoke-mandate.fn.js` rewritten as a 3-row TransactWriteItems:**
  1. UpdateItem on the InvestorProfile composite row: `SET mandate.status = 'REVOKED', mandate.revokedAt = :now`.
  2. PutItem on a new `MandateRevocation` row.
  3. PutItem on an `EditEvent` row (preserves today's audit log).
- **`compliance-ctrl` subscribes to `MANDATE_REVOKED`** (new explicit handler). On receipt, it sets a `MandateSnapshot.status = 'REVOKED'` field in its own GuardrailPolicy table. The rule engine (`AuthorityResolver` / `MandateValidator`) gates on `mandate.status === 'REVOKED'` and returns `BLOCKED` with violation `MANDATE_REVOKED` (parallel to today's `MANDATE_MISSING` fallback).
- **`decision-workflow-ctrl` does NOT subscribe to `MANDATE_REVOKED` as a trigger** — revocation is a "stop deciding" signal, not a "decide what to do" trigger. The compliance gate handles it for any in-flight cycles.
- **Topology consequence:** revocation now produces THREE events fanning out from one transactWrite — `INVESTOR_PROFILE_UPDATED` (composite row UpdateItem) + `MANDATE_REVOKED` (MandateRevocation row INSERT) + (no event from EditEvent — it's an audit log, not in Egress map). `decision-workflow-ctrl` receives `INVESTOR_PROFILE_UPDATED` → starts a cycle → that cycle reaches compliance → compliance has already received the parallel `MANDATE_REVOKED` and blocks. No race risk because the cycle is 30–75s of LLM work; the parallel `MANDATE_REVOKED` lands in compliance well before the cycle reaches compliance gate.

### 3.4 (Q4) Dev migration — hard cutover

Per `feedback_no_deprecation.md` ("dev deployment is disposable, breaking changes free"):

1. Ship the collapse code.
2. Truncate the `investor-bff` DynamoDB table on dev (or just `pk`-scoped delete of all `InvestorProfile#*` items).
3. Re-onboard test tenants as part of the validation gate (e2e fixtures handle creation).

Zero throwaway code. No migration Lambda.

## 4. Architecture changes by service

### 4.1 `services/investor/investor-bff` — primary impact

**Schema (`src/schema.graphql`):**
- `getGoals: [Goal!]!` → `getProfile.goal: Goal!` (singular field on existing `getProfile: InvestorProfile!`).
- `Goal`, `RiskProfile`, `Mandate`, `OperatingMode` types collapse into nested fields on `InvestorProfile`.
- `updateGoal(goalId: ID!, input: GoalInput!)` → `updateGoal(input: GoalInput!)` (no goalId — there's only one).
- `updateMandate`, `revokeMandate` mutations preserved with simplified return types.

**`src/transforms/onboarding-completed.ts`:** `transactWrite` collapses from 7 entities to 2 (composite InvestorProfile + conditional Deposit).

**`src/repositories/investor-profile.repository.ts`:** method signatures change (setGoal/getGoals/updateGoal/grantMandate/revokeMandate/setOperatingMode all operate on the composite row).

**`src/graphql/js-function/*.fn.js`:** `update-goal.fn.js`, `update-mandate.fn.js`, `revoke-mandate.fn.js`, `set-operating-mode.fn.js` rewritten to UpdateItem on the composite row.

**`src/service.stack.ts` Egress eventTypes map:** collapses from 9 shapes to 5:
```
'InvestorProfile': { insert: INVESTOR_PROFILE_CREATED, modify: INVESTOR_PROFILE_UPDATED }
'MandateRevocation': { insert: MANDATE_REVOKED }                                              // NEW — closes latent gap
'Deposit': { insert: DEPOSIT_INITIATED, modify: DEPOSIT_UPDATED }
'Withdrawal': { insert: WITHDRAWAL_REQUESTED, modify: WITHDRAWAL_UPDATED }
'ExecutionModeChange': { insert: EXECUTION_MODE_CHANGED, modify: EXECUTION_MODE_CHANGE_UPDATED }
'Notification': { modify: NOTIFICATION_READ }
```

**`src/domain/events.ts`:** removes Goal/RiskProfile/Mandate/OperatingMode `_CREATED` + `_UPDATED` event names (8 total). Keeps `INVESTOR_PROFILE_CREATED`/`UPDATED`, `MANDATE_REVOKED`, others. `INVESTOR_PROFILE_CREATED` + `INVESTOR_PROFILE_UPDATED` were already declared (just unused as triggers — now load-bearing).

### 4.2 `services/investor/dashboard-bff`

**`src/handlers/event-listener.ts`:** subscriptions change from 4 events (`GOAL_CREATED`, `RISK_PROFILE_CREATED`, `OPERATING_MODE_SELECTED`, `OPERATING_MODE_CHANGED`) to 2 (`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`).

**`src/transforms/investor-snapshot.ts`:** switch-on-event-type collapses to one branch reading the composite payload's `goal.objective`, `riskProfile.score`, `operatingMode`. No diff-detection needed (snapshot is idempotent overwrite).

### 4.3 `services/investor/investor-ctrl` — notification redesign (Path A)

Per deep-review Track 2: implement diff-detection in the consumer.

**`src/handlers/event-listener.ts`:** subscriptions change from 14 events to ~12 (drop `MANDATE_CREATED`, `GOAL_UPDATED`, `OPERATING_MODE_CHANGED`; add `INVESTOR_PROFILE_UPDATED`, `MANDATE_REVOKED`).

**`src/services/notification-lifecycle.service.ts`:** receives `INVESTOR_PROFILE_UPDATED` with NewImage + OldImage; derives which semantic notifications apply by diffing nested groups:
- `OldImage.mandate == null && NewImage.mandate != null` → "Investment Mandate Activated" notification
- `OldImage.goal?.objective !== NewImage.goal?.objective` (or any `goal.*` field) → "Goal Updated" notification
- `OldImage.operatingMode !== NewImage.operatingMode` → "Operating Mode Changed" notification
- `INVESTOR_PROFILE_CREATED` → no derivation needed; `ONBOARDING_COMPLETED` already fires "Welcome to Nestfolio"
- `MANDATE_REVOKED` → new "Mandate Revoked" notification (event-driven, not field-driven)

Existing dedup (`notificationId = eventId`) extends to `notificationId = ${eventId}:${derivedField}` to allow one composite event to fan out multiple notifications without duplicate suppression.

Estimated +80–120 LOC (per Track 2 estimate). Existing precedent for field-diff-gating: `dashboard-publisher.ts` `whenChanged` pattern in `broadcastFromStream`.

### 4.4 `services/advisory/compliance-ctrl`

**`src/handlers/event-listener.ts`:** `processMandateEvent` resubscribes from `MANDATE_CREATED`/`MANDATE_UPDATED`/`OPERATING_MODE_CHANGED` to `INVESTOR_PROFILE_CREATED`/`INVESTOR_PROFILE_UPDATED`. Re-projects `MandateSnapshot` from the new payload's `subject.mandate.*` + `subject.operatingMode`. Idempotent re-write on every profile change.

NEW handler for `MANDATE_REVOKED`: sets `MandateSnapshot.status = 'REVOKED'` in GuardrailPolicy table. Rule engine reads this and gates accordingly.

### 4.5 `services/advisory/decision-workflow-ctrl`

**`src/service.stack.ts`:** `Orchestration.triggers` prop receives the new 7-event list (per §3.1): `INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`. EB rule pattern updated. `executionName` derivation set to `${event.id}` for SF idempotency.

**`src/handlers/event-listener.ts`:** **deleted entirely** (no more triggerHandler).

**`src/domain/events.ts`:** `TRIGGER_EVENT_TYPES` constant removed (no more materializeToTable). `WORKFLOW_TRIGGER_CREATED` / `WORKFLOW_TRIGGER_UPDATED` event names removed.

**Egress eventTypes map:** drops `'WorkflowTrigger'` mapping; keeps `'DecisionPacket'` + `'AgentOutput'`.

### 4.6 `services/advisory/advisory-adpt`

**`src/service.stack.ts` `fromInvestorEvents` array:** drops `GOAL_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_CREATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_CREATED`, `MANDATE_UPDATED` (7 events). Adds `INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `MANDATE_REVOKED` (3 events). Net: 7 → 3 events forwarded from InvestorBus.

### 4.7 Frontend (per Track 1 finding: minimal impact)

- `apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts` — review cosmetic step labels (no data binding to migrate).
- `apps/e2e-feature-tests/src/profile/update-goal.e2e.test.ts` — rewrite GraphQL queries from `getGoals` → `getProfile.goal`.
- `apps/e2e-feature-tests/src/profile/update-mandate.e2e.test.ts` — rewrite mutation signature.
- `apps/e2e-feature-tests/src/helpers/fixtures.ts` — update `onboarded()` + `withDecision()` helpers.
- No production MFE component touches Goal/RiskProfile/Mandate types directly (verified).

### 4.8 Architecture docs

- `docs/architecture/SYSTEM-ARCHITECTURE.md` §195 event-taxonomy table updated. Pre-existing typo `MANDATE_DEFINED` → `MANDATE_CREATED` (or `INVESTOR_PROFILE_CREATED` post-collapse). §13 unchanged.
- `docs/architecture/SERVICE-INVENTORY.md`: 5 service sections regenerated via `audit-service` skill (investor-bff, dashboard-bff, investor-ctrl, compliance-ctrl, decision-workflow-ctrl, advisory-adpt).
- `flows/investor-onboarding.flow.yaml` + `flows/advisory-cycle.flow.yaml` rewritten to reflect collapsed events. `flows/incident-escalation.flow.yaml` line 84 comment updated. `flows/portfolio-rebalance.flow.yaml` no change.
- Per-service `CLAUDE.md` cards regenerated.

## 5. Out of scope (file-and-continue if surfaced)

- **Future audit-projection service** for entity-version history. Becomes its own workstream IF/WHEN regulatory or compliance need is articulated.
- **Future multi-goal product feature.** Would reintroduce a `Goal` collection with concrete requirements driving the schema.
- **The 147 stuck SF executions cleanup** (separate QUEUED entry — depends on Step 8/10 fix, not this collapse).
- **Account-state lifecycle redesign** (read-only / closed account states gated across execution-ctrl + broker-ctrl). Mentioned as Q3 option C but explicitly out.
- **`MANDATE_DEFINED` typo fix in SYSTEM-ARCHITECTURE.md §195** — fix opportunistically as part of this work since we're touching the doc anyway.

## 6. Validation gate (Done-when)

1. `pnpm nx run-many --target=test --projects=investor-bff,dashboard-bff,investor-ctrl,compliance-ctrl,decision-workflow-ctrl,advisory-adpt` passes.
2. `pnpm nx run-many --target=test-integration --projects=...` passes against deployed dev.
3. E2E feature tests pass: `apps/e2e-feature-tests/src/` full suite (especially `profile/update-goal.e2e.test.ts`, `profile/update-mandate.e2e.test.ts`, `profile/revoke-mandate.e2e.test.ts`, `advisory/operating-mode-authority.e2e.test.ts`, `advisory/first-decision.e2e.test.ts`).
4. Playwright e2e: 5-run gate via `apps/nestfolio-e2e` against deployed dev — 5/5 onboarding completions produce **exactly 1 SF execution** in `dev-decision-workflow-ctrl-decisionstatemachine` per fresh user (CloudWatch verification).
5. Hard cutover verified: dev `investor-bff` table contains zero stale multi-row InvestorProfile data (all rows are composite shape).
6. Revocation path verified: `revokeMandate` mutation produces (a) UpdateItem on InvestorProfile setting `mandate.status='REVOKED'`, (b) MandateRevocation row INSERT, (c) `MANDATE_REVOKED` event observed on InvestorBus, (d) compliance-ctrl GuardrailPolicy MandateSnapshot.status updated, (e) subsequent decision cycle (if any triggered post-revocation) reaches compliance gate and is BLOCKED with `MANDATE_REVOKED` violation.
7. Architecture docs updated. `audit-system` skill run reports zero drift.

## 7. Estimated effort

Per deep-review synthesis: **62–96 hours total** (~1.5–2.5 weeks of focused work).

| Bucket | Hours |
|---|---|
| Backend production code (investor-bff repo + transforms + Egress + 4 consumer subscriptions + decision-workflow direct EB→SF rewire) | 10–14 |
| Notification-lifecycle redesign (Path A diff-detection) | 6–10 |
| Test rewrites (high-risk 4 files: investor-bff.integration ×986LOC; decision-workflow-ctrl.integration ×500LOC; fixtures.ts; investor-profile.repository.test.ts) | 25–35 |
| Test rewrites (remaining 22 files, mechanical) | 12–18 |
| Frontend (e2e tests + 1 cosmetic component) | 4–8 |
| Architecture docs + 5 service-card regens | 3–5 |
| Validation gate on dev (5-run e2e) | 4–8 |
| **Total** | **62–96 hours** |

## 8. Implementation phasing (high-level — formal plan via writing-plans)

1. **Phase 1 — Schema + repository + transforms (investor-bff alone, behind a feature flag if needed).** Rewrite `onboarding-completed.ts`, `investor-profile.repository.ts`, GraphQL schema, `*.fn.js` resolvers. Update Egress map. Write composite `INVESTOR_PROFILE_CREATED` / `UPDATED` events. Unit tests rewritten in lockstep.
2. **Phase 2 — Direct EB → SF in decision-workflow-ctrl.** Remove WorkflowTrigger materialization; rewire `Orchestration.triggers` to subscribe to INVESTOR_PROFILE_* + the 5 unchanged cross-domain triggers; add `executionName=${event.id}` for dedup.
3. **Phase 3 — Compliance + dashboard-bff consumers re-subscribe.** Update event-listener subscriptions; re-project from new payload shape.
4. **Phase 4 — Notification-lifecycle redesign.** Implement Path A diff-detection. Add `MANDATE_REVOKED` handler.
5. **Phase 5 — `revokeMandate` 3-row transactWrite + Egress mapping for MandateRevocation.** Closes latent gap.
6. **Phase 6 — advisory-adpt forwarding rule update.** Drop 7 old events, add 3 new.
7. **Phase 7 — Frontend GraphQL + e2e test updates.** Singular `getProfile.goal`, `updateGoal` without goalId.
8. **Phase 8 — Architecture docs + service cards regenerated.**
9. **Phase 9 — Hard cutover on dev: truncate investor-bff table, re-onboard test tenants, run full validation gate.**

## 9. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Notification diff-detection mishandles null OldImage on INSERT | Explicit null-guard tests + treat OldImage absence as "all fields nil" |
| Direct EB→SF executionName collision in dev (replay of same eventId) | Dev hard-cutover mitigates; production not in scope |
| `compliance-ctrl` MandateSnapshot misses revocation if `MANDATE_REVOKED` fires before `INVESTOR_PROFILE_UPDATED` (same transactWrite, undefined CDC ordering) | Both events project into the same MandateSnapshot row idempotently; either event arriving first writes a consistent snapshot. Revocation handler explicitly sets `status='REVOKED'`; `INVESTOR_PROFILE_UPDATED` handler reads `mandate.status` from payload (already 'REVOKED' per the synchronous transactWrite). No race. |
| Test rewrite scope larger than estimated | Tests inventory was empirical (Track 4 produced numeric counts); estimate has a 50% upper-bound buffer |
| Pre-existing doc drift surfaces during arch-docs updates | `MANDATE_DEFINED` typo already known. Run `audit-system` skill at the end to catch any others; file separately if found. |

## 10. References

- Deep-review synthesis: `docs/superpowers/specs/2026-05-03-investor-profile-collapse-deep-review.md` (committed `6404b0b4`)
- BACKLOG ACTIVE entry: `docs/BACKLOG.md`
- Latent revoke bug: PARKING LOT entry filed 2026-05-03 (commit `53a20777`)
- `MANDATE_UPDATED` PARKING LOT entry: filed 2026-05-03 (commit `677032db`) — naturally subsumed by this collapse
- `docs/architecture/SYSTEM-ARCHITECTURE.md` §11 (Idempotency), §13 (Decision Lifecycle), §18 (Cross-Domain Routing)
- `docs/architecture/SERVICE-INVENTORY.md` per-service sections (investor-bff, dashboard-bff, investor-ctrl, compliance-ctrl, decision-workflow-ctrl, advisory-adpt)
- `flows/investor-onboarding.flow.yaml`, `flows/advisory-cycle.flow.yaml`
- `feedback_no_deprecation.md` (auto-memory) — disposable dev rationale for hard cutover
