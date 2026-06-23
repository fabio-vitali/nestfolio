---
id: mandate-reaffirm-operatingmode-required-legacy-dlq
status: parking
type: bug
notes: "MANDATE_REAFFIRMED CDC re-validates the full Mandate row via MandateSchema; operatingMode is a required enum, so a legacy Mandate row missing it would ZodError → DLQ. Safe on fresh dev; prod data-hygiene risk."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: prod-environment-hardening
epic_role: core
---

# MANDATE_REAFFIRMED can DLQ on legacy Mandate rows missing `operatingMode`

Surfaced 2026-06-15 by the go-live workstream final code review (integration pass).

`confirm-go-live.fn.js`'s third transactItem re-affirms the `Mandate` row by setting only
`effectiveDate` / `updatedAt` / `timestamp` / `__version`. The CDC image that feeds
`MANDATE_REAFFIRMED` is the **full new DDB row image**, and the producer's typed-subject publisher
validates it via `MandateSchema` (`@nestfolio/investor-adpt/domain`), where `operatingMode` is a
**required** `z.enum([...])` (not optional). So if any `Mandate` row was written **before**
`operatingMode` was added to the row (legacy / pre-resplit rows in a long-lived environment),
`MandateSchema.parse()` throws a ZodError and the `MANDATE_REAFFIRMED` event routes to the DLQ
permanently — the compliance-ctrl `MandateSnapshot` re-affirmation silently fails with no alert.

## Why it is parked (not a dev blocker)

- The dev sandbox is fresh: all `Mandate` rows are post-resplit and carry `operatingMode`, so the
  go-live Jest e2e (`go-live-switch`) exercised `MANDATE_REAFFIRMED → MandateSnapshot v2`
  successfully on deployed dev.
- There is no production environment yet (dev-only deployment), so no legacy rows exist today.
- It is a pre-existing schema-strictness property of `MandateSchema`, not introduced by go-live —
  go-live merely re-emits the existing row.

## Fix options (when hardening for a long-lived / prod environment)

1. Make `MandateSchema.operatingMode` optional (with a documented default on the consumer side), OR
2. Add a guard in `confirm-go-live.fn.js` (or a backfill) ensuring `operatingMode` is set on the
   Mandate row before the re-affirm commits.

Promote before a production deploy that could contain pre-`operatingMode` Mandate rows, or when
hardening the mandate lifecycle for legacy data.
