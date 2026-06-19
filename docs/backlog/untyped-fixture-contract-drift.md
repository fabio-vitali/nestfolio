---
id: untyped-fixture-contract-drift
status: parking
type: epic
notes: "Hand-authored test fixtures drift from the producer's real/zod contract → false-green tests while production is fine. Theme epic, 3 members."
done_when: "Each in-scope fixture is typed against (or corrected to match) the producer's zod contract so the test exercises the real payload shape; all members shipped or dropped."
scope: "Integration/unit test fixtures that send a payload shape not matching the producer's real/codified contract (co-wrong / thin fixtures), giving false confidence while production is unaffected."
out_of_scope:
  - "Producer contracts that genuinely lack a field the consumer needs (typed-subject-consumer-contract-gaps) and events with no producer contract at all (missing-producer-contract-surface)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Untyped fixture contract drift

Root cause: test fixtures are hand-authored and not validated against the producer's zod contract, so they drift to a wrong shape — the test passes (DDB-row asserts stay green) while a real producer would behave differently. Production is fine; this is a test-quality gap. Fix pattern: type the fixtures against the producer contract (the typed-test-fixtures approach) for these specific events.

Members (derived from `epic:` pointers):
- `advisory-bff-decision-publisher-proposedtrade-shape-mismatch`
- `ledger-ctrl-decision-packet-fixture-thin-shape`
- `sec-prospectus-pe-ctrl-fixture-contract-mismatch`
