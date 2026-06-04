---
id: broadcaster-construct-doc-sweep
status: shipped
type: tooling
notes: "Swept the pattern-level docs from 6→7 constructs and defined Broadcaster. cdk-patterns SKILL.md gained a §7 Broadcaster section (CircuitBreakerHealDefinition renumbered →§8, flagged as a definition helper not a core construct); create-service SKILL.md, agent-system.md, SYSTEM-ARCHITECTURE.md §97 + construct table, root CLAUDE.md, and user MEMORY.md all now read '7-construct'. Run in an interactive session because the .claude/skills/** + root CLAUDE.md edits are blocked by the auto-mode self-modification guard."
references: []
out_of_scope:
  - "docs/superpowers/plans/* and docs/superpowers/specs/* — point-in-time artifacts, accurate as written when '6-construct' was current"
  - "docs/architecture/SERVICE-INVENTORY.md §610 '2026-04 rewrite aligned to the 6-construct pattern' — historical evolution note, left unchanged"
  - "docs/backlog/bff-publisher-stream-dlq.md — predecessor workstream record stating 'promotes 6-construct pattern to 7', historically accurate"
  - "No code, CDK, or construct-API changes — Broadcaster construct + its consumers (dashboard-bff, investor-bff) and JSDoc were already current from bff-publisher-stream-dlq"
spec: null
plan: null
topic_memory: []
validation_gate: "Doc-only sweep — no code/deploy. detect-doc-derivation=false, detect-deploy-needed=false, `nx affected -t test,lint --base=origin/main` = No tasks were run. grep '6-construct' across docs/.claude/CLAUDE.md returns only the three intentional historical artifacts above. All six prose targets now read '7-construct' and define Broadcaster."
---

# Document the Broadcaster construct (6→7 construct-pattern doc sweep)

> **SHIPPED 2026-06-04** (interactive `/backlog-next` session — the unblock condition the parking note named). All six prose targets below now read "7-construct" and define Broadcaster; cdk-patterns SKILL.md carries the full §7 Broadcaster reference. See `validation_gate`.

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
