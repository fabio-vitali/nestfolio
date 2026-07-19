---
id: e2e-jest-timeout-convention-drift
status: shipped
closed: 2026-07-19
type: doc
notes: "audit-e2e-test skill's documented testTimeout convention (300_000) is stale vs jest.config.js's actual 600_000."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Fixed in commit 0f6185f7 — .claude/skills/audit-e2e-test/SKILL.md check #1 testTimeout 300_000 -> 600_000, matching apps/e2e-feature-tests/jest.config.js:12. Grep confirmed no other stale 300_000 convention reference remains outside dated historical plan/spec snapshots."
---

# e2e-feature-tests jest testTimeout convention drift

The `audit-e2e-test` skill's config check #1 states `testTimeout: 300_000`, but
`apps/e2e-feature-tests/jest.config.js` sets `600_000`. The code raise is documented in a comment
(citing `agentcore-invocation-resilience`'s 360s poll), so this is drift between the documented
convention and the actual surface, not an unjustified code violation — the skill text needs
updating.

Evidence: `apps/e2e-feature-tests/jest.config.js`: `testTimeout: 600_000,` vs skill check #1
`testTimeout: 300_000`.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-e2e-test#3); filing deferred to this
session per Entry 33.
