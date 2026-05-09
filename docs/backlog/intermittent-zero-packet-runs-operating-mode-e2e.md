---
id: intermittent-zero-packet-runs-operating-mode-e2e
status: dropped
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Subsumed by agentcore-memory-list-records-eventual-consistency (shipped 2026-05-09). The cold-start hypothesis was wrong — root cause was AgentCore Memory dual-writer race + ListMemoryRecords lag, not container cold-start."
shipped_at: "2026-05-09"
---

# Intermittent zero-packet runs across all 3 modes in operating-mode e2e gate

**Closed as duplicate 2026-05-09.** Subsumed by `agentcore-memory-list-records-eventual-consistency`. The cold-start variability hypothesis was incorrect — root cause turned out to be (a) the AgentCore Memory `ListMemoryRecords` >40s eventual-consistency window combined with (b) a dual-writer race in `/portfolio-engine/{tenantId}/decisions/{decisionId}` namespace where `ListMemoryRecords[0]` could return either the AgentRuntime's raw shape or the Lambda's transformed shape order-dependently. With the operatingMode SF-state fast path + single-writer Memory contract shipped, all 3 modes pass deterministically in ~130-142s each.

## Original surfacing context (preserved for history)

Surfaced 2026-05-07 during α-tune validation. Two consecutive runs of `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` against deployed dev (post-α-tune AgentRuntime). Run 1: 2/3 produced packets (CONSERVATIVE, AGGRESSIVE — both wrong shape, mode adherence failed) + 1/3 timeout (BALANCED, expected for Vestigial MemoryStrategy). Run 2: ALL 3 modes timed out at 240s with no DecisionPacket materializing — including modes that worked in run 1. Indicates a separate intermittent reliability issue distinct from BALANCED's Memory namespace mismatch — possibly an AgentRuntime cold-start or capacity issue. The α-tune workstream's prompt + orchestrator changes did not introduce this (pre-existing infrastructure flake). Hypothesis: AgentCore Runtime ARM64 container has cold-start variability that the 240s `PACKET_TIMEOUT_MS` doesn't accommodate when multiple modes invoke serially in `--runInBand`. Diagnostic next step: monitor CloudWatch logs for portfolio-engine-ctrl AgentRuntime during a fresh e2e run to count successful invocations vs zero-output ones. Promote alongside Approach B if it surfaces during B's validation gate.
