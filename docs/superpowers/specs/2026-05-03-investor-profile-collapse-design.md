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

### 3.3 (Q3) Mandate lifecycle — separate `MandateStatus` row, symmetric INSERT/MODIFY events

**Verified premises (2026-05-03):**
- No revoke-mandate CTA exists in any MFE (grep across all 5 MFEs: zero hits). Only caller of the `revokeMandate` mutation is `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts`. Total design freedom.
- AppSync JS resolver patterns in the codebase are mature and capable (18 resolvers across `investor-bff` + `advisory-bff`). Standard `operation: 'UpdateItem'` + `attribute_exists` condition pattern handles everything we need. No Lambda Resolver needed.
- Today's half-implementation (writes `MandateRevocation` row + `EditEvent` row, never updates Mandate row's `revokedAt`, never emits `MANDATE_REVOKED` because the row isn't mapped in Egress) is dead-letter scaffolding — clean slate.

**Design — `MandateStatus` row owns the lifecycle:**

- **One row per investor for mandate lifecycle:** `pk = InvestorProfile#${tenantId}#${userId}`, `sk = 'MandateStatus'`, `__typename = 'MandateStatus'`. Fields: `{ status: 'ACCEPTED' | 'REVOKED', acceptedAt: ISO, revokedAt: ISO | null, tenantId, userId, region }`.
- **INSERT during onboarding** (added to `onboarding-completed.ts` transactWrite as item N+1): `Put { status: 'ACCEPTED', acceptedAt: now, revokedAt: null }`. CDC fires `MANDATE_ACCEPTED`.
- **MODIFY on revocation** (in rewritten `revoke-mandate.fn.js`): single `UpdateItem` `SET status = 'REVOKED', revokedAt = :now WHERE attribute_exists(pk)`. ~10 LOC. CDC fires `MANDATE_REVOKED`.
- **Egress map: `'MandateStatus': { insert: MANDATE_ACCEPTED, modify: MANDATE_REVOKED }`** — ONE LINE wires both lifecycle events.
- **Mandate config fields** (level, monthlyTurnoverCapPercent, maxSingleTradePercent, etc.) **stay nested under `InvestorProfile.mandate.*`** in the composite row. Status concern lives separately from config concern — different lifecycle, different update cadence.
- **`get-profile.fn.js` extended** to use `ddb.query({ key: { pk: { eq: ... } } })` returning the whole item collection (composite InvestorProfile + MandateStatus); response composes `mandate.status` from MandateStatus row (in addition to mandate.* config from composite). Same Query, no extra DDB call, no extra latency. Existing `get-goals.fn.js` already uses this Query pattern.
- **`compliance-ctrl` subscribes to `MANDATE_REVOKED`** (new handler) — sets `MandateSnapshot.status = 'REVOKED'` in its GuardrailPolicy table. The rule engine gates on `mandate.status === 'REVOKED'` and returns `BLOCKED` with violation `MANDATE_REVOKED`. NO need to subscribe to `MANDATE_ACCEPTED` (mandate config arrives via INVESTOR_PROFILE_CREATED → MandateSnapshot projection — status defaults to ACTIVE/ACCEPTED).
- **`investor-ctrl` notifications subscribe to `MANDATE_ACCEPTED`** for "Investment Mandate Activated" copy (replaces today's awkward MANDATE_CREATED trigger). Subscribes to `MANDATE_REVOKED` for new "Mandate Revoked" copy.
- **`decision-workflow-ctrl` does NOT subscribe to `MANDATE_*` events as triggers** — mandate lifecycle is a compliance concern, not a "decide what to do" signal. The compliance gate handles it for any in-flight cycles triggered by `INVESTOR_PROFILE_*`.
- **`EditEvent` row dropped from revoke-mandate.fn.js** — speculative audit nothing consumes today. If a generic edit-event log is needed later, reintroduce as a separate workstream.

**What this design loses vs the alternatives:**
- Per-revocation DDB audit rows (each revocation overwrites the same MandateStatus row). EB events archive preserves immutable lifecycle history; consistent with `04-governance.md`'s focus on Decision Packets as the audit anchor, not profile entities.
- "Re-acceptance" lifecycle (REVOKED → ACCEPTED) is not naturally expressible — the Egress `modify: MANDATE_REVOKED` mapping assumes one-way revocation. If re-acceptance becomes a real product flow later, refactor to two separate `MandateAccepted` + `MandateRevoked` event-row types then. YAGNI today.

**Topology consequence:** revocation produces ONE event from one resolver write — `MANDATE_REVOKED` from MandateStatus row CDC MODIFY. No fan-out from the resolver. The composite InvestorProfile row is NOT touched by revocation (only its sibling MandateStatus is) — so no spurious `INVESTOR_PROFILE_UPDATED` is fired, decision-workflow-ctrl doesn't get triggered, no LLM cycle wasted reasoning about a profile that just got revoked. Compliance handles in-flight cycles (started before revocation) at the gate.

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

**`src/service.stack.ts` Egress eventTypes map:** collapses from 9 shapes to 6:
```
'InvestorProfile': { insert: INVESTOR_PROFILE_CREATED, modify: INVESTOR_PROFILE_UPDATED }
'MandateStatus':   { insert: MANDATE_ACCEPTED,         modify: MANDATE_REVOKED }            // NEW — symmetric lifecycle
'Deposit':         { insert: DEPOSIT_INITIATED,        modify: DEPOSIT_UPDATED }
'Withdrawal':      { insert: WITHDRAWAL_REQUESTED,     modify: WITHDRAWAL_UPDATED }
'ExecutionModeChange': { insert: EXECUTION_MODE_CHANGED, modify: EXECUTION_MODE_CHANGE_UPDATED }
'Notification':    { modify: NOTIFICATION_READ }
```

(Old `MandateRevocation` row + `EditEvent` row both dropped from `revoke-mandate.fn.js`.)

**`src/domain/events.ts`:** removes Goal/RiskProfile/Mandate/OperatingMode `_CREATED` + `_UPDATED` event names (8 total). Keeps `INVESTOR_PROFILE_CREATED`/`UPDATED`, `MANDATE_REVOKED` (newly load-bearing), adds `MANDATE_ACCEPTED` (new). `INVESTOR_PROFILE_CREATED` + `INVESTOR_PROFILE_UPDATED` + `MANDATE_REVOKED` were already declared (just unused — now load-bearing).

### 4.2 `services/investor/dashboard-bff`

**`src/handlers/event-listener.ts`:** subscriptions change from 4 events (`GOAL_CREATED`, `RISK_PROFILE_CREATED`, `OPERATING_MODE_SELECTED`, `OPERATING_MODE_CHANGED`) to 2 (`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`).

**`src/transforms/investor-snapshot.ts`:** switch-on-event-type collapses to one branch reading the composite payload's `goal.objective`, `riskProfile.score`, `operatingMode`. No diff-detection needed (snapshot is idempotent overwrite).

### 4.3 `services/investor/investor-ctrl` — notification redesign (hybrid: dedicated lifecycle events + diff-detection only where needed)

Per the §3.3 MandateStatus design, the **mandate lifecycle notifications come from dedicated events** — no diff-detection needed:

- `MANDATE_ACCEPTED` → "Investment Mandate Activated" notification (replaces today's MANDATE_CREATED trigger).
- `MANDATE_REVOKED` → new "Mandate Revoked" notification.

For the **remaining notifications** that still derive from generic profile updates, `INVESTOR_PROFILE_UPDATED` diff-detection is needed (per deep-review Track 2 Path A):

- `OldImage.goal?.objective !== NewImage.goal?.objective` (or any `goal.*` field) → "Goal Updated" notification.
- `OldImage.operatingMode !== NewImage.operatingMode` → "Operating Mode Changed" notification.

Other event subscriptions unchanged: `ONBOARDING_COMPLETED` → "Welcome to Nestfolio", `DEPOSIT_INITIATED`, `DECISION_APPROVED`, `ORDER_FILLED`.

**`src/handlers/event-listener.ts`:** subscriptions change from 14 events to 13 (drop `MANDATE_CREATED`, `GOAL_UPDATED`, `OPERATING_MODE_CHANGED`; add `MANDATE_ACCEPTED`, `MANDATE_REVOKED`, `INVESTOR_PROFILE_UPDATED`).

**`src/services/notification-lifecycle.service.ts`:** the `getNotificationContent()` map gains `MANDATE_ACCEPTED` + `MANDATE_REVOKED` entries (drops `MANDATE_CREATED`). The `INVESTOR_PROFILE_UPDATED` handler derives notifications via diff-detection only for goal/operatingMode (NOT mandate — covered by dedicated events).

Existing dedup (`notificationId = eventId`) extends to `notificationId = ${eventId}:${derivedField}` for composite-event-derived notifications.

**Estimated +50–80 LOC** (smaller than original Track 2 estimate of 80-120 because mandate lifecycle bypasses the diff path). Existing precedent for field-diff-gating: `dashboard-publisher.ts` `whenChanged` pattern in `broadcastFromStream`.

### 4.4 `services/advisory/compliance-ctrl`

**`src/handlers/event-listener.ts`:** `processMandateEvent` resubscribes from `MANDATE_CREATED`/`MANDATE_UPDATED`/`OPERATING_MODE_CHANGED` to `INVESTOR_PROFILE_CREATED`/`INVESTOR_PROFILE_UPDATED`. Re-projects `MandateSnapshot` from the new payload's `subject.mandate.*` + `subject.operatingMode`. Idempotent re-write on every profile change. Default `status: 'ACCEPTED'` written on every projection (lifecycle-status updates handled separately).

NEW handler for `MANDATE_REVOKED`: minimal handler that sets `MandateSnapshot.status = 'REVOKED'` in GuardrailPolicy table (single UpdateItem with `attribute_exists` condition). Rule engine reads `status` field and gates accordingly (`AuthorityResolver` returns `BLOCKED` with violation `MANDATE_REVOKED` when `status === 'REVOKED'`).

NO subscription to `MANDATE_ACCEPTED` — the parallel `INVESTOR_PROFILE_CREATED` event during onboarding already projects the mandate config + defaults `status: 'ACCEPTED'`. MANDATE_ACCEPTED is consumed only by `investor-ctrl` for notifications.

### 4.5 `services/advisory/decision-workflow-ctrl`

**`src/service.stack.ts`:** `Orchestration.triggers` prop receives the new 7-event list (per §3.1): `INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`. EB rule pattern updated. `executionName` derivation set to `${event.id}` for SF idempotency.

**`src/handlers/event-listener.ts`:** **deleted entirely** (no more triggerHandler).

**`src/domain/events.ts`:** `TRIGGER_EVENT_TYPES` constant removed (no more materializeToTable). `WORKFLOW_TRIGGER_CREATED` / `WORKFLOW_TRIGGER_UPDATED` event names removed.

**Egress eventTypes map:** drops `'WorkflowTrigger'` mapping; keeps `'DecisionPacket'` + `'AgentOutput'`.

### 4.6 `services/advisory/advisory-adpt`

**`src/service.stack.ts` `fromInvestorEvents` array:** drops `GOAL_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_CREATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED`, `MANDATE_CREATED`, `MANDATE_UPDATED` (7 events). Adds `INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `MANDATE_ACCEPTED`, `MANDATE_REVOKED` (4 events). Net: 7 → 4 events forwarded from InvestorBus.

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
6. Revocation path verified: `revokeMandate` mutation produces (a) single UpdateItem on MandateStatus row setting `status='REVOKED', revokedAt=now`, (b) `MANDATE_REVOKED` event observed on InvestorBus via CDC MODIFY, (c) compliance-ctrl GuardrailPolicy MandateSnapshot.status updated to 'REVOKED', (d) `investor-ctrl` fires "Mandate Revoked" notification, (e) `decision-workflow-ctrl` does NOT trigger a cycle (no INVESTOR_PROFILE_UPDATED fires — composite row untouched), (f) any in-flight decision cycle reaches compliance gate and is BLOCKED with `MANDATE_REVOKED` violation.
7. Acceptance path verified: onboarding produces a MandateStatus row INSERT → `MANDATE_ACCEPTED` event observed on InvestorBus → `investor-ctrl` fires "Investment Mandate Activated" notification (no diff-detection involved).
8. Architecture docs updated. `audit-system` skill run reports zero drift.

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
5. **Phase 5 — `revokeMandate` single-UpdateItem on MandateStatus row + `MandateStatus` Egress mapping (`MANDATE_ACCEPTED`/`MANDATE_REVOKED`).** Drop legacy `MandateRevocation` + `EditEvent` writes. Closes latent gap.
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
