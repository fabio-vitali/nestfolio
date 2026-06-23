---
id: dashboard-bff-awaiting-confirmation-activity-gap
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "dashboard-bff recent-activity may be missing an 'awaiting confirmation' feed item. The dead USER_CONFIRMATION_REQUESTED handler (removed by incident-escalation-path-b 2026-06-15) was its only producer; since the Task-1.5 taskToken redesign no event fires, so an L2 decision entering AWAITING_CONFIRMATION may not surface in the activity feed. Surfaced 2026-06-15."
epic: bff-read-model-semantic-gaps
epic_role: core
---

# dashboard-bff recent-activity: no "awaiting confirmation" item

## Evidence

`incident-escalation-path-b` removed `dashboard-bff`'s `USER_CONFIRMATION_REQUESTED` →
`recentActivity` handler because the event has had no producer since the Task-1.5 taskToken
redesign (decision-workflow SF writes the taskToken onto the DecisionPacket, `status=AWAITING_CONFIRMATION`,
instead of emitting an event). The handler was unreachable dead code, so removing it changed no
runtime behavior — but it confirms there is no live path feeding an "awaiting confirmation"
signal into the dashboard recent-activity feed.

`DECISION_PACKET_CREATED` still feeds the feed (new decisions appear), but the specific L2
"awaiting your confirmation" sub-state may never surface as its own activity row.

## Done (investigate first)

1. Confirm whether the dashboard recent-activity feed is actually expected to show an
   "awaiting confirmation" item, and whether it currently does (via DECISION_PACKET_CREATED or
   the DecisionPacket update CDC).
2. If it's a real gap: source the signal from the DecisionPacket `AWAITING_CONFIRMATION` status
   (the row CDC the advisory pipeline already writes) rather than a dead event — e.g. an
   investor-adpt-forwarded DecisionPacket-status event or a dashboard-bff projection on the
   existing decision row.

Promote when hardening the dashboard activity feed or the L2 confirmation UX.
