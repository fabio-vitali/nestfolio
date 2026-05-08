---
id: agentcore-memory-list-records-eventual-consistency
status: parking
type: bug
notes: "AgentCore Memory ListMemoryRecords lag >40s; SF inter-stage cadence ~5s — propagate operatingMode through SF state instead."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_agent_runtime_structured_output.md]
validation_gate: null
---

# AgentCore Memory `ListMemoryRecords` eventual-consistency window exceeds SF inter-stage cadence

## Evidence (captured 2026-05-08 while landing operating-mode-shape-empty-proposed-trades)

For tenant `e2e-1778281850198`, decision `54e0997d-fe78-40d5-bc58-8155a2f87afe`:
- 23:11:34 — `BatchCreateMemoryRecordsCommand` ACK'd (Memory record created in namespace `/investor-profile/.../decisions/54e0997d`).
- 23:11:45 — portfolio-engine-ctrl Lambda calls `ListMemoryRecordsCommand` on the same namespace → returns `[]` (11s after write).
- 23:11:48..23:12:14 — 4 retry attempts spaced 3+5+8+12 = 28s. Every retry returns `[]` (40s after write).
- (later, direct `aws bedrock-agentcore list-memory-records` from CLI) — record IS visible.

So `ListMemoryRecords` eventual-consistency window for fresh `BatchCreateMemoryRecords` writes is **>40s** in observed conditions. SF's inter-stage cadence (Lambda completion → SQS → next Lambda) is ~5–10s, which means downstream Lambdas reliably miss recent writes via this API.

Same root cause manifests in the `operating-mode-recommendation-shape` e2e, the `intermittent-zero-packet-runs-operating-mode-e2e` LATER item (filed earlier as a "cold-start variance" hypothesis — actually this), and likely the BALANCED-shape "concurrent residue" diagnosis from the 2026-05-07 close-out of `project_agent_runtime_structured_output.md`.

## Why filed not promoted

The active workstream `operating-mode-shape-empty-proposed-trades` shipped its diagnosed bug (silent BALANCED narrowing + serviceName mismatch + missing MEMORY_ID env + missing IAM grants on AgentRuntime). That fix is demonstrably correct: the Memory record now exists post-deploy with `{operatingMode, ...}`. One e2e run produced 1/3 GREEN (BALANCED in 129s) — proof the chain is end-to-end functional. The remaining 2/3 timeouts have a **different** root cause (this one) that needs an architectural fix, not another patch.

## Architectural fix (when picked up)

**Option A — Propagate `operatingMode` through SF state.** decision-state-machine.ts already passes a triggerContext blob; extract operatingMode into a top-level `$.operatingMode` field at the entry state. Each `Task` state can then include `'operatingMode.$': '$.operatingMode'` in its `subject`, and downstream Lambdas read it from the event subject directly (no Memory roundtrip). Eliminates the consistency dependency entirely for this critical channel. The Memory writes from graph.ts:117 are still useful for full agent-output context (goals, risk-assessment, allocations, trades) — only operatingMode and other "envelope" fields need this fast-path treatment.

**Option B — Switch the read API.** `RetrieveMemoryRecordsCommand` (semantic search, used today only by `searchLongTermMemory`) may be backed by a different index than `ListMemoryRecords` and could be more current. Would require an empirical test on a fresh write.

**Option C — Wait it out.** Extend the Lambda Memory-read retry budget to >60s. Possible but agentProps is 5min Lambda timeout; the 4-stage SF chain becomes 4× ≥60s = ≥240s of pure wait. Likely pushes total e2e well past acceptable thresholds and burns AgentCore minutes.

A → likely correct. B → quick check first to rule out. C → only if A is unworkable.

## Out of scope (when picked up)

- Refactoring the `MemoryClient` interface — Option A only changes who reads what, not the client API.
- Updating the AgentCore Memory write path — writes are fine.
- The remaining `intermittent-zero-packet-runs-operating-mode-e2e` LATER item — likely subsumed by this; close as duplicate when this ships.

## Promote when

The `operating-mode-recommendation-shape` e2e is needed to gate CI, OR another e2e starts depending on cross-stage Memory reads within the same SF execution. Until then this is a known limitation tracked here.
