# Design: Self-contained `RECOMMENDATION_PROPOSED` (drop the compliance-ctrl mandate projection)

**Date:** 2026-05-05
**Status:** Spec — pending user review before writing-plans.
**Triggered by:** debugging the compliance-ctrl integration test flake (resolved 2026-05-05, commits `69e781cb`..`f06a87f5`). The fix landed a `ConsistentRead` band-aid on `getMandateSnapshot`; this spec removes the underlying design coupling that made `ConsistentRead` necessary.

---

## 1. Goal

Remove the cross-event-stream coupling at the heart of compliance-ctrl by making `RECOMMENDATION_PROPOSED` a **self-contained event**: it carries the full mandate snapshot in its subject. compliance-ctrl becomes a pure rule-engine consumer with **zero DDB reads on the hot path**.

Side-effects (not the goal but they fall out automatically):
- compliance-ctrl drops the `MandateSnapshot` row + projection handlers entirely.
- compliance-ctrl Ingress subscriptions collapse from 4 → 1 (only `RECOMMENDATION_PROPOSED`).
- The `ConsistentRead: true` workaround on `getMandateSnapshot` disappears — there is no `getMandateSnapshot` anymore.
- `MANDATE_REVOKED` is no longer subscribed by compliance-ctrl (it is consumed only where mandate state is authoritative — see §3.3).
- The projection `update()` patch-semantics work shipped in `f06a87f5` becomes obsolete (the projection is gone).

**Why now:** the architecture goal is "fully support eventual consistency at design level". The recently-landed `ConsistentRead` is a band-aid; the real fix is to remove the read-after-write race entirely by sourcing the mandate from the same event chain that triggered the cycle.

---

## 2. Why

### 2.1 The race we just papered over

```
INVESTOR_PROFILE_CREATED ──┬─→ compliance-ctrl projects MandateSnapshot row (Container A)
                           │
                           └─→ decision-workflow-ctrl SF starts cycle
                                  └─→ SF emits RECOMMENDATION_PROPOSED
                                       └─→ compliance-ctrl reads MandateSnapshot (Container B)
                                            ⚠ Container B may run before Container A's write committed
```

The two arms are **independent SQS deliveries on the same Lambda**. SQS reorders. Without `ConsistentRead` (or even with it, before the read happens), the rule engine can evaluate against a missing/stale mandate.

### 2.2 The deeper design lesson

Compliance-ctrl's MandateSnapshot is a **projection of a fact already in the event stream** that triggered the cycle. The projection introduces:
- A second consistency horizon (DDB write lag in addition to event-bus lag).
- A read-after-write coupling that has no business invariant requiring it.
- A SQS subscription per source-of-truth entity (currently 3: INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_REVOKED).
- A test surface that requires seeding rows + waiting for projection — the very thing that produced the integration-test flake.

The mandate config is **immutable per cycle** by intent (a mid-cycle revoke should not retroactively change a recommendation already mid-flight). Carrying it in `RECOMMENDATION_PROPOSED` matches that intent exactly.

---

## 3. Settled design decisions

### 3.1 (Q1) `RECOMMENDATION_PROPOSED` subject schema gains `mandate`

The compliance-ctrl rule engine needs `MandateSnapshot` (the typed shape in `services/advisory/compliance-ctrl/src/rules/rule-engine.ts:7-22`):

```ts
{
  mandateId: string;
  level: 'ADVISORY' | 'DISCRETIONARY';
  monthlyTurnoverCapPercent: number;
  maxSingleTradePercent: number;
  equityRiskBandPercent: number;
  driftTriggerPercent: number;
  singleEtfConcentrationPercent: number;
  drawdownCircuitBreakerPercent: number;
  effectiveDate: string;
  revokedAt: string | null;
  status?: 'ACTIVE' | 'REVOKED';
}
```

This shape is added to `subject.mandate` of `RECOMMENDATION_PROPOSED`. The rule engine input becomes purely event-derived; no DDB read.

### 3.2 (Q2) Where the SF gets the mandate — split by trigger type

The 7 triggers that start `decision-workflow-ctrl`'s SF fall into two groups:

**Group A — InvestorProfile-bearing triggers (mandate is in `$.subject` already):**
- `INVESTOR_PROFILE_CREATED`
- `INVESTOR_PROFILE_UPDATED`

The SF reads the mandate from `$.subject.mandate` directly. **No projection read on this path.** This is the only path where freshness matters (the user just edited their profile), and it's the path that was racing in §2.1.

**Group B — non-InvestorProfile triggers (mandate must come from a read model):**
- `DEPOSIT_DETECTED`
- `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`
- `PORTFOLIO_DRIFT_DETECTED`

For these, the SF reads the mandate from a small `InvestorProfileSnapshot` row in `decision-workflow-ctrl`'s own State table, projected from the same composite events. Eventual consistency is fine here: by the time these triggers fire (deposit clears, order fills, drift exceeds threshold), the user's InvestorProfile has been at rest for ≫ projection lag. The race in §2.1 is structurally impossible because the trigger and the projection-write are not the same event.

### 3.3 (Q3) `MANDATE_REVOKED` lands on the projection only

`MANDATE_REVOKED` is consumed by **decision-workflow-ctrl** (to update `InvestorProfileSnapshot.mandate.status='REVOKED'`), **not** by compliance-ctrl.

- For Group A triggers, the trigger event itself reflects the new state (an `INVESTOR_PROFILE_UPDATED` is emitted alongside `MANDATE_REVOKED`).
- For Group B triggers, subsequent cycles read the updated `InvestorProfileSnapshot` and see `status='REVOKED'`.

A `MANDATE_REVOKED` arriving mid-cycle does NOT abort an in-flight execution. Per §1: mandate is frozen at cycle start. New cycles pick up the revoke. This is acceptable — the L2 user-confirm gate downstream is the safeguard against material trades.

### 3.4 (Q4) Projection ownership — orchestrator, not investor-profile-ctrl

The `InvestorProfileSnapshot` projection lives in **decision-workflow-ctrl**'s State table, not in `investor-profile-ctrl`'s. Reasons:
- decision-workflow-ctrl is the only reader.
- investor-profile-ctrl is an agent runner, not a read-model service. Adding state to it muddies its responsibility.
- A projection close to its sole reader is the simpler shape.

Schema (one row per investor):
```
pk = InvestorProfile#${tenantId}#${userId}
sk = InvestorProfileSnapshot
mandate = { mandateId, level, ...8 guardrail fields, effectiveDate, revokedAt, status }
operatingMode = 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE'
goal = { type, horizonYears }
riskProfile = { score, band }
updatedAt = ISO timestamp
```

Updated via Ingress handlers on:
- `INVESTOR_PROFILE_CREATED` → full row PutItem (idempotent: `attribute_not_exists(pk) OR sourceEventId <> :evt`)
- `INVESTOR_PROFILE_UPDATED` → full row PutItem (overwrite — composite event carries full state)
- `MANDATE_REVOKED` → patch `mandate.status='REVOKED'` + `mandate.revokedAt=:t` via `update()` with patch semantics

### 3.5 (Q5) Where the SF state machine reads `InvestorProfileSnapshot`

A new SF entry-side state, **`LoadMandate`**, runs after `UnpackTriggerEnvelope`:

```
UnpackTriggerEnvelope
  → Choice: TriggerCarriesMandate?
       ├─ yes (INVESTOR_PROFILE_*)  → Pass: extract $.triggerContext.mandate → $.mandate
       └─ no  (DEPOSIT, ORDER, etc.) → Task (DynamoDB:GetItem direct integration)
                                         → ResultPath $.mandate
  → ParallelProfiling (existing)
  → ...
  → AssemblePacket (now also returns mandate passthrough)
  → WaitForCompliance (subject NOW includes 'mandate.$': '$.mandate')
```

The `DynamoDB:GetItem` direct service integration avoids a Lambda hop (consistent with the `events:putEvents.waitForTaskToken` pattern already used for compliance and user-confirm).

### 3.6 (Q6) compliance-ctrl shape after the change

State table after collapse holds **only** ComplianceCheck + AuditArtifact. No MandateSnapshot. Specifically removed:
- `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`: `processInvestorProfileEvent`, `processMandateRevoked` (entire functions).
- `services/advisory/compliance-ctrl/src/repositories/compliance.repository.ts`: `getMandateSnapshot`, `putMandateSnapshot` (entire methods).
- Ingress subscriptions: 3 of 4 (only `RECOMMENDATION_PROPOSED` remains).
- Integration tests: 2 projection tests deleted; REVOKED-gate + L1/L2 tests refactored to inline `mandate` in the `RECOMMENDATION_PROPOSED` payload.

`processDecisionPacket` simplifies: `subject.mandate` replaces `await deps.repository.getMandateSnapshot(tenantId, userId)`. The "no mandate found" branch (which currently writes a synthetic BLOCKED row with `mandateSnapshot.mandateId='NONE'`) collapses to a `NotRetryableError('Missing mandate on RECOMMENDATION_PROPOSED subject')` — a malformed event from upstream, not a runtime read failure.

---

## 4. Files that change

### 4.1 decision-workflow-ctrl

| File | Change |
|---|---|
| `src/constructs/decision-state-machine.ts` | Add `LoadMandate` Choice + DynamoDB:GetItem state after `UnpackTriggerEnvelope`. `WaitForCompliance` subject adds `'mandate.$': '$.mandate'`. AssemblePacket ResultSelector preserves `$.mandate` (no change to the lambda; passthrough via SF state). |
| `src/handlers/investor-profile-projection.ts` | **New.** Handler for INVESTOR_PROFILE_CREATED|UPDATED|MANDATE_REVOKED → writes `InvestorProfileSnapshot` row via `record()` / `update()`. |
| `src/repositories/decision-packet.repository.ts` (or new `investor-profile.repository.ts`) | Add `putInvestorProfileSnapshot` + revoke patch. |
| `src/service.stack.ts` | Ingress now also subscribes to INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_REVOKED. Grant SF `dynamodb:GetItem` on State table. |
| `src/domain/events.ts` | `RECOMMENDATION_PROPOSED` subject schema (ts type) gains `mandate: MandateConfig`. |

### 4.2 compliance-ctrl

| File | Change |
|---|---|
| `src/handlers/event-listener.ts` | Drop `processInvestorProfileEvent`, `processMandateRevoked`. `processDecisionPacket` reads `subject.mandate` directly; remove `repository.getMandateSnapshot` call; the "no mandate" code branch becomes `NotRetryableError`. |
| `src/repositories/compliance.repository.ts` | Drop `getMandateSnapshot`, `putMandateSnapshot`. `EventListenerDeps.repository` shape shrinks (only ComplianceCheck + AuditArtifact methods remain). |
| `src/service.stack.ts` | Ingress subscriptions reduce to `RECOMMENDATION_PROPOSED` only. |
| `test/unit/event-listener.test.ts` | Drop tests for projection handlers. processDecisionPacket tests pass `subject.mandate` directly (no `repository.getMandateSnapshot` mock). |
| `test/integration/compliance-ctrl.integration.test.ts` | **Two projection tests deleted** (was 7 tests → 5). REVOKED-gate test inlines `mandate.status='REVOKED'`. L1/L2 tests inline mandate in the event payload. No DDB seeding loops. Total runtime drops further (no projection waits). |

### 4.3 Architecture docs (mandatory per CLAUDE.md)

| File | Change |
|---|---|
| `flows/advisory-cycle.flow.yaml` | Phase 6 `state_change` line stops claiming "Loads mandate snapshot from DDB". `phases:` gains entry-side `LoadMandate` state. |
| `docs/architecture/SYSTEM-ARCHITECTURE.md` | §8 (compliance-ctrl Inputs) updated: mandate is in subject, not loaded. §11 (consistency) gains a paragraph: "Mandate is frozen at cycle start; mid-cycle revokes apply to next cycle." |
| `docs/architecture/SERVICE-INVENTORY.md` | compliance-ctrl entry: Ingress subscriptions 4 → 1; State table no longer has MandateSnapshot. decision-workflow-ctrl entry: Ingress gains 3 InvestorProfile subscriptions; State table gains InvestorProfileSnapshot. |
| `services/advisory/compliance-ctrl/CLAUDE.md` | Regenerated. |
| `services/advisory/decision-workflow-ctrl/CLAUDE.md` | Regenerated. |
| `docs/BACKLOG.md` | This entry promoted from QUEUED → ACTIVE on plan-start; moved to "Recently shipped" on completion. |

---

## 5. Migration

Sole-dev, dev-only, no users — **one-shot deploy, no compatibility shim**:
1. Land all code changes on `main`.
2. Drain stuck SF executions on `dev-decision-workflow-ctrl-decisionstatemachine` (the `[chore]` BACKLOG entry). This avoids in-flight executions emitting the old-shape `RECOMMENDATION_PROPOSED`.
3. Deploy `decision-workflow-ctrl` + `compliance-ctrl` (any order — compliance-ctrl rejects old-shape with `NotRetryableError`, the SF's WaitForCompliance task token times out at 24h, in-flight executions are inconsequential because of step 2).
4. Validate with the integration + e2e test gates (§7).

---

## 6. Out of scope

- **Cross-domain enrichment for non-advisory triggers.** DEPOSIT_DETECTED etc. are still forwarded by advisory-adpt as-is (no enrichment in the adapter). The projection-read in §3.2 covers it cleanly.
- **Multi-investor mandate fan-out.** Single user per InvestorProfile. No need to scan/page.
- **Audit trail of mandate history.** The `MandateSnapshot` row was never an audit trail (it was overwritten on every projection). Audit is the existing AuditArtifact rows on `ComplianceCheck`, which already capture the mandate at evaluation time via the `input.mandate` field of the audit payload — that path is preserved.
- **Backfilling InvestorProfileSnapshot for existing investors.** Dev account, ephemeral data, no backfill needed. New investors get a row on next INVESTOR_PROFILE_CREATED.
- **Removing the `MandateSnapshot` materialization unit tests.** Deleted along with the production code.

---

## 7. Validation gate

### 7.1 Per-step

- compliance-ctrl unit tests: 61 → ~50 (after deleting projection tests). All pass.
- decision-workflow-ctrl unit tests: existing pass + new tests for `investor-profile-projection.ts` handler.
- compliance-ctrl integration tests: 7 → 5 (after deleting projection tests). All pass first attempt (no retries).
- decision-workflow-ctrl integration tests: existing pass + new test asserting `LoadMandate` populates SF state from both Group A and Group B triggers.
- `pnpm nx affected -t test,build,lint` clean across all 33 services.

### 7.2 End-to-end

Playwright happy-path 5-fresh-tenant gate: ≥4/5 full-journey passes. The new compliance path is exercised; any L1/L2 test asymmetry remains as the separate parking-lot item (BACKLOG line 140).

### 7.3 No regressions

- AgentCore Memory contract (Spec 2 ship): unchanged.
- DECISION_APPROVED/BLOCKED CDC pattern: unchanged (still emitted from ComplianceCheck row CDC).
- SF callback (sfn-callback.ts) consumes DECISION_APPROVED/BLOCKED: unchanged.
- AuditArtifact pattern: unchanged.

---

## 8. Open questions for review

The following deserve explicit user sign-off before plan-write:

1. **Q-mid-cycle-revoke semantics (§3.3):** is "mandate frozen at cycle start; revoke applies to next cycle" acceptable? The 30–60s cycle window combined with L2 user-confirm gate downstream makes this safe in practice, but it's a conscious shift from today's "live read" semantics (which itself is illusory due to projection lag).

2. **Q-projection-ownership (§3.4):** project the read model into decision-workflow-ctrl, not investor-profile-ctrl. Confirms the orchestrator-owns-its-read-model pattern. Alternative considered: a dedicated advisory-domain read-model service — rejected as 33 → 34 service over-engineering for one consumer.

3. **Q-load-mandate-implementation (§3.5):** `DynamoDB:GetItem` direct service integration vs. a Lambda task. Direct integration is preferred (one fewer Lambda, no marshalling concerns) — confirm before writing-plans.

4. **Q-revoke-event-still-emitted:** today `MANDATE_REVOKED` exists on investorBus and is forwarded by advisory-adpt. After this change, the only consumer is decision-workflow-ctrl's projection handler. Keep the event (it carries clean lifecycle semantics independent of `INVESTOR_PROFILE_UPDATED`) or drop it (the composite UPDATED already carries the new mandate state)? Recommendation: **keep** — revoke is a distinguishable lifecycle event worth modeling separately, even if the composite captures the same state.

5. **Q-error-on-missing-mandate:** when `subject.mandate` is missing on `RECOMMENDATION_PROPOSED`, the handler throws `NotRetryableError`. This bubbles to the SF's WaitForCompliance task token (no callback) and the SF eventually times out at 24h. Is that acceptable, or do we want explicit error reporting back to the SF (e.g. emit `DECISION_BLOCKED` with `violations: [{ rule: 'MANDATE_MISSING', ... }]` — preserving today's behavior for the malformed-event case)? Recommendation: **emit BLOCKED**, preserving operator-friendly UX over abstract correctness.
