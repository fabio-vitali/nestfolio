---
id: read-model-ownership-w-a-registrations
status: active
type: refactor
notes: "WS-A of read-model-ownership-producer-aggregates: type-only ReadModelOwnership registrations for all CommandOwned/P2 producer rows (compliance ComplianceCheck/AuditArtifact P2; investor-ctrl Notification/MonthlyReport; execution-ctrl Order/StagedOrder; MI-ctrl MarketSnapshot; IP-ctrl InvestorProfileSnapshot; DWC DecisionPacket; advisory-bff user rows). No runtime change, no deploy. Confirm Order/StagedOrder status-update path -> CommandOwned vs P2."
references:
  - "docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md"
spec: null
plan: "docs/superpowers/plans/2026-06-02-read-model-ownership-w-a-registrations.md"
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "Any projectVersioned conversion or event-contract change (WS-B/WS-C)."
  - "The drift-checker mandatory-error upgrade + exclusion registry (WS-D)."
validation_gate: null
---

# WS-A — Read-model ownership registrations (type-only)

Workstream A of `read-model-ownership-producer-aggregates`
(design § "WS-A": `docs/superpowers/specs/2026-06-01-read-model-ownership-producer-aggregates-design.md`).

Add a `read-model-ownership.ts` augmentation to each producer service for its
**CommandOwned** and **P2** rows. These are `declare module` type augmentations +
static drift-checker input — they emit no runtime code and need no deploy.

Rows (verified file:line in the design doc § "Corrected classification"):

- compliance-ctrl: `ComplianceCheck`, `AuditArtifact` → `Projection<'P2'>` (`record()` ✓)
- investor-ctrl: `Notification`, `MonthlyReport` → `CommandOwned` (`record()` ✓)
- execution-ctrl: `Order`, `StagedOrder` → `CommandOwned`* (`record()`)
  — *confirm there is no status-update path; if they are write-once immutable
  records, classify `Projection<'P2'>`. Either tag is `record()`-compatible, so
  this is classification/documentation, not a behavior change.
- market-intelligence-ctrl: `MarketSnapshot` (own aggregate) → `CommandOwned` (`update()` ✓)
- investor-profile-ctrl: `InvestorProfileSnapshot` (own aggregate) → `CommandOwned` (`record()`)
- decision-workflow-ctrl: `DecisionPacket` → `CommandOwned` (`update()` + `__version` ✓)
- advisory-bff: `UserConfirmation`/`UserRejection`/`UserInteraction` → `CommandOwned`
  (AppSync `fn.js` PutItems, outside event-processor — documentary registration)

Validation gate: `pnpm nx affected -t test,lint` + per-service typecheck +
`pnpm nx run event-processor:read-model-drift` green. No deploy.

See [[project_read_model_redesign]].
