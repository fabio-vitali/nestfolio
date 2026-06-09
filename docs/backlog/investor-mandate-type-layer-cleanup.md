---
id: investor-mandate-type-layer-cleanup
status: parking
type: refactor
notes: "Two pre-existing investor Mandate type-layer cleanups surfaced by typed-subject-contracts-investor review: investor-adpt MandateLevel redundant with MandateSchema.level; investor-bff Mandate interface missing operatingMode."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Investor Mandate type-layer cleanup

Two pre-existing, minor type-layer findings surfaced 2026-06-09 during the
`typed-subject-contracts-investor` code review. Both are non-e2e-blocking and tangential to the
typed-subject refactoring's drainable scope (the producer contracts are correct; these are the
surrounding TS type layer lagging). Parking until an investor Mandate touch or a dead-code sweep.

**(1) `investor-adpt` `MandateLevel` standalone type now redundant.**
`services/investor/investor-adpt/src/domain/index.ts` still exports
`export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';` — identical to the `level` enum now
carried by `MandateSchema` (`services/investor/investor-adpt/src/domain/contracts.ts`, added in
the typed-subject-contracts-investor slice). Drift risk if a third level is ever added (two places
to update). Cheapest next step: `grep -rn "MandateLevel" services/ apps/ libs/` to enumerate
consumers; if removable, delete the standalone type and have consumers use
`z.infer<typeof MandateSchema>['level']` (or keep it but derive it from the schema). NOTE: it is a
consumed cross-domain export — removing it is a (minor) breaking change for consumers, so this is
really WS-3 / consumer-migration territory, not a pure adapter edit.

**(2) `investor-bff` `Mandate` interface lacks `operatingMode`.**
`services/investor/investor-bff/src/domain/models.ts` `interface Mandate` declares
`{ mandateId, level, status, effectiveDate, revokedAt }` but the real Mandate sibling row
(`sk='Mandate'`) also carries `operatingMode` — written by `transforms/onboarding-completed.ts`
and the `update-operating-mode` resolver, and it is precisely what `OPERATING_MODE_CHANGED` CDC
re-sources (`onFieldChange:operatingMode`). The new producer contract
`MandateSchema` (investor-adpt/domain) correctly includes `operatingMode`; this is just the bff
read-side interface lagging the real row. Cheapest next step: add `readonly operatingMode: OperatingMode`
to the `Mandate` interface (or replace it with the producer contract type). Not a correctness bug —
the resolvers read the field off the raw row regardless of the interface.
