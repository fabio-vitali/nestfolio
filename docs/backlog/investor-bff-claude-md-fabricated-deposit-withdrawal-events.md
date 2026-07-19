---
id: investor-bff-claude-md-fabricated-deposit-withdrawal-events
status: parking
type: doc
notes: "investor-bff CLAUDE.md claims DEPOSIT_UPDATED/WITHDRAWAL_UPDATED events that don't exist, omits the real MANDATE_REAFFIRMED, and undercounts tests by 7."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-bff CLAUDE.md fabricates deposit/withdrawal events

HARD-FAIL finding. `services/investor/investor-bff/CLAUDE.md` prose claims
`DEPOSIT_UPDATED`/`WITHDRAWAL_UPDATED` events that don't exist anywhere in
`service.stack.ts:83-101`; omits the real `MANDATE_REAFFIRMED` event; contradicts its own
generated block; and undercounts by 7 missing test files.
