---
id: compliance-ctrl-mandate-snapshot-parse-subject
status: parking
type: refactor
notes: "WS-3 (consumer-parse-subject) RESIDUAL surfaced 2026-06-12 by the typed-subject-enforcement capstone gate (the new tools/check-typed-subjects.mjs caught it). compliance-ctrl/src/handlers/event-listener.ts projectMandateSnapshot() still reads `const subject = payload.subject ?? {}` RAW (line ~148) and then field-casts `subject.operatingMode as MandateSnapshot['operatingMode']` / `subject.level as MandateSnapshot['level']` — the exact untyped-subject anti-pattern WS-3 was meant to eliminate. It is registered in tools/typed-subject-exclusions.json (rule subject-cast) with this backlogRef so the gate stays green, NOT fixed in the capstone (which is enforcement-only, per the typed-subject strategy doc). Fix: convert projectMandateSnapshot to parseSubject(payload, <Schema>) PER EVENT TYPE — it is a SHARED handler for MANDATE_ISSUED / OPERATING_MODE_CHANGED / MANDATE_REVOKED, so first confirm whether all three carry the same MandateSchema shape (MandateSchema is exported from @nestfolio/investor-adpt/domain, which compliance-ctrl ALREADY imports after the capstone's Phase-A repoint — so the contract is one symbol away). If the three events differ in shape (e.g. MANDATE_REVOKED may lack level/operatingMode), SPLIT the handler so each branch parses against its own producer schema (the WS-3 'branch per event type' rule), then drop the exclusion entry. Note the RecommendationProposed read in the SAME file (line ~41) is ALREADY correctly parseSubject'd — only projectMandateSnapshot is the gap. Promote when closing WS-3 consumer-typing residuals or when next touching compliance-ctrl mandate handling."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: ["project_event_subject_contracts.md"]
validation_gate: null
---

# compliance-ctrl projectMandateSnapshot still reads payload.subject raw (WS-3 residual)

## Why

The typed-subject-enforcement gate (`tools/check-typed-subjects.mjs`) caught a consumer
reader that `consumer-parse-subject` (WS-3) missed:
`compliance-ctrl/src/handlers/event-listener.ts` `projectMandateSnapshot()` does
`const subject = payload.subject ?? {}` and casts `subject.operatingMode` / `subject.level`
to `MandateSnapshot[...]` — the untyped-subject anti-pattern. It is excluded in the gate's
registry (with this `backlogRef`) so the capstone ships green; this item fixes it properly.

## Fix

`projectMandateSnapshot` is a SHARED handler for `MANDATE_ISSUED` / `OPERATING_MODE_CHANGED`
/ `MANDATE_REVOKED`. Confirm whether all three carry the same `MandateSchema` shape
(exported from `@nestfolio/investor-adpt/domain`, already imported by compliance-ctrl). If
yes → `parseSubject(payload, MandateSchema)` and drop the casts. If they differ → split the
handler per event type and parse each branch against its producer schema (the WS-3
branch-per-event rule). Then remove the `subject-cast` exclusion entry for this file. See
`[[project-event-subject-contracts]]`.

## Promote when

Closing WS-3 consumer-typing residuals, or when next touching compliance-ctrl mandate handling.
