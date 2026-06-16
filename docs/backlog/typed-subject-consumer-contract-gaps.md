---
id: typed-subject-consumer-contract-gaps
status: parking
type: epic
notes: "Consumers read event-subject fields the producer contract never codifies — codify/align the producer contract per hop. Theme epic, 4 members."
done_when: "Each member's producer contract codifies the fields its consumer reads (typed, no casts) and the co-wrong unit fixtures are corrected; every core member shipped or dropped."
scope: "Cross-domain producer↔consumer contract-shape gaps surfaced by the typed-subject parse-subject conversion — a consumer reads a subject/payload field absent from the producer's codified schema."
out_of_scope:
  - "Event-NAME re-declaration drift (adapter-event-name-redeclare-vs-reexport — different mechanism)"
  - "Test-coverage-only gaps with no contract change (advisory-riskcategory-compliance-coverage)"
references: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Typed-subject consumer-contract gaps

Root cause: the typed-subject program codified producer payload contracts and a parse-subject
consumer-conversion (WS-3), but several consumers still read subject/payload fields that the
producer's codified schema never declares. Each is the same shape of bug — a consumer read off
a contract that doesn't carry the field — and the same fix pattern: codify/align the producer
contract, retype the consumer read, and correct the co-wrong unit fixture.

Members (derived from `epic:` pointers):
- `alpaca-transfer-request-compound-subject-no-contract`
- `compliance-ctrl-mandate-snapshot-parse-subject`
- `dwc-sfn-callback-reason-blockreason-gap`
- `ledger-ctrl-live-tax-lot-missing-order-fields`

One codify-the-contract sweep across these hops drains the theme. Related dossier:
[[project_event_subject_contracts]].
