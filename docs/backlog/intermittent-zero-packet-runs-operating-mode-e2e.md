---
id: intermittent-zero-packet-runs-operating-mode-e2e
status: parking
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Hypothesis: AgentCore Runtime ARM64 cold-start variability under serial mode."
---

# Intermittent zero-packet runs across all 3 modes in operating-mode e2e gate

Surfaced 2026-05-07 during α-tune validation. Two consecutive runs of `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` against deployed dev (post-α-tune AgentRuntime). Run 1: 2/3 produced packets (CONSERVATIVE, AGGRESSIVE — both wrong shape, mode adherence failed) + 1/3 timeout (BALANCED, expected for Vestigial MemoryStrategy). Run 2: ALL 3 modes timed out at 240s with no DecisionPacket materializing — including modes that worked in run 1. Indicates a separate intermittent reliability issue distinct from BALANCED's Memory namespace mismatch — possibly an AgentRuntime cold-start or capacity issue. The α-tune workstream's prompt + orchestrator changes did not introduce this (pre-existing infrastructure flake). Hypothesis: AgentCore Runtime ARM64 container has cold-start variability that the 240s `PACKET_TIMEOUT_MS` doesn't accommodate when multiple modes invoke serially in `--runInBand`. Diagnostic next step: monitor CloudWatch logs for portfolio-engine-ctrl AgentRuntime during a fresh e2e run to count successful invocations vs zero-output ones. Promote alongside Approach B if it surfaces during B's validation gate.
