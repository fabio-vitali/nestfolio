---
id: runtime-operational-surface
status: shipped
closed: 2026-07-08
type: tooling
notes: "Runtime §14 Option B: view+executor CLI over derived state, every mutation via the capability seam. Deferred from SPEC 3 (fork Q2)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: "Commit fdbaa8eb on main (ELEVENTH runtime-driven workstream — run-next.mjs 3(execute)→3(ship floor)→0, lane=simple, fallback-free). runtime suite 421/421 (`pnpm nx run runtime:test`) + runtime:typecheck clean + true-affected `nx run-many -t test,lint -p runtime,tools` exit 0. New teeth: OS1–OS6 (engine) + RV1–RV4 (adapter) + CF1/CF2 conformance extended to run-view.mjs. ship-recheck gate-clean journaled (ship:runtime-operational-surface:gate-clean @ fdbaa8eb); mint-considered --none. Dogfood proof: `node runtime/adapters/claude-code/run-view.mjs` rendered THIS drive's own floor-pending park with its exact resume command."
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

**Design basis.** §14 of `docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md` (Option B —
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

## Ship narrative (2026-07-08)

Shipped as commit `fdbaa8eb` (Simple lane on main). **Ring-1** `runtime/engine/lib/operational-surface.mjs`:
`deriveSurface` (read-time assembly over `planNext`/`computeImpact` + injected journal + registry — active,
ranked queue with impact, floor-pending across ledgers, open findings from ledger evidence records
last-write-wins per key, enforcement provenance), `renderSurface` (the §13.9 legibility spine), `executeOp`
(mutations ONLY via `runProcedure`/`execute`; deliberately NO merge/ship op kind — those stay floor asks,
§4.3). `journal.mjs` gained `listRunIds` (the journal owns its own layout). **Ring-2**
`runtime/adapters/claude-code/run-view.mjs`: `view` (read-only, lease-free; merges `run-audit` artifacts
into findings; prints per-runId **resume hints** mapping runId prefix → owning driver — the observed
operator pain from ten drives) + `exec` via `makeDriverCapabilities` (judged). The read-only surface
REJECTS `--fulfil`/`--value` (exit 2 + usage) so there is no second write path; CF1 discovery-totality
auto-caught the new adapter and forced the conformance TABLE entry — the mechanism working as designed.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Named parking item runtime-operational-surface via /backlog-next <id> --auto: rule-8 refusal surfaced — promote or stop?
- **Options:** Promote to queued (rank 4) and proceed with this --auto run | Promote only, work later | Leave in parking
- **Chosen:** Promote to queued (rank 4) and proceed with this --auto run
- **Rationale:** Parking trigger (seam dogfooded by a real consumer — runtime-make-it-fire) demonstrably fired: PR#30 shipped 2026-07-03, P5 soak gate closed 2026-07-08 with 6 fallback-free runtime-driven workstreams and oracle green 17/17. Epic done_when clause 6 names this item as the next core in the locked migration-completion order. User approved via AskUserQuestion (never silently promoted).
- **Rejected:** Promote-only defers clause 6 for no reason with the trigger long fired; leaving it parked stalls the epic close sequence (clause 7 legacy retirement is gated behind this item).

### D2 — 2026-07-08
- **Decision:** Ship floor + 6.4b mint consideration for runtime-operational-surface
- **Options:** Ship + nothing to mint | Ship + mint a new check | Ship + file follow-up | Hold
- **Chosen:** Ship + nothing to mint
- **Rationale:** Pre-ship batch (lane=simple) + ship gate + ship-recheck gate-clean; runtime 421/421 + typecheck green; live render dogfooded against this very drive. Mint --none recorded: CF1 discovery-totality already mechanized the new-adapter conformance (auto-caught run-view.mjs), and the judged-capabilities sweep gap is already filed as captured member from-run-themes-intake-bare-capabilities-conformance-gap. User approved via AskUserQuestion.
- **Rejected:** Minting would re-mechanize lessons CF1/DC3 already carry; holding had no failing evidence behind it.
