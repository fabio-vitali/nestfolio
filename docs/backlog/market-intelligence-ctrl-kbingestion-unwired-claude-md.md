---
id: market-intelligence-ctrl-kbingestion-unwired-claude-md
status: parking
type: doc
notes: "market-intelligence-ctrl CLAUDE.md documents KBIngestion Lambda as event-triggered, but it has zero Ingress wiring in service.stack.ts — dead/unwired."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: claude-md-arch-doc-drift
epic_role: core
---

# market-intelligence-ctrl CLAUDE.md documents unwired KBIngestion Lambda

HARD-FAIL finding. `services/advisory/market-intelligence-ctrl/CLAUDE.md:50,61` documents the
`KBIngestion` Lambda as event-triggered, but `service.stack.ts:39-53,100-112,202` shows it has no
`Ingress` wiring at all — the card describes wiring that doesn't exist.
