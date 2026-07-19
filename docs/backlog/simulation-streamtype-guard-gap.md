---
id: simulation-streamtype-guard-gap
status: parking
type: epic
notes: "Simulation-tagged BALANCE_UPDATED/PORTFOLIO_UPDATED events lack a streamType guard in downstream ledger-domain consumers, letting simulated data corrupt real read-models/caches and loop back. Theme epic, 3 members."
done_when: "Every in-scope ledger-domain consumer of BALANCE_UPDATED/PORTFOLIO_UPDATED branches on streamType before writing to a canonical real-user row or cache, matching the already-correct ledger-entry-recorded.ts pattern; the traced feedback loop no longer round-trips simulated data into a real projection; all 3 members shipped or dropped."
scope: "Ledger-domain consumers of simulation-taggable events (BALANCE_UPDATED, PORTFOLIO_UPDATED) that write into a canonical real-user read-model or cache without branching on streamType, including the resulting cross-domain feedback-loop consequence of that gap."
out_of_scope:
  - "The ledger-ctrl simulation branch's own existence/documentation (already-shipped ledger-ctrl-undocumented-simulation-branch) — this theme is the downstream consequence of unfiltered simulated writes, not the simulation feature's documentation"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Simulation streamType-guard gap

Root cause: `ledger-ctrl` genuinely emits `BALANCE_UPDATED`/`PORTFOLIO_UPDATED` for advisory decision-packet simulations (tagged via `streamType`), but two downstream consumers project/cache them without checking that tag — `ledger-bff`'s `balance-updated.ts`/`portfolio-updated.ts` transforms write straight into the canonical `Portfolio#{tenantId}` row (the sibling `ledger-entry-recorded.ts` transform correctly branches on `streamType`, proving this is an asymmetric bug, not a designed behavior), and `reconciliation-ctrl`'s event-listener caches every `PORTFOLIO_UPDATED` as reconciliation intent with the same missing guard. The traced consequence closes a full cycle: DWC `DECISION_PACKET_CREATED` → ledger-ctrl simulated write → unfiltered `PORTFOLIO_UPDATED` → advisory-adpt pulls it back → DWC's own next-cycle snapshot projector consumes it — so a simulation can corrupt what a real user sees and feed back into the next advisory cycle. Fix pattern: add the same `streamType` branch already used correctly in `ledger-entry-recorded.ts` to both `ledger-bff` transforms and `reconciliation-ctrl`'s cache write.

Members (derived from `epic:` pointers):
- `simulated-portfolio-corrupts-real-balance-readmodel`
- `simulated-portfolio-poisons-reconciliation-intent-cache`
- `decision-packet-simulation-loop-back-into-dwc-ledger-snapshot`
