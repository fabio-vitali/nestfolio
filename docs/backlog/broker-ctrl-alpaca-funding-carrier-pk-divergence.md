---
id: broker-ctrl-alpaca-funding-carrier-pk-divergence
status: parking
type: bug
notes: "Live/ALPACA funding: router keys requested carrier on depositId/withdrawalId but completion normalizer keys on transferId — carry-forward misses if they differ (degrades gracefully). Sim path unaffected."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# broker-ctrl ALPACA funding carrier pk divergence

Surfaced 2026-05-31 during w5 Phase 2 spec+quality review of the Funding aggregate
(commits `49ea26dd..faf95405`).

## What

On the **live / ALPACA** funding path, the two carrier writers key the `Funding#`
aggregate row on different identifiers:

- **Router** (`services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts`)
  writes the `requested` carrier (v1) under
  `pk = Funding#<tid>#<depositId | withdrawalId ?? ctx.eventId>`.
- **Normalizer** (`services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts`)
  on `ALPACA_TRANSFER_COMPLETED` / `ALPACA_TRANSFER_FAILED` resolves the transfer
  under `subject.transferId` (falling back through `depositId | withdrawalId | transferId | eventId`).

If a live transfer's intent id (`depositId`/`withdrawalId`) differs from the broker's
`transferId`, the v1 `requested` carrier and the v2/v3 `detected`/`settled`/`failed`
carriers land under **different pks**. `FundingRepository.getRequested()` then misses,
and the later carriers fall back to inbound-subject fields for `initiatedAt`/`amountCents`/
`currency`/`userId`.

## Impact

Degrades gracefully — **no crash, no lost settlement** (the settled carrier still carries
amount/settledAt from the subject; ledger still applies cash). The only loss is the
carried-forward `initiatedAt` (and any field the ALPACA subject omits) on the lifecycle
projection for live deposits/withdrawals.

## Scope

**Live / ALPACA only.** The sim path uses a consistent `depositId`/`withdrawalId`
end-to-end (router → broker-sim-adpt → normalizer), so carry-forward always hits and the
sim path — the only one exercised by w5 e2e — is unaffected.

## Why parked

Real-broker (Alpaca) funding rails are explicitly **out of scope** for w5 (see
`docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md`
§ externally-settled entities / decisions; the w5 plan keeps the `ALPACA_*` handlers wired
but does not implement or validate real-money funding). **Promote when real-broker Alpaca
funding integration is picked up.**

## Fix direction

Either:
1. Have the router key the `requested` carrier on the same id the broker will echo back as
   `transferId`, or
2. Have the Alpaca adapter echo the original `depositId`/`withdrawalId` as `transferId` in
   its completion/failure events (so the pk is stable across the lifecycle).

Related: `bff-readmodel-w5-externally-settled-entities`. See [[project_read_model_redesign]].
