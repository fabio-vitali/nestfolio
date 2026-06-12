---
id: service-card-funding-event-type-drift
status: dropped
type: bug
notes: "[SUPERSEDED -> service-card-drift-gate] 2026-06-12. The class fix (deterministic card-drift gate) was split out of the typed-subject capstone into its own item service-card-drift-gate, which subsumes this concrete 3-card symptom (the stale cards are listed there as the gate's first regression target). Originally: several service cards list stale funding-lifecycle event-type names (pre-existing doc drift)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Service card funding event-type drift

Pre-existing doc-accuracy drift surfaced by the closing-phase card audits during
`event-subject-payload-build-tripwire` (NOT introduced by it — predates it, from the
funding-lifecycle event-name evolution). No code impact; cards only.

Affected cards:
- `services/execution/broker-ctrl/CLAUDE.md` — Egress/Ingress/Event-Type sections stale w.r.t.
  the funding-lifecycle + FundingEvent-CDC work; `WITHDRAWAL_INITIATED` vs `WITHDRAWAL_REQUESTED`.
- `services/investor/investor-adpt/CLAUDE.md` — `InvestorIngestEventTypes` list still names
  `WITHDRAWAL_COMPLETED`/`TRANSFER_FAILED`; code now uses `DEPOSIT_REQUESTED/SETTLED/FAILED`,
  `WITHDRAWAL_REQUESTED/SETTLED/FAILED`.
- `services/investor/investor-bff/CLAUDE.md` — Ingress section + the `event-listener.ts` handler
  line omit the full `DEPOSIT_*`/`WITHDRAWAL_*` funding-lifecycle subscriptions the handler wires.

Cheapest fix: re-run `audit-service` for these three (or a targeted touch-up) to align the
Ingress / Event-Types / Handlers sections with current `events.ts` + `event-listener.ts`.

**Class fix:** the root cause (cards regenerate on-demand with no standing gate, so code
drifts silently) is folded into `typing-convention-enforcement-skills-docs` as a deterministic
CLAUDE.md card-drift gate. This entry is the immediate 3-card symptom; it is subsumed by that
gate when it lands.
