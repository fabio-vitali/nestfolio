---
id: integration-test-mock-resilience
status: parking
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_mock_resilience.md
validation_gate: null
notes: "DESIGN IN PROGRESS (2026-04-16) — partly superseded by 2026-05-05 bootstrap uplift; FakeLlm + SsmOverride remain unstarted."
---

# Integration test mock resilience

DESIGN IN PROGRESS (2026-04-16). Original design covered three pieces:

1. **FakeLlm via env var in agent-factory** — not started.
2. **StateResetFixture for stale state** — superseded by the 2026-05-05 integration-test bootstrap uplift (`createIntegrationTestContext()` factory wires `OrphanReaper.cleanup()` automatically across all 44 integration test suites; the StateResetFixture coverage audit found only 2 global-key DDB patterns codebase-wide, both already wired).
3. **SsmOverride verification** — not started.

The remaining (1) + (3) work is small but stalled. Promote when integration test flakiness on agent-bound suites or per-suite SSM overrides becomes load-bearing.

Topic dossier: `project_mock_resilience.md` carries the full original design + audit notes.
