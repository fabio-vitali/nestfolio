# Inter-agent state handoff — SF state + AgentCore Memory strategies — Design

**Workstream:** `inter-agent-state-handoff-sf-vs-memory` (backlog)
**Status:** active — Phase A SHIPPED 2026-05-14 (commit `676dd75c`, PR #6); Phase B in design
**Topic memory:** none yet (will create one for this workstream after Phase A ships)
**Type:** design
**Phasing:** A (latency fix) ships first, B (long-term recall) follows in a separate PR.

## Driver

Investigation 2026-05-14 of `advisory-narrative-latency-budget-overshoot-e2e` revealed the original "4% overshoot" framing was wrong — actual regression is **3x** (p50 13s → 49s, p95 21s → 56s) since 2026-05-09. Root cause: commit `4960a10d` added a Memory-read retry loop in `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:55-63` with default delays `3000,5000,8000,12000` (28s mandatory sleep) to work around AgentCore Memory's >40s eventual-consistency window between writers and readers.

Bumping the latency budget would mask the regression. The right fix is structural: move the inter-agent ephemeral output handoff off AgentCore Memory entirely.

Concurrent investigation also surfaced that `docs/architecture/SYSTEM-ARCHITECTURE.md` §17 documents long-term Memory recall (`preferences`, `signals`, `rationale` namespaces with Bedrock extraction strategies) that 6 caller sites already invoke but which has been non-functional since commit `3f6eea0e` removed vestigial MemoryStrategy declarations on 2026-05-11. The `service.stack.ts:23-29` comment ("cross-decision learning would require a design workstream") is a TODO marker, not a "we don't want this." This spec covers the missing implementation as Part B.

## Verified state (before this workstream starts)

- **Inter-agent handoff is currently via AgentCore Memory.** `BatchCreateMemoryRecords` writes to `/{service}/{tenantId}/decisions/{decisionId}`, `ListMemoryRecords` reads the same namespace. Symmetric write/read path, but the underlying SDK call has 40s eventual-consistency.
- **Agent outputs are tiny.** Sampled 144 records across the 4 advisory agents on dev: p99 sizes per agent are 3.2 KB (investor-profile), 6.1 KB (portfolio-engine), 4.1 KB (market-intelligence), 4.4 KB (narrative). All comfortably under SF state's 32 KB per-state-input limit (5x headroom on the largest).
- **AgentInvocation DDB rows do NOT contain agent output.** They store metadata only (status, durationMs, IDs). The agent output exists ONLY in AgentCore Memory today.
- **The SF state machine already captures `SendTaskSuccess` results into `$.agentResults.<stateId>`** but only metadata flows there today (per `decision-state-machine.ts:82,125`). Agents do not include their output payload in `SendTaskSuccess`.
- **`searchLongTermMemory` callers exist in 6 places but return empty arrays today.** No MemoryStrategy is provisioned (per `service.stack.ts:23-29` comment), and the strategies that were removed in `3f6eea0e` watched a namespace pattern that was never written to.
- **CloudWatch p95 narrative latency on dev:** 21 s on 2026-05-06 (pre-retry), 56-58 s on 2026-05-09 through 2026-05-13 (post-retry). 144 invocations sampled.

## Goals

**Part A (urgent — fixes 3x latency regression):** Migrate inter-agent ephemeral output handoff for the 4 advisory agents from AgentCore Memory (eventual-consistency) to Step Functions state (synchronous, deterministic). Delete the 28s retry loop. Daily p95 narrative latency returns to <22s.

**Part B (long-pending — wires up §17 architecture intent):** Provision Bedrock MemoryStrategies on the 3 documented long-term namespaces (`preferences`, `signals`, `rationale`) and emit `CreateEvent` calls from agents that those strategies extract from. The existing `searchLongTermMemory` callers (6 today, 5 after the narrative orphan-caller merge) start returning real cross-decision data.

## Non-goals (Out of scope)

- **Onboarding-bff Memory usage** — different domain, different namespace patterns; not affected by this spec.
- **`sessions/{sessionId}` long-term namespace** — onboarding wizard scope; defer.
- **Migration of Lambda-side resilience / idempotency patterns** — already shipped (`c9dae7db`).
- **Backfilling historical decision data into long-term namespaces** — start fresh; existing dev data has no value.
- **Removing the `agentcore.Memory` infra construct** — it powers Part B; stays.
- **Touching KB ingestion paths** — different system per §19.
- **Cross-tenant Memory analytics or aggregation.**
- **Production rollout sequencing** — dev-first; prod posture decided separately when prod is in sight.
- **Bumping `advisoryNarrative` latency budget from 20_000 ms** — the budget is correct; the latency is the bug.
- **Reviving the old `CreateEvent + RetrieveMemoryRecords` path that Spec 2 (2026-04-30) replaced** — Part A keeps the direct-record speed for any future short-term needs; Part B adds events back as the source for extraction strategies, which is the API's intended usage.

## Architecture

### Part A — Inter-agent SF state migration

**Today:**
```
Agent runtime (Hono) → output → BatchCreateMemoryRecords  →  Memory namespace /{service}/{tenantId}/decisions/{decisionId}
                                                          ↓ (40 s eventual consistency)
                Agent runtime → ack → SendTaskSuccess(metadata only) → SF $.agentResults.<id>
                                                                      ↓
Downstream agent / AssemblePacket → ListMemoryRecords({same namespace}) → 28 s retry sleep loop until non-empty
```

**Proposed:**
```
Agent runtime (Hono) → output → SendTaskSuccess({ output, metadata }) → SF $.agentResults.<id>.output
                                                                       ↓ (synchronous, deterministic)
Downstream agent task → reads from SF state input (Parameters block plumbs upstream output into next task's input)
AssemblePacket Lambda → reads event.detail.<agent> directly (no Memory call)
```

Memory infra and `MemoryClient` class remain in place for Part B.

**Components touched (5 services + 1 lib):**

| File | Change |
|---|---|
| `libs/agent-orchestrator/src/server/createAgentServer.ts` (or equivalent) | `SendTaskSuccess` body changes from ack-only to `{ output, metadata }`. Add runtime size guard: if `JSON.stringify(output).length > 25_000`, log warning + write to S3, send pointer. Threshold leaves 7 KB headroom under SF's 32 KB per-input limit (current p99: 6.1 KB → 4x safety margin). |
| `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` | Each downstream task's `Parameters` block adds reads from upstream agentResults paths. AssemblePacket invocation includes all 4 agent outputs in its `Payload`. |
| `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` | Delete `UPSTREAM_SERVICES.map(svc => session.readUpstreamOutput(svc))`. Read from `event.detail.<agent>` directly. The placeholder fallback at lines 64-67 stays as defence-in-depth. |
| `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` | Delete `readUpstreamOutput('investor-profile')` + retry path. Read from event subject `upstreamOutputs.investorProfile`. |
| `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` | Delete the 28s retry loop (lines 55-63). Delete the 3 `readUpstreamOutput(...)` calls. Read from event subject `upstreamOutputs.{investorProfile, marketAnalysis, portfolio}`. |
| `libs/agent-orchestrator/src/memory/memory-client.ts` + `no-op-client.ts` | Delete `writeAgentOutput` + `readUpstreamOutput` methods. Keep `searchLongTermMemory` and `searchTenantMemory` (Part B uses them). |
| Tests (~6-8 files) | Replace `mockReadUpstreamOutput` / `mockWriteAgentOutput` with subject-based fixtures. Delete the retry-loop test in `portfolio-engine-ctrl/test/unit/event-listener.test.ts:180`. |
| 4 agent service stacks | Drop `BatchCreateMemoryRecords` + `ListMemoryRecords` IAM grants. Keep `RetrieveMemoryRecords`. |

**What stays unchanged:**
- The `agentcore.Memory` construct + SSM `memory/id` parameter
- The `MemoryClient` class (slimmer interface, but still present)
- The 6 `searchLongTermMemory` / `searchTenantMemory` call sites (no behavior change to them in Part A — they continue returning `[]` until Part B ships)
- AgentInvocation DDB rows (audit trail unchanged)
- `waitForTaskToken` orchestration pattern
- KB retrieval paths
- The `MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE` env-var support is removed (no retry to delay)

### Part B — Long-term Memory Strategy implementation

**3 strategies provisioned on the existing `agentcore.Memory` construct** in `services/advisory/decision-workflow-ctrl/src/service.stack.ts` — one strategy per memory-type, attached to one or more namespace patterns. Bedrock's `{actorId}` template resolves to `tenantId` at runtime; extracted records are stored at the source namespace.

**Strategy provisioning (4 strategies; per-AWS-API-constraint MAX 1 namespace per strategy — see Part B addendum below):**

| Strategy | Type | Namespace pattern | Source agent |
|---|---|---|---|
| `InvestorPreferenceLearner` | `USER_PREFERENCE_MEMORY` | `/investor-profile-ctrl/{actorId}/preferences` | investor-profile |
| `MarketSignalExtractor` | `SEMANTIC_MEMORY` (custom prompt) | `/market-intelligence-ctrl/{actorId}/signals` | market-intelligence |
| `PortfolioRationaleArchivist` | `SEMANTIC_MEMORY` (custom prompt) | `/portfolio-engine-ctrl/{actorId}/rationale` | portfolio-engine |
| `NarrativeRationaleArchivist` | `SEMANTIC_MEMORY` (custom prompt) | `/advisory-narrative-ctrl/{actorId}/rationale` | advisory-narrative |

The two rationale strategies share the same extraction + consolidation prompts.

`/{service}/{tenantId}/sessions/{sessionId}` — out of scope (onboarding wizard).

**MemoryClient API shape.** Both write and read take an explicit `namespace` argument; the calling service is inferred from the `MemoryClient` config so retrieval queries the calling service's namespace.

```ts
// Write
await session.emitLongTermEvent({
  namespace: 'preferences', // 'preferences' | 'signals' | 'rationale'
  payload: shapedOutput,
});

// Read
const records = await session.searchLongTermMemory(
  'rationale',                       // namespace
  'prior decision narratives',       // semantic query
  3,                                 // topK (optional, default 5)
);
```

`emitLongTermEvent` is a new method on `MemoryClient` that wraps `CreateEventCommand`. `sessionId` on the `CreateEvent` call is set to `decisionId` — each decision cycle is one session, and strategies consolidate across sessions = across decisions. Distributed ownership: each agent emits its own event after its own successful structured-output validation. Failed / empty / degraded outputs do NOT emit (matches the existing Phase β discriminant check from commit `97d41a36`).

**Emit table — one emit per agent per decision cycle:**

| Agent | Namespace | Payload |
|---|---|---|
| investor-profile | `preferences` | the validated InvestorProfile structured output |
| market-intelligence | `signals` | the validated MarketAnalysis structured output |
| portfolio-engine | `rationale` | the validated Portfolio allocation + reasoning |
| advisory-narrative | `rationale` | `{ narrative, tone }` from the validated Narrative output |

**Retrieval call sites — 5 post-Phase-B (sites 5+6 in narrative listener merged into one `rationale` call):**

| # | Caller | Namespace | Query string |
|---|---|---|---|
| 1 | `investor-profile-ctrl/agents/investor-profile/graph.ts:77` | `preferences` | `prior risk assessments for tenant ${tenantId}` |
| 2 | `investor-profile-ctrl/src/handlers/event-listener.ts:25` | `preferences` | `investor preferences risk tolerance` |
| 3 | `market-intelligence-ctrl/src/handlers/event-listener.ts:25` | `signals` | `market signals sector trends` |
| 4 | `portfolio-engine-ctrl/src/handlers/event-listener.ts:45` | `rationale` | `allocation rationale decisions` |
| 5 | `advisory-narrative-ctrl/src/handlers/event-listener.ts:45-46` | `rationale` | `prior decision narratives and communication style` *(replaces today's 2 calls — `'narrative preferences communication style'` + `'session summaries'`)* |

**Extraction & consolidation prompts (Haiku, per OQ #2):**

- `preferences` (USER_PREFERENCE_MEMORY):
  - Extraction: *"Extract investor preferences: risk tolerance level, asset class preferences, ESG constraints, liquidity needs, time horizon, and stated return targets. One fact per record. Ignore mechanical decision details."*
  - Consolidation: *"Newer statements override older for the same dimension. Flag contradictions (e.g., high growth vs conservative)."*
- `signals` (SEMANTIC_MEMORY):
  - Extraction: *"Extract market signals with cross-decision shelf life: sector trends, regime indicators, signal strength, and direction. Ignore one-off intraday noise. One signal per record."*
  - Consolidation: SEMANTIC default.
- `rationale` (SEMANTIC_MEMORY):
  - Extraction: *"Extract recommendation rationale: which assets were weighted and why, which constraints were binding, what trade-offs were chosen, and the investor-facing narrative summary including tone. One rationale per record, scoped to the decision it explains."*
  - Consolidation: *"Consolidate chronologically. Preserve the reasoning chain — don't collapse distinct decisions into a summary."*

Prompts are starting points; OQ #1 (iterate against real e2e sample data) still applies.

**IAM grants in `decision-workflow-ctrl/service.stack.ts`:**
- Memory execution role: restore Bedrock `InvokeModel` permission for extraction prompts (reverses part of `3f6eea0e`)
- Each of the 4 agent runtimes: keep `RetrieveMemoryRecords`; add `CreateEvent`. `BatchCreateMemoryRecords` and `ListMemoryRecords` are already gone (Phase A).

**Extraction lag tolerance.** Strategies are async — extraction completes seconds-to-minutes after the source event. This is fine because:
1. Inter-agent handoff no longer waits on Memory (Phase A solved that)
2. `searchLongTermMemory` callers all handle empty results gracefully (`tenantHistory.length > 0 ? historyContext : ''`)
3. Cross-decision recall is inherently a "previous decisions" feature; in-flight decisions wouldn't appear in their own long-term recall anyway

### Part B addendum — AWS API constraints surfaced at deploy time (2026-05-14 ship)

Two AWS API constraints surfaced during the Phase B dev deploy that were not visible at synth time:

1. **`memoryStrategies.namespaces` length ≤ 1.** CFN accepts an array, but the AgentCoreControl API rejects any strategy with more than one namespace pattern. The unified `RationaleArchivist` (2 namespaces: `/portfolio-engine-ctrl/.../rationale` + `/advisory-narrative-ctrl/.../rationale`) was split into `PortfolioRationaleArchivist` + `NarrativeRationaleArchivist`, sharing identical prompts. Fix: commit `a74912b2`.

2. **Inference profiles route to foundation models across regions.** The Memory execution role's `bedrock:InvokeModel` grant must cover BOTH the inference-profile ARN AND a `foundation-model/*` wildcard. Granting only the profile yields a runtime `Role does not have access for the specified model` at UpdateMemory time. Fix: commit `388e9940`. Pattern matches the established repo precedent at `libs/cdk-constructs/src/extensions/agent-runtime.ts:buildBedrockModelResources`.

Both findings codified as CDK assertion tests after the fix so a regression would fail at synth + unit-test time.

## Rollout & migration order

**Phase 0 — pre-flight (no deploy):**
- This spec approved + committed
- Implementation plan written via `superpowers:writing-plans`
- Worktree created via `superpowers:using-git-worktrees`

**Phase A — latency fix (1 PR, single dev deploy, atomic cutover):**
1. Modify `libs/agent-orchestrator` agent server: include output in `SendTaskSuccess`; add 25 KB runtime size guard.
2. Update `decision-workflow-ctrl` SF state machine `Parameters` blocks to plumb upstream outputs.
3. Update `assemble-packet.ts` to read from `event.detail.<agent>`.
4. Update `portfolio-engine-ctrl` + `advisory-narrative-ctrl` event-listener handlers to read from event subject; delete the 28s retry loop.
5. Delete `MemoryClient.writeAgentOutput` + `readUpstreamOutput` (and no-op-client counterparts).
6. Drop `BatchCreateMemoryRecords` + `ListMemoryRecords` IAM grants from 4 agent service stacks.
7. Update unit tests (~6-8 files).
8. Update `docs/architecture/SYSTEM-ARCHITECTURE.md` §17 + §17.1 to reflect that `decisions/{decisionId}` short-term namespace is no longer used by the runtime path; the contract now describes only the long-term namespaces (Part B will re-fill that section as it implements them).

**Phase A validation gate:**
- Integration suite green for all 4 advisory ctrl services + decision-workflow-ctrl
- 5 consecutive runs of `first-decision.e2e.test.ts` + `reconciliation-correction.e2e.test.ts` pass with `gen_ai.invocation.latency_ms < 20_000`
- CloudWatch p95 narrative latency on dev returns to <22 s within 1 hour of deploy
- `advisory-narrative-latency-budget-overshoot-e2e` flips to `shipped` (Phase A is its blocker dossier)

**Phase B — long-term recall (1 PR, single dev deploy; depends on Phase A shipped):**
1. Restore Bedrock `InvokeModel` IAM permission on Memory execution role in `decision-workflow-ctrl`.
2. Provision 3 MemoryStrategies on `agentcore.Memory` per the table above: `InvestorPreferenceLearner` (single namespace), `MarketSignalExtractor` (single namespace), `RationaleArchivist` (two namespaces). Wire the extraction & consolidation prompts.
3. Extend `MemoryClient`: add `emitLongTermEvent({ namespace, payload })` wrapping `CreateEventCommand` with `sessionId = decisionId`; change `searchLongTermMemory` signature to `(namespace, query, topK?)` and update the namespace path it queries to `/{service}/{tenantId}/{namespace}`. Mirror both methods in `no-op-client.ts`.
4. Wire emits in each agent `graph.ts` after successful structured-output validation (4 emit sites: investor-profile→preferences, market-intelligence→signals, portfolio-engine→rationale, advisory-narrative→rationale).
5. Update the 5 retrieval call sites per the table above (sites 5+6 merge in narrative listener).
6. Add `CreateEvent` IAM grant per agent service stack; restate `RetrieveMemoryRecords` grant.
7. Update unit tests: mocks for `emitLongTermEvent`, assertions it fires once on success and zero times on degraded output; updated namespace-parameter assertions for `searchLongTermMemory`.
8. Iterate custom extraction prompts for `signals` + `rationale` against sample data (deferred OQ #1).

**Phase B validation gate:**
- Run e2e for the same tenant 5 times in a row
- Wait 5 minutes (Bedrock extraction lag)
- Manual `searchLongTermMemory` queries against each of the 3 namespaces — confirm non-empty extracted records with coherent summary text (not raw JSON dumps)
- Bedrock extraction strategy CloudWatch metrics show non-zero invocations
- No regression in Phase A latency numbers
- New parking dossier created at Phase B start: any extraction-prompt iteration findings that emerge

**Rollback posture:**
- Phase A: revert PR; redeploy. Memory infra intact means `readUpstreamOutput` could be reintroduced if needed.
- Phase B: additive (no behavior change to consumers if extraction returns empty — callers already handle empty arrays). Rollback = revert PR + delete the 3 MemoryStrategy resources.

## Testing & error handling

### Unit tests

| Service | Files | Change |
|---|---|---|
| advisory-narrative-ctrl | `test/unit/event-listener.test.ts`, `test/unit/agent-service.test.ts` | Replace `mockReadUpstreamOutput` with subject-based fixtures. Delete retry-loop tests. |
| portfolio-engine-ctrl | `test/unit/event-listener.test.ts`, `test/unit/graph.test.ts` | Same shape; delete `'retries readUpstreamOutput("investor-profile")...'` test at line 180. |
| All 4 advisory agents (investor-profile, market-intelligence, portfolio-engine, advisory-narrative) | `test/unit/event-listener.test.ts`, `test/unit/graph.test.ts` (Phase B only) | Add `mockEmitLongTermEvent`; assert it's called exactly once with the right `namespace` on successful structured output, NOT called on degraded/failed output. Update `mockSearchLongTermMemory` invocation assertions to include the new `namespace` arg. For advisory-narrative, assert the merged single `rationale` call replaces the two previous calls. |
| decision-workflow-ctrl | `test/unit/assemble-packet.test.ts`, `test/unit/decision-state-machine.test.ts`, `test/unit/service.stack.test.ts` | AssemblePacket: replace `mockReadUpstream` with `event.detail` fixtures. State machine: CDK assertions on new `Parameters` blocks. Phase B: assertions on the 3 MemoryStrategy resources (type, namespace patterns, prompts) + `InvokeModel` IAM grant on Memory execution role. |
| agent-orchestrator lib | New test for runtime 25 KB size guard (mock SendTaskSuccess body, assert S3 write + pointer substitution when threshold crossed). | |

### Integration tests
Existing per-service integration tests (`advisory-narrative-ctrl.integration.test.ts` etc.) re-run after Phase A deploy. Verify they still pass when `writeAgentOutput` / `readUpstreamOutput` are removed (they likely don't directly assert these calls, but verify).

### E2E tests (`apps/e2e-feature-tests`)
- **Phase A validation gate:** 5 consecutive runs of `first-decision.e2e.test.ts` + `reconciliation-correction.e2e.test.ts` with `gen_ai.invocation.latency_ms < 20_000`.
- **Phase B validation gate:** new e2e scenario `long-term-recall.e2e.test.ts` — 5 decisions for same tenant, wait ~5 min for extraction backlog, assert `searchLongTermMemory` returns ≥1 record per namespace. Filed via `create-e2e-test` skill at plan time.

### Error handling — Phase A

| Failure | Handling |
|---|---|
| Agent output > 25 KB | Runtime size guard in agent server: log warning, write to S3, include pointer in `SendTaskSuccess`. Downstream readers detect pointer (sentinel field), fetch from S3. ~50-100 ms when triggered; expected to never trigger today. |
| Agent task times out | Existing `waitForTaskToken` timeout in SF — unchanged. |
| Empty agent output | `EmptyAgentResponseError` / `DegradedAgentOutputError` already raised in `assertOrchestratorOutput` (`52a22f96`). Output simply isn't included in `SendTaskSuccess`; downstream readers handle missing fields the way they handle empty Memory reads today (placeholder fallback at `assemble-packet.ts:64-67`). |
| AssemblePacket can't find agent output in `event.detail` | Existing placeholder fallback (lines 64-67) — defence-in-depth. CloudWatch warning when it fires (should never if SF is wired correctly). |

### Error handling — Phase B

| Failure | Handling |
|---|---|
| `emitLongTermEvent` fails | Catch + log + continue. Long-term recall is best-effort; agent's main path must not block on it. Counter metric `LongTermEventEmitFailures`. |
| MemoryStrategy extraction fails | Handled by AgentCore Memory itself; surfaced via Memory's own CloudWatch metrics. CloudWatch alarm at >5% failure rate over 5 min. |
| Strategy backlog grows | Monitor backlog metric; alarm if >100 pending per strategy for >10 min. Filed for ops follow-up if it triggers. |
| `searchLongTermMemory` empty when caller expected data (new tenant, first decision) | Existing graceful handling: `tenantHistory.length > 0 ? historyContext : ''`. No change. |

## Open questions, dependencies & risks

### Open questions (deferred to plan-time)

| # | Question | Resolution path |
|---|---|---|
| 1 | Refinement of `signals` + `rationale` extraction prompts | Starting prompts defined in Part B; iterate during Phase B with sample data from real e2e runs and tighten if extraction quality is poor. |
| 2 | Bedrock model for extraction strategies | Default to Haiku (cost-optimal for extraction; matches `agentcore-cost-safeguards` posture); revisit if quality insufficient. |
| 3 | SF state plumbing syntax (JSONata vs JSONPath in `Parameters` blocks) | Match existing pattern in `decision-state-machine.ts:113` (raw ASL with JSONPath like `'investorProfile.$': '$.investorProfile'`). |
| 4 | Runtime size guard fallback bucket | Reuse a per-agent KB bucket OR provision dedicated `agent-outputs-overflow` with 7-day lifecycle. Plan-time decision based on whether the guard ever fires. |
| 5 | CloudWatch alarm thresholds (extraction failure rate, backlog size) | Conservative initial thresholds during Phase B; tune after 1 week of dev observation. |

### External dependencies

| Dependency | Risk | Mitigation |
|---|---|---|
| `@aws-sdk/client-bedrock-agentcore@^3.1012.0` supports `CreateEventCommand` + MemoryStrategy provisioning | Low — SDK is fresh enough; verify API shape during implementation | Read SDK types; bump version if missing |
| AgentCore Memory `expirationDuration: Duration.days(90)` on the construct | Long-term records age out at 90 days — first-decision data may be gone before second decision for low-frequency tenants | Acceptable for advisory pipeline (high-frequency); revisit when prod tenant patterns are known |
| Bedrock model availability + quotas in us-east-1 for extraction | Extraction adds to Bedrock quota usage | Use Haiku (Q2); monitor quota |
| AssemblePacket Lambda invocation pattern | Today: SF Task invokes Lambda which then reads Memory. After: same invocation; Lambda receives upstream outputs in event payload | No external dependency change — pure internal data flow |
| Onboarding-bff's separate Memory usage | Onboarding uses different namespace patterns; verify our infra changes don't break it | Memory infra construct stays; only IAM grants on advisory ctrls change. Onboarding not affected. |

### Risks

1. **Custom extraction prompt iteration may extend Phase B timeline.** `signals` and `rationale` need prompts that produce useful cross-decision summaries — getting these right is more art than science. Plan for 2-3 iterations after Phase B's initial deploy.
2. **Bedrock extraction lag is unbounded.** Strategies extract async; lag could be seconds (typical) or minutes (under load). The first `searchLongTermMemory` call after extraction is provisioned will return empty; this is fine for the design but worth noting in the validation gate (5-min wait).
3. **Phase B introduces a new failure surface (`emitLongTermEvent`).** Mitigated by best-effort semantics — failures caught + logged + non-blocking. No hot path depends on it.
4. **Phase A's runtime size guard is untested in practice.** Current p99 is 6.1 KB vs 25 KB threshold (4x headroom). The S3 fallback path won't be exercised by today's traffic. Unit test for guard logic; production-path validation happens organically when/if outputs grow.

## References

- `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:55-63` — the 28s retry loop being deleted
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:22,82,125,113` — SF state shape + Parameters pattern
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts:23-29` — the comment that signals long-term recall needs a design workstream
- `docs/architecture/SYSTEM-ARCHITECTURE.md` §17 — AgentCore Memory contract (the documented intent for Part B)
- `libs/agent-orchestrator/src/memory/memory-client.ts` — current `MemoryClient` implementation
- Commit `4960a10d` (2026-05-09) — added the retry loop being deleted
- Commit `3f6eea0e` (2026-05-11) — dropped the vestigial MemoryStrategies that Part B reinstates with the right namespace alignment
- Commit `fa7f0a17` (2026-05-09) — precedent for SF state passing (`operatingMode` migration)
- Commit `97d41a36` (2026-05-07) — Phase β discriminant check pattern that `emitLongTermEvent` mirrors
- Backlog item `advisory-narrative-latency-budget-overshoot-e2e` — Phase A's blocker dossier; ships when Phase A ships
