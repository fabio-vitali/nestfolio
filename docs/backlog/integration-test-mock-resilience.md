---
id: integration-test-mock-resilience
status: dropped
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_mock_resilience.md
validation_gate: null
notes: "Demoted to LATER 2026-05-12 per its own ship-trigger ('Promote when integration test flakiness on agent-bound suites or per-suite SSM overrides becomes load-bearing'). Piece 2 (StateResetFixture) superseded by 2026-05-05 bootstrap uplift; piece 3 (SsmOverride) effectively closed by 2026-05-12 integration-test-ssm-cleanup-hardening-on-abort. Only piece 1 (FakeLlm via env var in agent-factory) remains, and it's not currently load-bearing — agent flakiness is being mitigated structurally (orchestrator retry/fallback, prompt cleanup) rather than via test-time fakes. Promote again when a concrete agent-bound integration flake demands it."
---

# Integration test mock resilience

DESIGN IN PROGRESS (2026-04-16). Original design covered three pieces:

1. **FakeLlm via env var in agent-factory** — not started.
2. **StateResetFixture for stale state** — superseded by the 2026-05-05 integration-test bootstrap uplift (`createIntegrationTestContext()` factory wires `OrphanReaper.cleanup()` automatically across all 44 integration test suites; the StateResetFixture coverage audit found only 2 global-key DDB patterns codebase-wide, both already wired).
3. **SsmOverride verification** — not started.

The remaining (1) + (3) work is small but stalled.

## Dropped (2026-05-29 boundary review)

Aged out. Of the three original pieces, (2) was superseded by the 2026-05-05 bootstrap uplift and (3) by 2026-05-12 `integration-test-ssm-cleanup-hardening-on-abort`. Only piece (1) — FakeLlm via env var in agent-factory — remains, and it never became load-bearing: agent flakiness has been mitigated structurally (orchestrator retry/fallback, prompt cleanup, mock-agent-runtime) rather than via test-time LLM fakes. If a concrete agent-bound integration flake ever genuinely demands a FakeLlm seam, file a fresh, narrowly-scoped dossier for that specific need rather than reviving this stale three-piece design.

Topic dossier: `project_mock_resilience.md` carries the full original design + audit notes.
