---
id: backlog-eval-corpus-hardening-leftovers
status: dropped
type: epic
notes: "DISSOLVED 2026-06-29 by backlog-themes. The 3 captured members were genuinely heterogeneous (a latent harness bug, an ergonomics feature, a doc nit) sharing no single root cause, so each un-pointed to a standalone parking ORPHAN rather than forced into a theme. Bucket emptied → dropped (done_when 'each residual finding... re-clustered or dropped' satisfied). Originally auto-spun-out when backlog-eval-corpus-hardening shipped (2026-06-29)."
done_when: "Each residual finding spun out of the backlog-eval-corpus-hardening epic is resolved, dropped, or re-clustered by backlog-themes into a sharper root-cause theme; all members shipped or dropped."
scope: "The 3 genuinely-orthogonal captured findings surfaced by the backlog-eval-corpus-hardening program: a latent bef judge harness bug (sub-worktree-diff blindness, harmless today because no current rubricGate scenario's assessment needs the sub-worktree diff — proven by the all-green/no-flip full-corpus baseline), an ergonomics feature (self-declaring scenario tags + a --tag runner filter for reusable named subsets), and a doc-drift fix (benchmark-backlog/SKILL.md hardcodes a stale '6 bne scenarios' cost figure vs the live corpus)."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# backlog-eval-corpus-hardening — residual findings (leftovers)

Auto-spun-out when the `backlog-eval-corpus-hardening` delivery epic shipped (2026-06-29) with all 5
core members terminal and the committed full-corpus baseline green. These are the **captured** members
that rode along for unified session context but are **genuinely orthogonal** to the epic's `done_when`
(committed full-corpus baseline + every scenario gates deterministically + drive-to-ship routes to a
stubbed finishing skill + all core members shipped/dropped) — the captured audit (E7.1) re-tested each
against that predicate and confirmed none is load-bearing:

- `bef-judge-blind-to-subworktree-diff` — a **latent** harness bug. The all-green, no-flip 50-scenario
  baseline proves "every scenario gates deterministically" holds with it unfixed (no current rubricGate
  scenario's assessment depends on the judge seeing the sub-worktree diff); it would only matter if such
  a scenario were later added.
- `bef-scenario-tags-reusable-suite` — an **ergonomics** feature (tags + `--tag` filter) for the
  *consumer* epic `backlog-skills-simplification`; its own note says "build when that epic starts." Not
  required for the baseline to exist or gate deterministically.
- `benchmark-backlog-skill-cost-figures-stale` — a **doc-drift** fix (the SKILL.md cost gate hardcodes
  "6 bne scenarios"; the live corpus is far larger). `done_when` says nothing about SKILL.md doc accuracy.

**Dissolved 2026-06-29** by a `backlog-themes` sweep. The three were genuinely heterogeneous (a harness
bug, an ergonomics feature, a doc nit) with **no single coherent root cause** — so, rather than force a
fit, each un-pointed back to a standalone parking **orphan** (a valid, honest disposition). The
provenance bucket is now **dropped**: its `done_when` ("each residual finding... resolved, dropped, or
re-clustered by backlog-themes") is satisfied, and no `*-leftovers` shell lingers.

Members: none — all re-homed to standalone orphans:
- `bef-judge-blind-to-subworktree-diff` → orphan (distinct root cause: bef judge EVIDENCE-completeness bug — the grader is blind to sub-worktree diffs — orthogonal to the deterministic-teeth coverage gaps in [[bef-deterministic-coverage-gaps]]; different fix)
- `bef-scenario-tags-reusable-suite` → orphan (ergonomics feature, singleton)
- `benchmark-backlog-skill-cost-figures-stale` → orphan (doc-drift nit, singleton)
