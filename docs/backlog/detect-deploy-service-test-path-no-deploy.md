---
id: detect-deploy-service-test-path-no-deploy
status: shipped
type: tooling
notes: "detect-deploy-needed.mjs lacks a Tier-0 rule for services/*/test/**, so a test-only service change defaults to deploy=true (false positive)."
references: []
out_of_scope:
  - "Lib test paths (libs/*/test/**) reverse-reach fan-out — that is the separate captured member detect-deploy-test-lib-reverse-reach-fanout, a different mechanism (TIER1 lib match), not this services/*/test/** gap."
  - "The tools/** Tier-0 gap (detect-deploy-tools-path-no-deploy) — already covered by the existing /^tools\\// TIER0 rule; not re-touched here."
  - "Any change to the deploy-decision for src/infrastructure/domain service paths — only the test/ subtree is added to Tier 0."
spec: null
plan: null
topic_memory: []
validation_gate: "Added TIER0 rule `/^services\\/[^/]+\\/[^/]+\\/test\\//` to detect-deploy-needed.mjs (commit 76531866) so a test-only service change is no-deploy and never seeds the true-affected resolver. 3 new regression tests (test-only=no-deploy; test+src isolates to src service; src/**/*.test-helpers.ts stays Tier 1) + deploy-paths.md row. `node --test .claude/skills/backlog-next/test/*.test.mjs` → 29/29 pass. Dogfood: `detect-deploy-needed --base=<member-2-tip>` over this member's own diff → deploy=false, all Tier 0 (was the false-positive class being fixed). No deploy/integration: member contribution is 100% .claude/** + docs/** Tier-0; the cumulative branch deploy belongs to E6 (member-1 event-processor change)."
closed: 2026-06-22
epic: deploy-tooling-integrity
epic_role: core
---

# detect-deploy-needed: services/*/test/** defaults to deploy=true

`.claude/skills/backlog-next/detect-deploy-needed.mjs` has no Tier-0 rule for
`services/<domain>/<service>/test/**`. Its `TIER1` matches `src/`,
`infrastructure/`, and `domain/`; anything else under `services/` falls through
to the conservative "unknown path → deploy=true" default.

Surfaced 2026-06-04 while shipping [[investor-bff-dead-repo-mutate-methods]]: the
unit-test file edit (`services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts`)
was reported under:

```
Unknown paths (defaulted to deploy=true):
  services/investor/investor-bff/test/unit/repositories/investor-profile.repository.test.ts
  → consider adding to deploy-paths.md
```

A test-only change never produces a deployable artifact, so it should be Tier 0.

Same class as [[detect-deploy-tools-path-no-deploy]] (the `tools/**` gap) — both
are missing Tier-0 entries in the same script.

Cheapest next step: add `/^services\/[^/]+\/[^/]+\/test\//` to `TIER0` in
`detect-deploy-needed.mjs` and a matching row in
`.claude/skills/backlog-next/deploy-paths.md`. Likely blocked from a same-session
`/backlog-next` fix by the auto-mode self-modification guard (the script is agent
logic), same as the `tools/**` item — so pair the two when one is unblocked.
