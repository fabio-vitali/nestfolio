---
id: detect-deploy-scripts-tier0
status: parking
type: tooling
notes: "detect-deploy-needed.mjs TIER0 lacks a scripts/ rule, so any scripts/ change (benchmark-backlog, benchmark-agents) hits the conservative unknown-path default deploy=true and must be agent-overridden every close. Add /^scripts\\// to TIER0 (+ the deploy-paths.md doc row)."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: deploy-tooling-integrity-leftovers
epic_role: core
---

# detect-deploy-needed: classify scripts/ as Tier 0 (no-deploy)

`.claude/skills/backlog-next/detect-deploy-needed.mjs` `TIER0` lists `tools/`, `.claude/`, `docs/`,
etc. but **not** `scripts/`. Top-level `scripts/` is repo/benchmark tooling (`benchmark-backlog`,
`benchmark-agents`) that runs locally and is never a deploy artifact (real deploy logic lives under
`infrastructure/scripts/`, already Tier 1). Because of the omission, every `scripts/` workstream's
close flags `deploy=true — N unknown path(s) — conservative default` and the agent must use the
documented override (deploy-paths.md §"Default rule") to skip the deploy.

**Fix:** add `/^scripts\//` to `TIER0` in `detect-deploy-needed.mjs` and the matching `scripts/**` row
to `deploy-paths.md` §"Tier 0". Surfaced (and attempted) during `backlog-eval-framework-usable`'s
close; the edit was correctly blocked as out-of-scope self-modification of skill config, so it is filed
here. Low priority — the conservative default is safe (over-deploy / override), just noisy.
