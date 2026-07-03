---
id: runtime-operational-surface
status: parking
type: tooling
notes: "Runtime §14 Option B: view+executor CLI over derived state, every mutation via the capability seam. Deferred from SPEC 3 (fork Q2)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
epic: runtime-operationalization
epic_role: core
---

# Runtime operational surface (§14 Option B) — view + executor CLI

Deferred from **SPEC 3 forward edge** (`runtime-spec-3-forward-edge-impl`) by the user-approved fork **Q2**
(defer the operational surface to a follow-on). SPEC 3 shipped the forward edge, the six capability
interfaces, the journal, the adapter, the starter pack, and the on-ramp — but **not** the operator-facing
surface, which is orthogonal to SPEC 3's `done_when`.

**What to build.** A `view` + `executor` CLI that:

- **Renders derived state** (read-time, never stored): the single active item, the ranked queue + each
  item's read-time impact (blast / epicPull / freshness), open findings, floor-pending decisions, and
  provenance (which lesson minted which check).
- **Dispatches every mutation through the capability seam** — `runProcedure` / `ask` / `execute` — never
  by touching files directly. The operator surface is a *consumer* of the seam, so it stays harness- and
  project-agnostic exactly like the loop spine (`runtime/engine/loop/`).

**Design basis.** §14 of `docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-impl.md` (Option B —
view+executor). The building blocks already exist and are tested: `plan-next.mjs` (`planNext` /
`computeImpact` / `renderIndex`), `run-watch.mjs` (open findings), the journal (`awaiting` / floor-pending),
and the Claude Code adapter (`runProcedure` / `ask` / `execute`). The surface is assembly + rendering over
these, not new engine logic.

**Trigger (why parking, not queued).** Build once the capability seam is **dogfooded by a real consumer** —
i.e. after the loop spine drives at least one real workstream end-to-end through the adapter — so the
operator surface is shaped by observed need, not speculation. It is a `core` member of the
`runtime-operationalization` epic; its trigger is `runtime-make-it-fire` (the first real consumer of the seam).

Topic dossier: `project_runtime_realization.md`.
