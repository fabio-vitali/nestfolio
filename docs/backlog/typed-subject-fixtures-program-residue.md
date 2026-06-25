---
id: typed-subject-fixtures-program-residue
status: parking
type: epic
notes: "Residue from the shipped typed-subject (producer contracts) + typed-test-fixtures programs: a gate-flagged Subject-suffix naming violation left unfixed, a coverage hole in the check-typed-fixtures gate, and consumer-side TS type layers lagging the new producer-owned contracts. Debt-class theme epic, 3 members."
done_when: "Each residue item is cleared — the gate-flagged Subject-suffix naming violation renamed green, the check-typed-fixtures HAS_DETAIL shorthand hole closed (with a regression test), and the investor Mandate TS type layer reconciled with the producer contracts; all members shipped or dropped."
scope: "Residue left by the shipped typed-subject / typed-test-fixtures contract programs: a typed-subject-drift gate violation (convention-4 naming, Subject suffix) left unfixed, a coverage hole in the check-typed-fixtures gate (HAS_DETAIL misses shorthand `detail`), and consumer-side TS type layers lagging the new producer-owned zod contracts."
out_of_scope:
  - "Fixtures that drift from a producer contract (untyped-fixture-contract-drift) and events with no producer contract at all (missing-producer-contract-surface) — those have their own theme epics"
  - "Identity carried in the subject (dry-subject-identity-cleanup) — a different convention than naming/type-layer residue"
references: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Typed-subject / typed-fixtures program residue

Root cause (debt class): the typed-subject (producer-owned zod contracts) and typed-test-fixtures
programs shipped, but left residue the gates flag-or-miss and the surrounding TS type layer hasn't
caught up to. Honest caveat — the three members differ in kind (an unfixed gate-flagged violation,
a gate coverage hole, and consumer-side type-layer lag); what they share is the trigger ("left
behind by the typed-subject/fixtures migration") and the cleanup action (make the contract/gate/type
layer self-consistent). Its named sibling `residual-generic-subject-casts-cleanup` was *dropped*, so
these are the live residue.

Members (derived from `epic:` pointers):
- `broker-ctrl-sim-funding-subject-suffix-rename` (contracts.ts Sim*RequestedSubjectSchema names use the `Subject` suffix → `event-processor:typed-subject-drift` convention-4 hard-fail; rename to the clean domain concept)
- `check-typed-fixtures-has-detail-shorthand-gap` (HAS_DETAIL regex `/\bdetail\s*:/` misses shorthand `detail` property → a literal-detailType + shorthand-detail + registered-name putEvent escapes the legacy-detail check; broaden the regex + add a case)
- `investor-mandate-type-layer-cleanup` (investor-adpt `MandateLevel` redundant with `MandateSchema.level`; investor-bff `Mandate` interface lacks `operatingMode` — TS type layer lagging the new producer contracts)
