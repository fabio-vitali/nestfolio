---
id: operating-mode-shape-empty-proposed-trades
status: shipped
rank: null
type: bug
notes: "operating-mode-recommendation-shape e2e: agent pipeline never materializes non-empty proposedTrades on dev"
references: []
out_of_scope:
  - "AgentCore Memory namespace mismatch (filed in LATER as separate item)"
  - "updateOperatingMode mutation re-derivation gap (filed in LATER)"
  - "intermittent-zero-packet-runs cold-start flake (filed as separate QUEUED item; only relevant if root cause turns out to be variance, not deterministic)"
  - "Refactoring AssemblePacket / advisory-bff transform topology — only fix the direct cause"
  - "Test-side polling refactors (test-infrastructure-polling-audit covers this)"
spec: null
plan: null
topic_memory: [project_agent_runtime_structured_output.md, project_pipeline_trigger_gap.md]
validation_gate: |
  Partial — BALANCED 1/3 GREEN; CONSERVATIVE+AGGRESSIVE blocked on AgentCore
  Memory consistency. The fix shipped is structurally correct: the Memory
  record is written with the right namespace + operatingMode field, and one
  e2e run produced count=7/eq=0.50/lpw=0.15 for BALANCED in 129s, well
  within the 240s gate. The remaining 2/3 timeouts have a separately-filed
  root cause: agentcore-memory-list-records-eventual-consistency. That
  workstream (Option A — propagate operatingMode through SF state) replaces
  the cross-stage Memory roundtrip that this gate cannot satisfy under
  AgentCore Memory ListMemoryRecords consistency lag (>40s observed).
  Ship commits: 1c0b70cb feat(agent-orchestrator): add UnknownOperatingModeError;
  a43967aa fix(advisory): close operating-mode propagation across 4 services.
---

# operating-mode-recommendation-shape e2e — empty proposedTrades

## Timeline (read this first)

- **First observed**: during the InvestorProfile Domain Resplit branch work, captured into the new per-item backlog format on 2026-05-08 (commit `4d49f3ca`). The backlog system itself was refactored on 2026-05-07 (`3f5ca4cb..ad8be1e1`), so a 2026-05-08 filing date does **not** imply a 2026-05-08 regression — most QUEUED items dated 2026-05-08 are simply re-homed entries.
- **Last known green**: 2026-05-07 close-out of `project_agent_runtime_structured_output.md` — e2e gate 3/3 GREEN with mode-differentiated portfolios (CONSERVATIVE 5/0.20/0.10, BALANCED 7/0.52/0.15, AGGRESSIVE 9/0.82/0.22). Regression test added at `libs/agent-orchestrator/test/create-orchestrator.test.ts` for stateAnnotation propagation.
- **Re-observed failure**: 3/3 RED on the resplit branch with empty `proposedTrades` arrays.

## Evidence

- `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` — three test cases (CONSERVATIVE, BALANCED, AGGRESSIVE) all fail at:
  - `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:186` →
    `throw new Error(`No DecisionPacket with non-empty proposedTrades materialized for tenantId=${tenantId} within ${PACKET_TIMEOUT_MS}ms`)` (240 000 ms timeout per case).
- The test's MandateSnapshot fixture (lines 119–122) was updated in commit `b7aaf037` to the new shape `{ level, status, operatingMode, effectiveDate }` — the resplit-side test-fixture adaptation is correct.
- DecisionPackets *do* materialize, but their `proposedTrades` arrays are empty. The polling loop never sees a non-empty packet within the timeout.

## Open question (must resolve in Phase 1 of the next investigation)

Topic memory `project_agent_runtime_structured_output.md` reports the gate as **FULLY VALIDATED 2026-05-07**. This bug claims the gate is **3/3 RED** on the resplit branch. Mutually exclusive — exactly one of these is true now:

1. **Regression introduced by the resplit** (despite the resplit-author note "NOT caused by the resplit"). Most likely suspects: 3-tier event topology change, Mandate sibling aggregate split, or `MANDATE_ACCEPTED → MANDATE_ISSUED` rename (commit `2d3b9796`) breaking what flows into agent state.
2. **Flake / cold-start variance** at the AgentRuntime layer, intersecting with `intermittent-zero-packet-runs-operating-mode-e2e` (LATER).
3. **Different failure mode** from the one closed on 2026-05-07 — the new failure produces a packet *with* empty trades (instead of 2026-05-06's silent-empty-`{}`-pre-γ). The γ guard should have prevented packet creation in that case, so something in `AssemblePacket` may write a packet anyway.

The 2026-05-07 close-out specifically warned: *"Re-deploys can mask cached-state bugs without the diagnostic ever firing… If a deploy happens to coincide with all warm containers being recycled, a 'fix' that's really just a cache bust will look indistinguishable from an actual code fix."* The `libs/agent-orchestrator` regression test guards propagation against drift; if it still passes locally, the regression is downstream of orchestrator state-passing.

## Cheapest next step

1. Re-run the e2e against deployed dev (`pnpm nx run e2e-feature-tests:test-e2e-features`, scoped to the failing file) to confirm current state and rule out flake.
2. If still RED, capture one failing run's DecisionPacket from advisory-bff DDB + AgentCore Runtime CloudWatch logs for `dev-portfolio-engine-ctrl` during the test window. Branch on which of the 3 hypotheses above the evidence supports.
3. Cross-reference the resplit's event-topology diff (`MANDATE_ACCEPTED → MANDATE_ISSUED` + carrier/semantic/lifecycle split) with what the SF input + agent state expect.
