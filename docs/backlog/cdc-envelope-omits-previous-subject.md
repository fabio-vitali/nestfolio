---
id: cdc-envelope-omits-previous-subject
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_investor_profile_collapse.md
validation_gate: null
notes: "OldImage read but never propagated; deriveProfileUpdateNotifications can't diff."
---

# CDC envelope omits `previousSubject` (OldImage)

`libs/event-processor/src/pipelines/change-data-capture.ts:68` builds `{id, type, timestamp, subject, context}` from NewImage only; OldImage is read in `libs/event-processor/src/util/unmarshal-stream.ts:19-22` (StreamContext.oldImage) but never propagated to EventBridge. Surfaced 2026-05-03 during InvestorProfile collapse Phase 4 — `deriveProfileUpdateNotifications` in `services/investor/investor-ctrl/src/handlers/event-listener.ts` cannot diff `goal.*` / `operatingMode` from a single `subject`, so it falls back to "fire both notifications on every INVESTOR_PROFILE_UPDATED" per Phase 4 plan (null-OldImage branch). Fix options: (a) add `previousSubject` field to envelope unconditionally, (b) wire OldImage through the existing `transform` callback. Promote if over-firing of GOAL_UPDATED + OPERATING_MODE_CHANGED notifications becomes user-visible noise. Topic: `project_investor_profile_collapse.md`.
