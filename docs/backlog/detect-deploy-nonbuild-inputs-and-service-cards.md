---
id: detect-deploy-nonbuild-inputs-and-service-cards
status: parking
type: tooling
epic: detect-deploy-accuracy
epic_role: core
notes: "detect-deploy over-deploys on non-build-affecting changes: a project.json edit touching only non-build target inputs (nx:run-commands drift checks) fires deploy=true across the event-processor closure, and **/CLAUDE.md service cards hit the unknown-path deploy=true default."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# detect-deploy over-deploys on non-build-affecting project.json + service-card changes

Third `detect-deploy-needed.mjs` over-deploy accuracy gap (siblings: `detect-deploy-scripts-tier0`
unknown-`scripts/`-path default, `detect-deploy-test-lib-reverse-reach-fanout` traversal). Surfaced
during `runtime-check-exclusions-content-ring` (PR #36, 2026-07-06): relocating the check-exclusion
sidecars changed only nx *check-target* input globs in `libs/event-processor/project.json` plus
`services/execution/broker-ctrl/CLAUDE.md`, yet the resolver returned `deploy=true` for **28
services** — a byte-identical artifact. The deploy was correctly skipped by agent override, but the
verdict was wrong.

Two mechanisms, both **over-deploy** (same closure verdict → one homogeneous core item):

1. **project.json non-build-target-input edits.** `libs/event-processor/project.json` was flagged
   "deployed library" purely because `project.json` changed — but the edited `inputs` belonged to
   the `read-model-drift` / `typed-subject-drift` / `card-drift` `nx:run-commands` **check** targets,
   not `build` (`@nx/js:tsc`). The built artifact is unchanged, so no deploy is warranted. The
   detector should classify a `project.json` change confined to non-`build` target `inputs`/config as
   **Tier-0 no-deploy** (only `build`/executor/dependency changes are deploy-affecting).

2. **`**/CLAUDE.md` service cards default to deploy.** `broker-ctrl/CLAUDE.md` hit the conservative
   unknown-path `deploy=true` default (`Unknown paths (defaulted to deploy=true)`). Service-card /
   doc `**/CLAUDE.md` files are Tier-0 docs — same class as the `detect-deploy-scripts-tier0` fix,
   different path.

Cheapest next step: extend `.claude/skills/backlog-next/deploy-paths.md` (+ `detect-deploy-needed.mjs`)
with (a) a non-build-target-input rule for `**/project.json` and (b) a `**/CLAUDE.md` Tier-0 doc rule,
with fixture coverage in the detector's test. Evidence and the manual skip are recorded in PR #36's
body and `runtime-check-exclusions-content-ring`'s `validation_gate`.
