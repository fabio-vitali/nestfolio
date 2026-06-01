---
id: detect-deploy-tools-path-no-deploy
status: parking
type: tooling
notes: "detect-deploy-needed.mjs has no Tier-0 rule for tools/**, so any tools/*.mjs change defaults to deploy=true (false positive). w6 hit this with tools/check-read-model-drift.mjs. Add /^tools\\//  to TIER0 + a deploy-paths.md row. Blocked from same-session fix by the auto-mode self-modification guard (the script is agent logic)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# detect-deploy-needed: classify tools/ as Tier-0 (no-deploy)

`.claude/skills/backlog-next/detect-deploy-needed.mjs` `TIER0` has no rule for
`tools/**`, so a change to any repo build/CI/dev script (e.g.
`tools/check-read-model-drift.mjs`, added by `bff-readmodel-w6-governance-freeze`)
falls through to the default conservative `deploy=true`. These scripts are never
bundled into a Lambda; a change to them never requires a deploy.

## Fix
- Add `/^tools\//` to the `TIER0` array in `detect-deploy-needed.mjs`.
- Add a `| `tools/**` | repo build/CI/dev scripts, not deployed |` row to the
  Tier-0 table in `deploy-paths.md` (keep the two in sync).

## Why filed, not fixed inline
Surfaced 2026-06-01 during w6's closing phase. The same-session edit was denied
by the auto-mode classifier as self-modification of the agent's own deploy logic
— correctly. The documented workaround (`deploy-paths.md` "Default rule": the
agent may override when confident a path doesn't affect deployed artifacts) was
used for w6 itself. This item captures the durable tooling fix for a future
session with explicit authorization.
