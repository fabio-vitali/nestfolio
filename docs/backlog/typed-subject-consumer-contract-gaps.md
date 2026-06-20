---
id: typed-subject-consumer-contract-gaps
status: shipped
type: epic
notes: "Theme epic for cross-domain producer↔consumer contract-shape gaps surfaced by the typed-subject parse-subject conversion (WS-3): a consumer reads a subject/payload field the producer's codified schema never declares. CLOSED 2026-06-20 — all members terminal. Outcomes: compliance-ctrl-mandate-snapshot-parse-subject SHIPPED (ca14120a); ledger-ctrl-funding-reducer-depositid-vs-transferid SHIPPED (310c60fb); alpaca-transfer-request-compound-subject-no-contract DROPPED (already resolved); dwc-sfn-callback-reason-blockreason-gap RE-HOMED OUT (typed-subject gap already closed, residual purely behavioral); ledger-ctrl-live-tax-lot-missing-order-fields RE-HOMED OUT into order-execution-money-path (WS-4) — its fix needs the full producer-side order-execution money-path repair, not a standalone consumer retype. Future findings of this root-cause class now route to the typed-test-fixtures epic (which owns the co-wrong-fixture class)."
done_when: "Each member's producer contract codifies the fields its consumer reads (typed, no casts) and the co-wrong unit fixtures are corrected; every core member shipped or dropped."
scope: "Cross-domain producer↔consumer contract-shape gaps surfaced by the typed-subject parse-subject conversion — a consumer reads a subject/payload field absent from the producer's codified schema."
out_of_scope:
  - "Event-NAME re-declaration drift (adapter-event-name-redeclare-vs-reexport — different mechanism)"
  - "Test-coverage-only gaps with no contract change (advisory-riskcategory-compliance-coverage)"
references: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: "Theme epic drained — rule 9 satisfied, zero open members (core or captured). Member outcomes: compliance-ctrl-mandate-snapshot-parse-subject SHIPPED 2026-06-16 (ca14120a, parseSubject(payload, MandateSchema) replaced raw payload.subject ?? {} + casts, exclusions entry dropped); ledger-ctrl-funding-reducer-depositid-vs-transferid SHIPPED 2026-06-19 (310c60fb, reducer reads FundingSnapshotSchema.parse(p).transferId — DEPOSIT/WITHDRAWAL_SETTLED → BALANCE_UPDATED green against deployed dev); alpaca-transfer-request-compound-subject-no-contract DROPPED (AlpacaTransferRequestSchema already codifies the fields); dwc-sfn-callback-reason-blockreason-gap + ledger-ctrl-live-tax-lot-missing-order-fields RE-HOMED OUT. No deploy/test gate for this close — purely a Doc-layer epic-closure; member validation gates carry the code evidence."
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

## Member outcomes (CLOSED 2026-06-20)

All members terminal — rule 9 satisfied, zero open members.

- ✅ `compliance-ctrl-mandate-snapshot-parse-subject` — **SHIPPED 2026-06-16 (ca14120a).**
  `parseSubject(payload, MandateSchema)` replaced the raw `payload.subject ?? {}` read + casts; its
  `tools/typed-subject-exclusions.json` entry was dropped.
- ✅ `ledger-ctrl-funding-reducer-depositid-vs-transferid` — **SHIPPED 2026-06-19 (310c60fb).** Funding
  reducer now reads `FundingSnapshotSchema.parse(p).transferId` instead of the phantom
  `depositId`/`withdrawalId`; RecordDeposit/RecordWithdrawal validation passes → cash balance credited
  on DEPOSIT/WITHDRAWAL_SETTLED. Verified against deployed dev (BALANCE_UPDATED green).
- ❌ `alpaca-transfer-request-compound-subject-no-contract` — **DROPPED.** Already resolved:
  `AlpacaTransferRequestSchema` codifies the fields; producer emits typed, consumer `parseSubject`s it.
- ↪ `dwc-sfn-callback-reason-blockreason-gap` — **RE-HOMED OUT.** Typed-subject gap already closed; the
  residual (`derive blockReason from violations`) is purely behavioral, not a contract-shape gap.
- ↪ `ledger-ctrl-live-tax-lot-missing-order-fields` — **RE-HOMED OUT into `order-execution-money-path`
  (WS-4).** Its fix needs the full producer-side order-execution money-path repair (broker SF empirically
  881/881 FAILED, `ORDER_FILLED` drops symbol/side), not a standalone consumer retype.

The co-wrong-fixture root-cause class this epic kept hitting is now owned by the **typed-test-fixtures**
epic; future findings of this shape route there.

Related dossier: [[project_event_subject_contracts]].
