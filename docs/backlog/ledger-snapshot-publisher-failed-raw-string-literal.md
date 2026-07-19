---
id: ledger-snapshot-publisher-failed-raw-string-literal
status: parking
type: tooling
notes: "snapshot-publisher.ts uses a raw string 'LEDGER_SNAPSHOT_PUBLISHER_FAILED' instead of a typed constant, inconsistent with sibling LEDGER_PROCESSING_FAILED."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# ledger-ctrl snapshot-publisher uses a raw string literal instead of a typed constant

`services/ledger/ledger-ctrl/src/.../snapshot-publisher.ts:13` uses a raw string
`'LEDGER_SNAPSHOT_PUBLISHER_FAILED'` instead of a typed constant, inconsistent with the sibling
`LEDGER_PROCESSING_FAILED` typed constant used elsewhere in the same service.
