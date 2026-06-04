---
id: advisory-bff-cycle-status-projection
status: shipped
rank: 2
type: feature
notes: "WS-2 of advisory-generating-failed-ux: advisory-bff subscribes to DECISION_CYCLE_STARTED/FAILED and projects status GENERATING/FAILED onto the DecisionReadModel P1 row via projectVersioned (version-guarded, idempotent, order-agnostic). DecisionReadModel stays P1."
references:
  - docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
  - services/advisory/advisory-bff/src/handlers/event-listener.ts
  - services/advisory/advisory-bff/src/transforms/decision-snapshot.ts
  - services/advisory/advisory-bff/src/service.stack.ts
out_of_scope:
  - "advisory-mfe rendering: component status-routing, get-pending-decisions.fn.js status filter, staleness guard, i18n (WS-3)"
  - "dashboard generating/failed reflection (WS-4)"
  - "DWC cycle-event emission + SF Catch (WS-1, shipped 2026-06-04)"
  - "Any AdvisoryStatus read-model field additions or read-model-ownership registration change — DecisionReadModel stays Projection<'P1'>, same typename + intent"
  - "e2e / Playwright scenario rewrites (WS-3 owns /advisory, WS-4 owns dashboard)"
spec: docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
plan: docs/superpowers/plans/2026-06-04-advisory-bff-cycle-status-projection.md
topic_memory: []
validation_gate: |
  Commits 2c60c014..8ecc203c (7) on worktree branch. Unit: advisory-bff:test 39/39;
  typecheck + lint green; nx affected -t test,lint --base=origin/main 28 projects green;
  read-model drift 0 (DecisionReadModel stays Projection<'P1'>). Code review found + fixed
  a missing readable `version` field (8ecc203c). Deploy: dev-advisory-bff UPDATE_COMPLETE
  (all 9 resources; AppSync GraphQLSchema = GENERATING enum + Ingress Rule = 2 new
  detail-types). Integration vs dev: advisory-bff:test-integration 10/10 PASS (276s),
  incl. 3 new cycle-status tests (GENERATING v0 projects; content packet v1 overwrites;
  FAILED v1 lands + late STARTED v0 dropped), no flakes. Enum-poison check: zero
  DecisionStatus enum errors in DecisionPublisher logs (GENERATING broadcasts cleanly).
  Side-finding (pre-existing, filed): advisory-bff integration fixtures send a
  {symbol,action,quantity} trade shape that doesn't match ProposedTradeInput, so the
  decision-publisher broadcast fails for DECISION_PACKET test rows (tests assert the DDB
  row only) — orthogonal to WS-2, identical on origin/main.
---

# WS-2 — advisory-bff cycle-status projection

Part of the `advisory-generating-failed-ux` mini-program (design umbrella:
`docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md`, §4).
Depends on WS-1 (rank 1) producing the cycle events.

Scope:
- `service.stack.ts`: add `DECISION_CYCLE_STARTED`, `DECISION_CYCLE_FAILED` to the
  Ingress `eventTypes`.
- New transform `transforms/decision-cycle-status.ts` (wired in
  `event-listener.ts`): `projectVersioned('DecisionReadModel', { decisionId,
  tenantId, status, createdAt, updatedAt }, { version, overrides: {...} })` —
  STARTED → `GENERATING` (v0), FAILED → `FAILED` (v1). The content packet (v1)
  overwrites GENERATING via the version guard; a late STARTED after a real
  decision is dropped.
- `DecisionReadModel` stays `Projection<'P1'>` (no read-model-ownership change —
  same typename + intent, new status values only). The existing
  `decision-snapshot.ts` degraded-drop defense is unchanged.
- Unit tests (STARTED→GENERATING v0, FAILED→FAILED v1, version ordering) +
  integration (inject STARTED → DecisionReadModel row reads GENERATING on dev).
- Deploy advisory-bff; validate row statuses.
