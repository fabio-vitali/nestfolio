---
id: bef-scenario-tags-reusable-suite
status: parking
type: tooling
notes: "Add self-declaring `tags: [...]` to scenarios + a runner `--tag=` filter, so a reusable named subset (e.g. core) can be re-run identically before/after backlog-skills-simplification. Build when that epic starts; pin membership only after the corpus is green."
references: []
out_of_scope:
  - "Pinning the canonical subset membership now — defer until bef-baseline-surfaced-scenario-failures gates green (don't canonize a red subset)."
  - "The final simplification sign-off run — that wants a prose-weighted / full-corpus compare, not the cheap named subset (see body)."
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
epic: backlog-eval-corpus-hardening
epic_role: captured
---

# Reusable eval subset via scenario tags + `--tag` filter

Came out of the 2026-06-27 right-sized baseline ([[backlog-eval-framework-baseline-run]]): the 15-scenario
subset existed only as an ad-hoc `--scenario=<comma-list>` I typed. For [[backlog-skills-simplification]]
to get a valid before/after, it must re-run the **exact same** scenarios both times — a fragile retype
if the set lives as a CLI string.

**Design (small — ergonomics, not new capability).** `regression` and `compare` already accept
`--scenario=<ids>` (`run.mjs` filters on a `Set`), and `compare main <branch> --scenario=<subset>` is
already the A/B tool. Add:
- a self-declaring **`tags: ['core', ...]`** field on each `*.scenario.mjs`;
- a runner **`--tag=<name>`** filter (compose with the existing `--skill` / `--scenario`).

**Why tags, not a central `suites.mjs` id-list.** A central hardcoded list drifts out of sync with the
corpus — exactly the failure mode of [[benchmark-backlog-skill-cost-figures-stale]] (a hardcoded "6
scenarios" count that rotted). Self-declaring tags don't drift; a new scenario opts itself in; tags
generalize (`smoke` / `core` / `full`, or per-skill tags). This is the liftable pattern.

**Two honest caveats (do NOT skip).**
1. **Don't pin membership until the corpus is green.** [[bef-baseline-surfaced-scenario-failures]] still
   has reds; tagging a 40%-red set as `core` canonizes a non-reference. Build the mechanism freely; pick
   the members after those gate green.
2. **A named subset is the cheap *iteration loop*, not the final verdict.** The most informative compare
   for simplification is the scenarios that exercise the prose being shrunk (`backlog-next` /
   `backlog-next-epic` heavy) — likely a different/larger set, with a **full-corpus compare for sign-off**.
   Don't let one fixed "quick suite" become the only proof.

**Zero-build floor:** if this is never built, save the exact `--scenario=<ids>` + `compare` invocation
in this item / the dossier — `--scenario` already gives reproducibility for one before/after.
