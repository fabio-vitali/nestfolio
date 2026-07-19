---
id: claude-md-arch-doc-drift
status: parking
type: epic
notes: "Architecture docs (CLAUDE.md service cards, SERVICE-INVENTORY.md, SYSTEM-ARCHITECTURE.md) drift from code with no automated freshness gate — only periodic audit-system sweeps catch it. Theme epic, 5 members."
done_when: "Each in-scope architecture doc is corrected to match current code (stale test enumerations, omitted entities, fabricated/dead event claims) and the 4 hard-fail wiring-claim errors are fixed; all 5 members shipped or dropped."
scope: "Architecture-layer documentation (service CLAUDE.md cards, docs/architecture/SERVICE-INVENTORY.md, docs/architecture/SYSTEM-ARCHITECTURE.md) that has drifted from the code it describes, surfaced only by periodic audit-system sweeps because no automated gate ties it to code — stale test-file enumerations, omitted DDB entities, and outright fabricated event/wiring claims."
out_of_scope:
  - "Flow-spec (flows/*.flow.yaml) drift — a different doc surface with its own theme (flow-spec-documentation-drift)"
  - "C4/flow-doc generator coverage gaps (diagram-generator-gaps) — a generator-capability gap, not hand-maintained doc staleness"
  - "The orient/domains skill drift guard — already covered by its own hard gate (audit-system item 5), not drifting here"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# CLAUDE.md / architecture-doc freshness gate gap

Root cause: service `CLAUDE.md` cards and the top-level `docs/architecture/SERVICE-INVENTORY.md` / `SYSTEM-ARCHITECTURE.md` docs are regenerated or hand-edited only on demand, with no automated gate checking them against code between `audit-system` sweeps — so they silently drift. Two severities surfaced in the 2026-07-19 full re-audit: (1) genuine fabrication — `SERVICE-INVENTORY.md`/`SYSTEM-ARCHITECTURE.md` citing event names that don't exist in code at all; `market-intelligence-ctrl`'s CLAUDE.md documenting a Lambda as event-triggered when it has zero Ingress wiring; `investor-bff`'s CLAUDE.md claiming events that don't exist while omitting a real one; `onboarding-bff`'s CLAUDE.md claiming an inbound subscription the service doesn't have at all (service has no Ingress construct) — 4 hard-fail members; (2) a cross-cutting staleness pattern — 17 services' CLAUDE.md cards under-enumerate test files or omit DDB entities, most commonly missing `domain/contracts.test.ts` / `publisher-schemas.test.ts`, suggesting a shared card-generator gap rather than 17 independent edits — grouped as the 5th member. Fix pattern: correct each doc to match code now; consider whether the card generator (or its invocation cadence) should be the actual fix for the staleness-pattern member rather than 17 hand-patches.

Members (derived from `epic:` pointers):
- `claude-md-service-cards-stale-test-enumerations`
- `market-intelligence-ctrl-kbingestion-unwired-claude-md`
- `investor-bff-claude-md-fabricated-deposit-withdrawal-events`
- `onboarding-bff-claude-md-drift`
- `service-inventory-fabricated-event-names`
