---
id: runtime-design-redteam
status: parking
type: design
epic: runtime-operationalization
epic_role: captured
notes: "P1b: adversarial multi-agent design review of the vision + 3 frozen specs vs the shipped code — seam sufficiency, journal crash/resume matrix, floor ergonomics headless, portability/second-host reality, legacy-parity matrix. Output: verdict (solid / solid-with-deltas / redesign-needed) + re-freeze delta list. De-risking, orthogonal to done_when (captured)."
references:
  - docs/vision/long-horizon-engineering-runtime.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge-learning-loop.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime design red-team — adversarial review of the paper vs the code

Complement to the empirical `runtime-seam-probe`: probes catch what real contact reveals; a red-team
catches what probes can't reach (long-horizon properties, crash matrices, multi-host claims). Run as an
ultracode multi-agent review — independent adversarial finders per dimension, skeptic verification pass,
synthesized verdict.

**Dimensions:**

1. **Execute-seam sufficiency** — `Task`/`TaskResult` vs what `/backlog-next` actually does.
2. **Journal crash/resume matrix** — torn writes, concurrent runs, key collisions, worktrees sharing the
   git-common-dir, sha-freshness vs step-replay semantics.
3. **Floor protocol headless** — is the `<<HARNESS-PAUSE>>` → `awaiting` → `fulfil` resume path actually
   reachable end-to-end? Who re-wakes a paused run?
4. **Watch/selection semantics** — context dedup, cost ceilings, diff-scoping attribution vs selection,
   the unconditional invariant floor.
5. **Backward-edge integrity** — lifecycle/provenance chains, `mints:` reconciliation, skip-hatch threat.
6. **Portability claims** — ring boundary reality, second-host feasibility, starter-pack/cold-start.
7. **Legacy-parity matrix** — every capability of the current backlog system vs its runtime equivalent
   (feeds `runtime-regression-harness`).

**Output:** verdict + prioritized findings + spec re-freeze deltas, recorded in this file's body at ship.

Roadmap: P1b of the probes-first adoption plan (see epic body).
