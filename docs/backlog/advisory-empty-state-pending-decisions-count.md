---
id: advisory-empty-state-pending-decisions-count
status: active
rank: null
type: design
references:
  - services/advisory/advisory-bff/src/service.stack.ts
  - services/advisory/advisory-bff/src/transforms/decision-packet-created.ts
  - services/advisory/decision-workflow-ctrl/src/service.stack.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/investor/dashboard-bff/src/service.stack.ts
  - services/investor/dashboard-bff/src/transforms/advisory-status.ts
  - services/investor/investor-adpt/src/service.stack.ts
  - apps/advisory-mfe/src/app/decision-list/decision-list.component.ts
  - apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts
out_of_scope:
  - Idempotent trigger counting via `seenTriggerEventIds` set (drift accepted; rebalances on next decision)
  - Server-side TTL / scheduled job to reset stuck counters (Phase 1 = client-side staleness clamp only)
  - Adding `lastDecisionStatus`, `lastRecommendationAt` etc. to advisory-bff's `AdvisoryStatus` (mirror dashboard-bff fully)
  - Removing `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts` Step 8 wait — separate cleanup PR after the in-flight UX is verified in production
  - Onboarding flow consideration — INVESTOR_PROFILE_CREATED triggers the SF and increments the counter; user is not on /advisory during onboarding so banner is invisible. Acceptable.
spec: docs/superpowers/specs/2026-05-09-advisory-empty-state-pending-decisions-count-design.md
plan: null
topic_memory: []
validation_gate: null
notes: "UX bug — empty state shown when pendingDecisionsCount > 0 and list is lagging. Promoted 2026-05-09 to deliver in-flight UX with full BFF state-completeness (advisory-bff + dashboard-bff both project the in-flight state)."
---

# `/advisory` shows empty state when `pendingDecisionsCount > 0` and the list query is empty

UX bug. Real users clicking the dashboard alert immediately can hit this when the agent pipeline (advisory-bff projection) lags the dashboard counter by 30–75s. Surfaced 2026-05-02 during Pattern B Step 9 e2e gate (Run 3 fail). Patched test-side via `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts` Step 8 wait.

**Root cause (verified during 2026-05-09 design):** the system has a meaningful state — "Step Functions agent pipeline running" — that is **not projected into any BFF read model**. Both `advisory-bff` and `dashboard-bff` increment their counters on `DECISION_PACKET_CREATED` (which fires at the END of the 30–75s pipeline), so during the pipeline window neither BFF can render "we're working on it." The 30–75s "lag" observed in the e2e fixture is a fixture artefact (`apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts:34` directly mutates dashboard-bff state without firing real events). In production both projections advance together at PACKET_CREATED, so the gap is sub-second — but the deeper architectural issue (no projection of the in-flight state) is real.

**Approach (Option H per design):** project the in-flight state into both BFFs by subscribing to the 7 SF trigger events that decision-workflow-ctrl already listens to (`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`). No new domain events needed.

**Two phases bundled** per the [BFF state completeness principle](../../memory/feedback_bff_state_completeness.md):
- **Phase 1:** advisory-bff projects `inFlightCount` into a tenant-scoped `AdvisoryStatus` aggregate. New `getAdvisoryStatus` query + `onAdvisoryStatusUpdate` subscription. advisory-mfe renders a "generating" branch when `inFlightCount > 0` and the list is empty.
- **Phase 2:** dashboard-bff's `pendingDecisionsCount` semantics shift to "any in-progress decision" — increment on triggers, decrement on APPROVED/BLOCKED. Drops the pre-existing double-count on USER_CONFIRMATION_REQUESTED. investor-adpt forwards PORTFOLIO_DRIFT_DETECTED to investorBus. dashboard alert advances earlier — 30-75s before user feedback was previously possible.

See spec for full design.
