---
id: broker-alpaca-emission-shape-drift
status: parking
type: epic
notes: "broker-alpaca writes the same aggregate with inconsistent field shapes across writers (positions numeric vs equity string; timestamp/alpacaOrderId present on some writers only). Theme epic, 2 members."
done_when: "Each broker-alpaca aggregate is emitted with a single consistent field shape across all its writers (uniform numeric coercion + uniform field presence); both members shipped or dropped."
scope: "Producer-side field-shape inconsistency across the multiple writers of one broker-alpaca aggregate (AlpacaAccountSnapshot equity/buyingPower; AlpacaOrderResult/AlpacaTransferResult timestamp/alpacaOrderId)."
out_of_scope:
  - "Cross-handler correlation-key divergence (broker-ctrl-alpaca-funding-carrier-pk-divergence) — a PK/keying bug, not field-shape drift"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# broker-alpaca emission-shape drift

Root cause: the broker-alpaca adapter writes the same aggregate with inconsistent field shapes across its writers — AlpacaAccountSnapshot stores equity/buyingPower as raw Alpaca strings while positions are Number()-converted; AlpacaOrderResult/AlpacaTransferResult carry timestamp (and alpacaOrderId) only on some writers (repository createMapping yes, event-listener reject/cancel/error emissions no). The typed-subject-contracts-execution slice loosened the contracts to match this messy reality. Fix pattern: normalize all writers of an aggregate to one emitted shape.

Members (derived from `epic:` pointers):
- `broker-alpaca-account-snapshot-equity-string-drift`
- `broker-alpaca-result-timestamp-drift`
