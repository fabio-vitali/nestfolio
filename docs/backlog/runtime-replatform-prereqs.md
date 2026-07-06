---
id: runtime-replatform-prereqs
status: active
rank: 4
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "P5 shared prerequisites for the work-driver strangler (spec §4–§7): the RUNTIME_ENGINE flag + path-provenance journal records, the scripts/parity-oracle/soak-observer.mjs go/no-go instrument, the parity-oracle extension mechanism (map the 42 unmapped:'P5' scenarios; path:runtime grade assertion), and the 3 red-team parity-hole fixes (Finding.check optional + agent-observed sentinel; themes cold-path clustering + leftovers spin-out; MEMORY↔backlog dossier-sync). Lands first — every per-skill re-platform depends on it."
references:
  - docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
out_of_scope:
  - "Re-platforming any of the 4 skills — that is runtime-replatform-{add,lint,next,next-epic}."
  - "Deleting legacy skill bodies (P6, user-triggered)."
  - "Re-designing frozen ring-1 contracts beyond making Finding.check optional (a spec §7 delta re-freezes into SPEC 1)."
spec: docs/superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Re-platform prerequisites — flag, soak observer, oracle extension, 3 parity holes

The shared foundation for the work-driver strangler migration, per
[the strategy spec](../superpowers/specs/2026-07-06-runtime-work-driver-replatform-design.md) §4–§7.
Ships before any per-skill re-platform.

**Deliverables:**

1. **`RUNTIME_ENGINE` flag + path-provenance** (spec §4) — `Boolean(process.env.RUNTIME_ENGINE)` (mirroring
   `RUNTIME_GATE_SKIP` at `runtime/adapters/git/pre-commit-gate.mjs:19`), toggled at the adapter CLIs.
   Hard cutover: runtime-path failure pauses at the floor, never silently falls back. Every runtime run
   journals `path:runtime`; a deliberate legacy fallback journals `path:legacy-fallback` (loud, countable).
2. **`scripts/parity-oracle/soak-observer.mjs`** (spec §5) — reads the git journal across real workstreams;
   verdict = ≥5 distinct `path:runtime` workstreams AND zero `path:legacy-fallback` AND oracle green.
3. **Parity-oracle extension** (spec §6) — the mechanism to map the 42 `unmapped:'P5'` scenarios as skills
   migrate, plus a `path:runtime` assertion in `scripts/parity-oracle/runtime-grade.mjs`.
4. **The 3 parity-hole fixes** (spec §7): (#1) `Finding.check` optional + `agent-observed` sentinel;
   (#2) themes cold-path clustering procedure + `<epic>-leftovers` spin-out; (#3) dossier-sync side-car.

Depends on: nothing open (all 4 program deps shipped 2026-07-06). Blocks: the 4 per-skill members + soak-gate.
