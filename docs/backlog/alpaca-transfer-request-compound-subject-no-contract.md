---
id: alpaca-transfer-request-compound-subject-no-contract
status: parking
epic: typed-subject-consumer-contract-gaps
epic_role: core
rank: null
type: refactor
notes: "Surfaced 2026-06-12 by consumer-parse-subject (WS-3) while typing broker-alpaca-adpt's event-listener. broker-ctrl's deposit-withdrawal-router emits ALPACA_TRANSFER_REQUESTED with a COMPOUND subject — it merges the inbound DepositInitiated|WithdrawalInitiated payload and ADDS routing fields (direction, transferId, relationshipId, and `amount` rather than the schema's `amountCents`). broker-alpaca-adpt/src/handlers/event-listener.ts reads s.direction / s.amount / s.transferId / s.relationshipId, NONE of which exist on DepositInitiatedSchema or WithdrawalInitiatedSchema (investor-adpt/domain), which carry amountCents and no transferId/relationshipId. So there is no single producer contract that types ALPACA_TRANSFER_REQUESTED — WS-3 (D3: author no new contracts) correctly classified it as a documented boundary (the read works at runtime via the router's compound subject; it is just untyped). Fix: have broker-ctrl's deposit-withdrawal-router export a dedicated AlpacaTransferRequest zod contract (broker-ctrl/contracts) describing the compound shape it actually emits {direction, transferId, relationshipId, amount|amountCents, ...}, and have broker-alpaca-adpt import it intra-domain (broker-alpaca←broker-ctrl) and parseSubject against it — removing the boundary. Likely shares root cause with broker-funding-completed-normalization-drift (the sim-vs-alpaca funding field-name drift: amount vs amountCents) and broker-ctrl-order-sf-input-contract-gap (the order SF input shape). Consider designing one coherent broker-ctrl router emission contract covering the funding/transfer routing events. Promote when authoring broker-ctrl router contracts or hardening the live transfer path."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# ALPACA_TRANSFER_REQUESTED compound subject has no producer contract

Surfaced by the WS-3 typed-subject consumer conversion.

## Finding

`broker-alpaca-adpt/src/handlers/event-listener.ts` reads `s.direction`, `s.amount`,
`s.transferId`, `s.relationshipId` off the `ALPACA_TRANSFER_REQUESTED` subject. None of those
fields are on `DepositInitiatedSchema` / `WithdrawalInitiatedSchema` (the investor-adpt contracts —
they carry `amountCents`, no `transferId`/`relationshipId`). The event is emitted by broker-ctrl's
`deposit-withdrawal-router`, which merges the inbound deposit/withdrawal payload and adds routing
fields — a **compound subject** that no single exported zod contract describes.

## WS-3 disposition

Out of WS-3 scope (D3 = author no new contracts; consumer-typing only). WS-3 classified the read as a
documented boundary. The read works at runtime; it is simply untyped.

## Fix

broker-ctrl's router should export an `AlpacaTransferRequest` contract for the exact compound shape it
emits; broker-alpaca-adpt imports it intra-domain and `parseSubject`s against it, removing the
boundary. Likely best designed together with `broker-funding-completed-normalization-drift` (sim/alpaca
`amount` vs `amountCents` drift) and `broker-ctrl-order-sf-input-contract-gap` — all three are facets of
broker-ctrl's router emission shapes lacking contracts.
