---
id: advisory-empty-state-pending-decisions-count
status: shipped
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
plan: docs/superpowers/plans/2026-05-09-advisory-in-flight-state-projection.md
topic_memory: []
validation_gate: "Unit 4/4 projects green. Deploy advisory-bff+dashboard-bff+investor-adpt to dev sandbox UPDATE_COMPLETE. Integration 36/36 against deployed dev (advisory-bff 10/10, dashboard-bff 20/20, investor-adpt 6/6). New Playwright generating-state scenarios 2/2 green on dev (advisory-generating-state empty-state + dashboard alert at trigger time). 4 e2e-feature failures + 1 happy-path Playwright failure are pre-existing (project_pipeline_trigger_gap + circuit-breaker), unrelated."
notes: "UX bug — empty state shown when pendingDecisionsCount > 0 and list is lagging. Shipped 2026-05-09 on `feat/advisory-in-flight-projection` (33 commits) with full BFF state-completeness — advisory-bff + dashboard-bff both project the in-flight state."
---

# `/advisory` shows empty state when `pendingDecisionsCount > 0` and the list query is empty

UX bug. Real users clicking the dashboard alert immediately can hit this when the agent pipeline (advisory-bff projection) lags the dashboard counter by 30–75s. Surfaced 2026-05-02 during Pattern B Step 9 e2e gate (Run 3 fail). Patched test-side via `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts` Step 8 wait.

**Root cause (verified during 2026-05-09 design):** the system has a meaningful state — "Step Functions agent pipeline running" — that is **not projected into any BFF read model**. Both `advisory-bff` and `dashboard-bff` increment their counters on `DECISION_PACKET_CREATED` (which fires at the END of the 30–75s pipeline), so during the pipeline window neither BFF can render "we're working on it." The 30–75s "lag" observed in the e2e fixture is a fixture artefact (`apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts:34` directly mutates dashboard-bff state without firing real events). In production both projections advance together at PACKET_CREATED, so the gap is sub-second — but the deeper architectural issue (no projection of the in-flight state) is real.

**Approach (Option H per design):** project the in-flight state into both BFFs by subscribing to the 7 SF trigger events that decision-workflow-ctrl already listens to (`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`). No new domain events needed.

**Two phases bundled** per the [BFF state completeness principle](../../memory/feedback_bff_state_completeness.md):
- **Phase 1:** advisory-bff projects `inFlightCount` into a tenant-scoped `AdvisoryStatus` aggregate. New `getAdvisoryStatus` query + `onAdvisoryStatusUpdate` subscription. advisory-mfe renders a "generating" branch when `inFlightCount > 0` and the list is empty.
- **Phase 2:** dashboard-bff's `pendingDecisionsCount` semantics shift to "any in-progress decision" — increment on triggers, decrement on APPROVED/BLOCKED. Drops the pre-existing double-count on USER_CONFIRMATION_REQUESTED. investor-adpt forwards PORTFOLIO_DRIFT_DETECTED to investorBus. dashboard alert advances earlier — 30-75s before user feedback was previously possible.

See spec for full design.

## Ship narrative — 2026-05-09

Delivered on `feat/advisory-in-flight-projection` (33 commits). Phase 1 + Phase 2 were bundled in a single workstream so both BFFs project the in-flight state coherently.

**advisory-bff (Phase 1).** Added `decision-trigger-received` transform (`services/advisory/advisory-bff/src/transforms/decision-trigger-received.ts`) that fires on each of the 7 SF trigger events (`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED`). Each trigger increments tenant-scoped `AdvisoryStatus.inFlightCount` (+1) and refreshes `lastTriggerAt`. `decision-packet-created` was extended to also decrement inFlightCount (-1), giving the +/- balance. The 7 trigger types are imported from `@nestfolio/decision-workflow-ctrl/events` `TRIGGER_EVENT_TYPES` — single source of truth, no duplicate list. New AppSync surface: `getAdvisoryStatus` query, `publishAdvisoryStatusUpdate` mutation (`@aws_iam`), `onAdvisoryStatusUpdate` subscription (nullable per the existing pattern). The CDC publisher gained an `AdvisoryStatus` broadcast entry with `whenChanged: ['inFlightCount', 'lastTriggerAt']` (excluding `updatedAt` to prevent spurious frames).

**advisory-mfe (Phase 1).** `DecisionListComponent` now has `inFlightCount` + `lastTriggerAt` signals plus a `displayedInFlightCount` computed that clamps stale state at `STALENESS_MS = 5 * 60 * 1000`. The template was refactored from a 4-branch state machine to a 5-branch one — adding a "generating" empty-state and an inline "+N generating" banner inside the populated list. Subscriptions are registered BEFORE queries fire (R1 / Pattern B) to avoid losing frames during query resolution.

**dashboard-bff + investor-adpt (Phase 2).** `dashboard-bff/transforms/advisory-status.ts` was rewritten: increment on the 7 triggers, decrement on `DECISION_APPROVED`/`DECISION_BLOCKED`. `DECISION_PACKET_CREATED` and `USER_CONFIRMATION_REQUESTED` were repurposed from advisoryStatus to recent-activity (closing the pre-existing double-count). The dashboard alert bar's `pendingDecisionsCount > 0` predicate is unchanged — semantics shifted invisibly at the component level. `investor-adpt` was extended to forward `PORTFOLIO_DRIFT_DETECTED` from ledgerBus to investorBus so dashboard-bff can subscribe.

**Tests + e2e.** advisory-bff integration tests use delta-based assertions (the shared-tenant counter accumulates negative drift from pre-existing orphan-PACKET tests; new tests anchor to `baseCount` rather than absolute `>= 1`). The legacy `inject-advisory-update` GraphQL backdoor was kept temporarily — a follow-up to delete it and migrate the WSS sentinel test to a real-EB path is filed at `delete-deprecated-inject-advisory-update-fixture`. Two new Playwright scenarios verify the generating empty-state and the dashboard alert advancing at trigger time.

**Validation.** All 4 projects green at the unit layer (mock fix + delta-assertion fix during validation). 3 stacks deployed clean to dev sandbox. 36/36 integration tests against deployed dev. Both new Playwright scenarios green (12.9s + 27.8s). 4 e2e-feature + 1 happy-path Playwright failures pre-existed and are tracked under `project_pipeline_trigger_gap` and the circuit-breaker work.

**Side findings filed:** `delete-deprecated-inject-advisory-update-fixture` (fixture cleanup), `order-execution-flow-yaml-parse-error` (pre-existing YAML issue at `flows/order-execution.flow.yaml:154`).
