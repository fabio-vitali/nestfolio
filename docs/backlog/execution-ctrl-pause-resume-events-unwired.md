---
id: execution-ctrl-pause-resume-events-unwired
status: parking
type: bug
notes: "EXECUTION_PAUSED/EXECUTION_RESUMED declared in execution-ctrl events.ts but wired to no Egress CDC mapping or handler — declared-but-unwired."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# execution-ctrl EXECUTION_PAUSED / EXECUTION_RESUMED declared but unwired

Surfaced 2026-06-20 by the WS-2 (`execution-ctrl-per-trade-order-expansion`) `audit-service`
service-card regen.

`ExecutionCtrlEventTypes` in `services/execution/execution-ctrl/src/domain/events.ts` declares
`EXECUTION_PAUSED` and `EXECUTION_RESUMED`, but neither is:
- mapped in the Egress construct's `eventTypes` (no `__typename`/action → CDC emission), nor
- handled by `event-listener.ts` (no ingress subscription/handler).

So they are declared event-name constants with **no production producer or consumer** — vestigial,
or a placeholder for a not-yet-built pause/resume feature. Pre-existing; **not** a WS-2 regression
(WS-2 only touched the Order/StagedOrder contracts + per-trade expansion).

**Cheapest next step:** `grep -rn "EXECUTION_PAUSED\|EXECUTION_RESUMED" services libs` to confirm zero
emitters/consumers, then either wire them (if a pause/resume feature is intended) or delete the two
constants.

**Root-cause sibling (theme-epic candidate):** same class as the parking orphan
[[account-closure-requested-never-emitted]] — a *declared event name with no production wiring*. A
future `/backlog-themes` sweep could aggregate both into a "declared-but-unwired event names" theme
epic; not minted here (only two known members, low priority).
