---
id: runtime-operational-surface
status: queued
rank: 4
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

**Trigger fired — promoted 2026-07-08 (user-approved, D1).** The parking trigger was "the capability seam
is dogfooded by a real consumer" (`runtime-make-it-fire`). That fired long ago and then some:
`runtime-make-it-fire` shipped 2026-07-03 (PR#30), and the P5 soak gate closed 2026-07-08
(`runtime-replatform-soak-gate`) with **6 fallback-free runtime-driven workstreams** through
`run-next.mjs` and the parity oracle green 17/17 — the operator surface is now shaped by ten real
drives' worth of observed need. It is a `core` member of the `runtime-operationalization` epic
(`done_when` clause 6), sequenced before `runtime-legacy-retirement` (clause 7).

Topic dossier: `project_runtime_realization.md`.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Named parking item runtime-operational-surface via /backlog-next <id> --auto: rule-8 refusal surfaced — promote or stop?
- **Options:** Promote to queued (rank 4) and proceed with this --auto run | Promote only, work later | Leave in parking
- **Chosen:** Promote to queued (rank 4) and proceed with this --auto run
- **Rationale:** Parking trigger (seam dogfooded by a real consumer — runtime-make-it-fire) demonstrably fired: PR#30 shipped 2026-07-03, P5 soak gate closed 2026-07-08 with 6 fallback-free runtime-driven workstreams and oracle green 17/17. Epic done_when clause 6 names this item as the next core in the locked migration-completion order. User approved via AskUserQuestion (never silently promoted).
- **Rejected:** Promote-only defers clause 6 for no reason with the trigger long fired; leaving it parked stalls the epic close sequence (clause 7 legacy retirement is gated behind this item).
