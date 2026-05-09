---
id: agentcore-memory-list-records-eventual-consistency
status: shipped
type: bug
notes: "AgentCore Memory ListMemoryRecords lag >40s; SF inter-stage cadence ~5s — propagate operatingMode through SF state instead."
references: []
out_of_scope:
  - "Switching the Memory write API — writes are correct, only the read-side ListRecords lag matters."
  - "Refactoring MemoryClient interface — Option A only changes who reads what, not the API."
  - "Cross-decision Memory reads (searchTenantMemory, searchLongTermMemory) — those go through RetrieveMemoryRecords with semantic search; this workstream only changes intra-decision cross-stage envelope reads."
  - "Backfilling envelope-field reads in advisory-narrative-ctrl/AssemblePacket — focus on operatingMode propagation; expand only if other fields are observed lagging."
  - "Restoring 1/3 GREEN in operating-mode-recommendation-shape e2e by tweaking PACKET_TIMEOUT_MS only — that band-aid was rejected (see active workstream's validation_gate)."
spec: null
plan: null
topic_memory: [project_agent_runtime_structured_output.md]
validation_gate: "operating-mode-recommendation-shape e2e against deployed dev: 3/3 GREEN in 410s (CONSERVATIVE 142s — 5 trades equity=0.20, BALANCED 138s — 7 trades equity=0.52, AGGRESSIVE 127s — 8 trades equity=0.85). Each mode produced correctly shaped proposedTrades within mode envelope. Unit tests: 59/59 across portfolio-engine-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl, decision-workflow-ctrl, investor-profile-ctrl."
shipped_at: "2026-05-09"
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

## Ship narrative (2026-05-09)

Promoted 2026-05-08 and shipped 2026-05-09 on branch `feat/operatingmode-via-sf-state`. Final e2e gate: 3/3 GREEN in 410s.

Landing the workstream took 5 phases plus a course correction:

**Phases 1–4 (commits `13a2c817` + `fa7f0a17`).** Option A propagation. investor-profile-ctrl event-listener now returns `operatingMode` in the SF SendTaskSuccess output. decision-state-machine.ts threads operatingMode into the `InvokePortfolioEngine` and `InvokeAdvisoryNarrative` Task subjects via `$.agentResults.InvokeInvestorProfile.operatingMode`. `MergeParallelOutputs` re-hoists the field out of `$.parallelResults[0]` so the JSONPath resolves at runtime. portfolio-engine-ctrl and advisory-narrative-ctrl read `subject.operatingMode` directly and throw `UnknownOperatingModeError` on miss (replaces silent `?? 'BALANCED'` fallback). `MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE` env var dropped from portfolio-engine.

**Phase 5 (deploy + e2e).** First e2e run: **0/3 GREEN — regression from 1/3 baseline.** SF executions reached `UpdateStatusApprovedL1` cleanly; `MergeParallelOutputs` produced `{"agentResults":{"InvokeInvestorProfile":{"operatingMode":"AGGRESSIVE"}},...}` exactly as designed. But CloudWatch on portfolio-engine-ctrl revealed the agent input was `{"operatingMode":"AGGRESSIVE","investorProfile":{},"marketAnalysis":{},"pastRationale":[]}`. Removing the Phase 3 retry loop had also dropped the side-effect of waiting for the `investorProfile` Memory write to converge — the original retry was doing dual duty.

**Phase 6 (commit `4960a10d`).** Restored a focused Memory retry on the agent INPUT context only (gated on content presence, not operatingMode). Three read sites: portfolio-engine-ctrl on `investor-profile`, advisory-narrative-ctrl on `portfolio-engine`, AssemblePacket on `portfolio-engine`. Second e2e: still **0/3 GREEN** but now SF completed in ~2 min with each AssemblePacket producing `proposedTrades:[]` despite SF-level operatingMode propagation working.

**Course correction — single-writer Memory contract (commit `1b3e20b1`).** Direct AgentCore Memory inspection on tenant `e2e-1778327727723` revealed **two distinct memoryRecordIds in the same `/portfolio-engine/{tenantId}/decisions/{decisionId}` namespace** with different content:
1. AgentRuntime (`graph.ts:173`) writing the orchestrator's raw output keyed by node name: `{portfolio-construction:{allocations:[…]}, rebalance-planner:{trades:[…]}}`.
2. The Lambda's `session.writeAgentOutput(result)` writing the transformed runPipeline result: `{decisionId, allocations:{allocations:[…]}, trades:{…}, metadata}`.

Both writes used the same `requestIdentifier` but AgentCore did NOT dedupe across distinct callers despite the comment in investor-profile-ctrl's event-listener.ts claiming otherwise (`silently deduplicated by requestIdentifier idempotency` — that comment was optimistic in the general case; it happened to be correct only because investor-profile's wrap-write was already removed). `ListMemoryRecords` returned whichever record at index `[0]` — order-dependent flake. The 1/3 BALANCED GREEN baseline succeeded only when the read landed on the Lambda's transformed shape. After Phase 2-4 latency shifted, all three runs landed on the raw shape and AssemblePacket's strict extractor produced empty trades.

No backlog item existed for this dual-writer (closest mention: a parking-lot remark in `agent-runtime-structured-output-reliability.md`). Per user direction, fixed in scope rather than parked: removed the redundant Lambda `writeAgentOutput` calls in portfolio-engine-ctrl, advisory-narrative-ctrl, and market-intelligence-ctrl (mirrors investor-profile-ctrl). AgentRuntime is now the sole writer. Updated AssemblePacket extraction to read the raw shape: `portfolioOutput['portfolio-construction'].allocations` for trades, `narrativeOutput.explainability.{rationale,summary}` for explanation. Updated unit tests + AssemblePacket fixtures to match.

**Files touched (final).**
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` (Phase 2 — SF state propagation + MergeParallelOutputs hoist)
- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` (Phase 6 — Memory retry on portfolio read; Phase 7 — extract from raw shape)
- `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts` (Phase 1 — return operatingMode in SendTaskSuccess output)
- `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` (Phase 3 — read subject.operatingMode + Phase 6 retry on investorProfile + Phase 7 wrap-write removal)
- `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` (Phase 4 — read subject.operatingMode + Phase 6 retry on portfolio + Phase 7 wrap-write removal)
- `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` (Phase 7 — wrap-write removal)
- Unit tests for all 5 services + `service.stack.test.ts` for the SF DefinitionString assertion.

**What this resolves.**
- The active e2e gate `operating-mode-recommendation-shape` now passes 3/3 deterministically. Closes the LATER item `intermittent-zero-packet-runs-operating-mode-e2e` (filed earlier as a "cold-start variance" hypothesis — it was actually this).
- The pre-existing AgentCore Memory dual-writer race (parked in `agent-runtime-structured-output-reliability.md`'s parking lot) is removed at the source — no separate workstream needed.

**What this does NOT resolve.**
- The `>40s` ListMemoryRecords eventual-consistency window is still a property of AgentCore — we mitigate it with retries on the agent INPUT context (not eliminated). The operatingMode channel is now on the SF-state fast path. If a future cross-stage envelope field surfaces with the same lag pattern, the same Option A pattern can be extended to it.
- `update-operating-mode-mutation-rederivation-gap` LATER item is independent and unchanged.
