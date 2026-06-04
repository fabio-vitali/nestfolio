---
id: advisory-bff-cycle-status-projection
status: active
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
plan: null
topic_memory: []
validation_gate: null
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
