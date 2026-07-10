---
id: runtime-operationalization-leftovers
status: parking
type: epic
notes: "Auto-spun-out 2026-07-10 when the runtime-operationalization delivery epic shipped (all 27 core members terminal; P6 legacy retirement merged acd44767). These are the genuinely-orthogonal captured members the closure-predicate audit confirmed are NOT load-bearing for any of the 7 done_when clauses — they rode along for unified session context. Re-cluster later by backlog-themes into sharper root-cause themes; do not force a fit. Two captured members were dropped as moot (subjects deleted in P6: benchmark-backlog-skill-cost-figures-stale, bef-scenario-tags-reusable-suite) and one was shipped as resolved (runtime-guide-path-to-live-section-stale — GUIDE.md rewritten in P6), so they are NOT here."
done_when: "Each residual finding spun out of runtime-operationalization is resolved, dropped, or re-clustered by backlog-themes into a sharper root-cause theme; all members shipped or dropped."
scope: "The 9 genuinely-orthogonal captured findings surfaced across the runtime-operationalization program, in loose root-cause clusters: (a) ring-boundary purity — from-deploy-gate-runner-ring2-project-bindings (ring-2 deploy-gate-runner binds project paths directly, KNOWN_ESCAPES to shrink to zero); (b) gate-baseline debt — gate-surfaced-source-debt (the 94-path baseline-exclusion ratchet removal contract) + runtime-gate-baseline-semantics (proper diff-aware-gate design); (c) safety-net metachecks — runtime-invariant-safety-metacheck (mechanize 'every active [invariant] check returns 0 on a clean tree') + nx-orphan-test-file-metacheck; (d) intake ergonomics/bug — from-intake-join-theme-cannot-express-epic-role (intake's shapeItems drops epicRole on the join-theme/mint-aggregation arms); (e) tooling/infra — decision-log-utc-date-stamp, runtime-typescript-port (port the runtime .mjs to .ts), worktree-missing-per-package-node-modules-symlink."
references: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# runtime-operationalization — residual findings (leftovers)

Auto-spun-out when the `runtime-operationalization` delivery epic shipped (2026-07-10) with all 27 core
members terminal — the P6 legacy work-driver retirement (`runtime-legacy-retirement`, merge `acd44767`)
was the last core clause. These are the **captured** members that rode along for unified session context
but are **genuinely orthogonal** to the epic's 7 `done_when` clauses (live enforcement + backward-edge +
item-schema + parity oracle + soaked work-driver + operator surface + legacy retired). The captured audit
re-tested each against the closure-predicate test and confirmed **none is load-bearing** (every `done_when`
clause was already demonstrably satisfied by a shipped core member), so none was promoted to core.

**Members (9), by loose root-cause cluster:**

- **Ring-boundary purity**
  - `from-deploy-gate-runner-ring2-project-bindings` — ring-2 `deploy-gate-runner.mjs` imports two
    project-specific modules from outside `runtime/` (`detect-deploy-needed.mjs`, `affected-projects.mjs`);
    currently `KNOWN_ESCAPES`-allowlisted in `import-boundary.test.mjs`. Relocate to ring 3 / inject, then
    shrink the allowlist to zero for a total guard.
- **Gate-baseline debt**
  - `gate-surfaced-source-debt` — the 94-path baseline-exclusion ratchet's binding removal contract.
  - `runtime-gate-baseline-semantics` — the proper diff-aware-gate design (supersedes the ratchet).
- **Safety-net metachecks**
  - `runtime-invariant-safety-metacheck` — mechanize "every active `[invariant]` check returns 0 on a
    clean tree, else it bricks commits" (meta-check checks registry integrity but never runs evaluators).
  - `nx-orphan-test-file-metacheck` — detect orphan test files.
- **Intake ergonomics / bug**
  - `from-intake-join-theme-cannot-express-epic-role` — intake's `shapeItems` writes `epicRole` only on
    the `fold` arm; `join-theme`/`mint-aggregation` silently drop it, so intake-filed theme members default
    to core. (This bug produced the 5 role-missing `from-*` members of the shipped epic.)
- **Tooling / infra**
  - `decision-log-utc-date-stamp` — the decision-log stamps local, not UTC, dates.
  - `runtime-typescript-port` — port the runtime `.mjs` sources to `.ts`.
  - `worktree-missing-per-package-node-modules-symlink` — worktree tooling gap.

**Disposition:** parked as a durable root-cause bucket. A future `backlog-themes` sweep re-clusters these
into sharper themes (several share the "runtime purity / self-hosting debt" root cause) or un-points the
true singletons back to standalone orphans; the bucket dissolves (→ `dropped`) once empty.
