---
id: broadcaster-construct-doc-sweep
status: parking
type: tooling
notes: "The Broadcaster construct (added by bff-publisher-stream-dlq) promotes the canonical CDK pattern 6→7, but the pattern-level docs still say '6-construct' and don't define Broadcaster. The cdk-patterns + create-service SKILL.md and root CLAUDE.md edits are blocked by the auto-mode self-modification guard in an automated /backlog-next session — do them atomically in an interactive/authorized session so the doc layer never half-updates."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Document the Broadcaster construct (6→7 construct-pattern doc sweep)

`bff-publisher-stream-dlq` added a 7th first-class construct, `Broadcaster`
(`libs/cdk-constructs/src/core/broadcaster.ts`), and refactored the two BFF
stream-broadcast publishers onto it. The code, tests, JSDoc, and the two service
cards (`dashboard-bff`, `investor-bff`) are current. The **pattern-level** docs
are not — they still say "6-construct" and do not define `Broadcaster`.

## Sweep (do atomically — keep the doc layer consistent)
- `.claude/skills/cdk-patterns/SKILL.md` — title + description "6"→"7"; add Broadcaster
  to "When This Skill Applies"; add a `broadcasters: []` line to the `addObservability()`
  example; add a `### 7. Broadcaster` section (renumber CircuitBreakerHealDefinition to #8,
  noting it is a specialized definition helper, not a core construct); add Broadcaster to the
  BFF row of the Service Archetypes table; add `broadcaster.ts` to Reference Files.
- `.claude/skills/create-service/SKILL.md` — "(6-construct model)" → "(7-construct model)".
- `docs/agent-system.md` — cdk-patterns skill description row "6-construct ... Orchestration"
  → add Broadcaster.
- `docs/architecture/SYSTEM-ARCHITECTURE.md` §97 (principle 3) — "6-construct CDK pattern"
  → 7; cite `broadcaster.ts`.
- root `CLAUDE.md` (lines ~41-42) — "6-construct pattern (... Orchestration)" + "All 6
  constructs are consumer-instantiated" → 7 + Broadcaster.
- user-memory `MEMORY.md` architecture section — "6-construct CDK pattern" → 7 + Broadcaster.

**Leave historical artifacts unchanged:** `docs/superpowers/plans/*`, `docs/superpowers/specs/*`,
and `SERVICE-INVENTORY.md`'s "2026-04 rewrite aligned to the 6-construct pattern" note are
point-in-time and accurate as written.

## Why filed, not fixed inline
Surfaced 2026-06-04 during `bff-publisher-stream-dlq`'s closing phase (Step 6.1
doc derivation). The `.claude/skills/**` and root `CLAUDE.md` edits were denied by
the auto-mode classifier as self-modification of agent logic — correctly, in an
automated session. Filed so the whole sweep lands together in one authorized pass,
rather than half-updating the allowed docs now and leaving the blocked ones drifting.
