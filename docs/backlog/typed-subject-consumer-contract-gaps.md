---
id: typed-subject-consumer-contract-gaps
status: parking
type: epic
notes: "Consumers read event-subject fields the producer contract never codifies — codify/align the producer contract per hop. Theme epic. Promoted to active 2026-06-16 to ship compliance-ctrl-mandate-snapshot-parse-subject, then DEMOTED back to parking once that shipped (member 2 done). Triaged on adoption: alpaca-transfer-request DROPPED (already resolved); dwc-sfn-callback RE-HOMED out (typed-subject gap closed). compliance-ctrl-mandate-snapshot-parse-subject SHIPPED 2026-06-16 (ca14120a). 2 open core members remain, both PROMOTED to QUEUED 2026-06-19 (handed off from the re-scoped [[typed-test-fixtures-consolidated-integration-e2e-verify]], which closed on the fixtures-criterion): ledger-ctrl-live-tax-lot-missing-order-fields (rank 1) + ledger-ctrl-funding-reducer-depositid-vs-transferid (rank 2) — both genuine live-money reducer bugs the honest typed fixtures expose, each needing a producer-vs-consumer fork (Complex lane). This theme epic stays parking; its members are worked individually off QUEUED. NOTE: the co-wrong-fixture class this epic kept hitting is now owned by the typed-test-fixtures epic."
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

- ✅ `compliance-ctrl-mandate-snapshot-parse-subject` — **SHIPPED 2026-06-16 (ca14120a).**
  `parseSubject(payload, MandateSchema)` replaced the raw `payload.subject ?? {}` read + casts; its
  `tools/typed-subject-exclusions.json` entry was dropped.
- 🔵 `ledger-ctrl-live-tax-lot-missing-order-fields` — **QUEUED rank 1.** Live-fill tax-lots AND the
  core `RecordFill` reducer read symbol/side/qty/fillPrice that `ORDER_FILLED` never carries → cash
  balance + positions not updated on fills (live + sim); breaks the `accept-decision` e2e. Needs a
  producer-vs-consumer architectural decision; overlaps `broker-ctrl-order-sf-input-contract-gap`.
- 🔵 `ledger-ctrl-funding-reducer-depositid-vs-transferid` — **QUEUED rank 2.** Funding reducer reads
  `depositId`/`withdrawalId`; the real `FundingSnapshot` producer emits `transferId` → RecordDeposit/
  RecordWithdrawal validation fails → cash balance never credited on DEPOSIT/WITHDRAWAL_SETTLED.

Both ledger members were promoted to QUEUED 2026-06-19, handed off from the re-scoped typed-test-fixtures
consolidated verify. This theme epic stays parking; the members are worked individually off QUEUED.

Related dossier: [[project_event_subject_contracts]].
