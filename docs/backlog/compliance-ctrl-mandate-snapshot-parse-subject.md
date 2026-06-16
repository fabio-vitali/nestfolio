---
id: compliance-ctrl-mandate-snapshot-parse-subject
status: active
epic: typed-subject-consumer-contract-gaps
epic_role: core
type: refactor
requires_deploy: true
out_of_scope:
  - "The blockReason-from-violations behavioral fix (dwc-sfn-callback-reason-blockreason-gap — re-homed, separate concern)"
  - "ledger-ctrl live-fill tax-lot producer/consumer fork (sibling epic member, separate workstream)"
  - "Changing MandateSchema or the producer (investor-bff) emission — consumer-side parseSubject only"
  - "The RecommendationProposed read in the same file (already correctly parseSubject'd)"
notes: "WS-3 (consumer-parse-subject) RESIDUAL surfaced 2026-06-12 by the typed-subject-enforcement capstone gate (the new tools/check-typed-subjects.mjs caught it). compliance-ctrl/src/handlers/event-listener.ts projectMandateSnapshot() still reads `const subject = payload.subject ?? {}` RAW (line ~148) and then field-casts `subject.operatingMode as MandateSnapshot['operatingMode']` / `subject.level as MandateSnapshot['level']` — the exact untyped-subject anti-pattern WS-3 was meant to eliminate. It is registered in tools/typed-subject-exclusions.json (rule subject-cast) with this backlogRef so the gate stays green, NOT fixed in the capstone (which is enforcement-only, per the typed-subject strategy doc). Fix: convert projectMandateSnapshot to parseSubject(payload, <Schema>) PER EVENT TYPE — it is a SHARED handler for MANDATE_ISSUED / OPERATING_MODE_CHANGED / MANDATE_REVOKED, so first confirm whether all three carry the same MandateSchema shape (MandateSchema is exported from @nestfolio/investor-adpt/domain, which compliance-ctrl ALREADY imports after the capstone's Phase-A repoint — so the contract is one symbol away). If the three events differ in shape (e.g. MANDATE_REVOKED may lack level/operatingMode), SPLIT the handler so each branch parses against its own producer schema (the WS-3 'branch per event type' rule), then drop the exclusion entry. Note the RecommendationProposed read in the SAME file (line ~41) is ALREADY correctly parseSubject'd — only projectMandateSnapshot is the gap. Promote when closing WS-3 consumer-typing residuals or when next touching compliance-ctrl mandate handling."
references: []
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

## Adoption verification (2026-06-16) — single-schema, no per-event split

Traced the producer before adopting. **All four mandate events share one row + one schema**, so
the "branch per event type" fork does NOT apply:

- Producer is **investor-bff**. It writes the `Mandate` sibling row (`sk='Mandate'`,
  `transforms/onboarding-completed.ts:70`) with the full shape `{mandateId, level, status,
  operatingMode, effectiveDate, revokedAt, __version}` — satisfies `MandateSchema`.
- `service.stack.ts:83-89` maps that one row to all four events via declarative CDC:
  `insert → MANDATE_ISSUED`; `onFieldChange` `status → MANDATE_REVOKED`,
  `operatingMode → OPERATING_MODE_CHANGED`, `effectiveDate → MANDATE_REAFFIRMED`.
- The CDC publisher emits `MandateSchema.parse(row)` (DRY subject) — `publisher-schemas.ts`
  maps `Mandate → MandateSchema`. So every event carries a `MandateSchema`-valid subject.
- `MandateSchema` is already proven on the live wire: investor-ctrl `parseSubject`s it in
  production for `MANDATE_ISSUED`/`MANDATE_REVOKED` today.

The compliance-ctrl unit fixture (`fullMandate()`) already encodes the real `MandateSchema`
shape for all 4 events — not co-wrong; the existing assertions are the spec.

## Fix

`projectMandateSnapshot` → `const subject = parseSubject(payload, MandateSchema)` (single
schema for all 4 events), drop every `subject.x as …` cast, and remove the hand-rolled
`if (!operatingMode) throw NotRetryableError` guard — `parseSubject`'s `ZodError` routes to the
poison-pill/DLQ path (the sanctioned platform behavior), so a malformed subject still does not
retry forever. Keep the `__version`-absent `skip()` guard (`MandateSchema.__version` is
optional). Then remove the `subject-cast` exclusion entry for this file from
`tools/typed-subject-exclusions.json`, and add a regression test that a malformed mandate
subject is rejected. See `[[project-event-subject-contracts]]`.
