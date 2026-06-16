---
id: typed-subject-consumer-contract-gaps
status: active
type: epic
notes: "Consumers read event-subject fields the producer contract never codifies — codify/align the producer contract per hop. Promoted to active delivery epic 2026-06-16. Triaged on adoption: alpaca-transfer-request DROPPED (verified already resolved — AlpacaTransferRequestSchema codifies the compound shape, both sides typed); dwc-sfn-callback RE-HOMED out (its typed-subject gap is closed; only a behavioral blockReason-from-violations residual remains). 2 open core members remain: compliance-ctrl-mandate-snapshot-parse-subject (clean parseSubject conversion) + ledger-ctrl-live-tax-lot-missing-order-fields (genuine live-money latent bug, needs a producer-vs-consumer fork)."
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

## Triage on adoption (2026-06-16)

Promoted to the active delivery epic. Code-verification of all four original members found half of
them already drained:

- ❌ `alpaca-transfer-request-compound-subject-no-contract` — **DROPPED.** Already resolved:
  `AlpacaTransferRequestSchema` (execution-adpt/domain) codifies `{transferId, amountCents, currency,
  direction, relationshipId}`; producer emits it typed, consumer `parseSubject`s it, fixtures correct.
- ↪ `dwc-sfn-callback-reason-blockreason-gap` — **RE-HOMED out.** Its typed-subject gap is closed
  (`parseSubject(ComplianceCheckSchema)`, no phantom `reason` read, real-`violations` fixture). The
  residual is purely behavioral (derive `blockReason` from `violations`) — not a contract-shape gap.

## Open core members

- `compliance-ctrl-mandate-snapshot-parse-subject` — `projectMandateSnapshot` still reads
  `payload.subject ?? {}` raw + casts `operatingMode`/`level`. Clean single-schema fix:
  `parseSubject(payload, MandateSchema)` (MandateSchema carries exactly the read fields), then drop its
  `tools/typed-subject-exclusions.json` entry. **← worked first.**
- `ledger-ctrl-live-tax-lot-missing-order-fields` — live-fill tax-lots read symbol/side/qty/fillPrice
  that `ORDER_FILLED` never carries (broken live tax tracking). Needs a producer-vs-consumer
  architectural decision; overlaps `broker-ctrl-order-sf-input-contract-gap`.

Related dossier: [[project_event_subject_contracts]].
