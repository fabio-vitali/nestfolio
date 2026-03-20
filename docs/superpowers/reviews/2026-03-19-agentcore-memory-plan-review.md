# AgentCore Memory Plan Review

**Plan:** `docs/superpowers/plans/2026-03-19-agentcore-memory.md`
**Spec:** `docs/superpowers/specs/2026-03-18-agentcore-memory-design.md`
**Reviewed:** 2026-03-19

---

## 1. Spec Coverage Analysis

| Spec Section | Plan Coverage | Status |
|---|---|---|
| Memory Resource Topology (1 Memory, SSM sharing) | Task 2.2 | COVERED |
| Namespace convention | Task 1.1 code | COVERED |
| Decision Session Flow (new flow) | Chunks 3 + 4 | COVERED |
| Long-term Memory Strategies (5 strategies) | Task 2.2 CDK wiring | MISSING - see Critical #1 |
| Runtime Helper (`createMemoryClient`) | Task 1.1 | COVERED |
| Graceful Degradation (no-op client) | Task 1.1 | COVERED |
| DDB Persistence Simplification (remove input/output from AgentInvocation) | Not in plan | MISSING - see Critical #2 |
| DecisionPacket model field removal | Task 4.1 | COVERED |
| storeAgentOutput removal | Task 4.1 | COVERED |
| Completion event payload changes | Tasks 3.1-3.4 + 4.4 | COVERED |
| SF payload simplification | Task 4.3 | COVERED |
| AssembleDecisionPacket Lambda | Task 4.2 | COVERED |
| Memory vs Knowledge Base distinction | N/A (conceptual) | N/A |
| Dependencies (`@aws-cdk/aws-bedrock-agentcore-alpha`) | Task 2.1 | COVERED |
| Risk mitigations (retry, latency, unavailability) | Graceful degradation in code | PARTIAL |

---

## 2. Critical Issues (must fix)

### Critical #1: CDK Memory construct strategies are missing from Task 2.2

The spec defines 5 long-term memory strategies (InvestorPreferenceLearner, MarketSignalExtractor, AllocationRationaleExtractor, NarrativePreferenceLearner, NarrativeSessionSummarizer). Task 2.2 says to "Add Memory construct" but the plan has **no code example showing the strategies**. The spec's CDK section (lines 167-193) contains the full strategy configuration. The plan must include this or reference the spec's CDK block explicitly so the implementer knows to add all 5 strategies.

### Critical #2: DDB persistence simplification is not covered

The spec (lines 226-238) explicitly calls for removing `input` and `output` fields from the `AgentInvocation` DDB records in **all 4 agent services**. The actual codebase confirms the issue: `investor-profile-ctrl/src/agent-service.ts` writes `AgentInvocation` records to DDB but currently does NOT include `input`/`output` fields (the completed record only has `status`, `startedAt`, `completedAt`, `durationMs`). However, the spec says to add `modelTier` and `errorInfo` fields. There is no task in the plan that touches the `agent-service.ts` files in any of the 4 agent services. Either:
- Add a task to update `agent-service.ts` in each service to add `modelTier`/`errorInfo`, OR
- Explicitly note that the current DDB records already omit `input`/`output` (they do) and this is already aligned with the spec target.

### Critical #3: SDK commands `CreateEventCommand` and `RetrieveMemoryRecordsCommand` are unverified

The installed `@aws-sdk/client-bedrock-agent-runtime` does NOT contain `CreateEventCommand` or `RetrieveMemoryRecordsCommand` (verified: grep returned no matches). These are alpha/preview APIs. The plan uses these command names throughout Task 1.1 code as if they exist. The plan should:
1. Add a task to verify actual command names after installing the SDK update
2. Note the SDK version requirement explicitly
3. Consider that command names may differ (e.g., `CreateMemoryEventCommand`, `SearchMemoryCommand`, etc.)

---

## 3. Important Issues (should fix)

### Important #1: `@aws-cdk/aws-bedrock-agentcore-alpha` installed to wrong package

Task 2.1 installs the alpha CDK package with `--filter cdk-constructs`. However, the Memory construct is used in `decision-workflow-ctrl/src/service.stack.ts`, not in cdk-constructs. The package should be installed at root or filtered to `decision-workflow-ctrl`. The cdk-constructs lib is for reusable constructs (Ingress, Egress, etc.), not service-specific resources.

### Important #2: `MemoryClient` dependency injection missing from `EventListenerDeps`

The 4 agent services (Tasks 3.1-3.4) use `createHandlers(deps)` pattern with `EventListenerDeps` interface. The plan says to "Create a MemoryClient from env vars" inside the handler, but the existing pattern uses dependency injection via `deps`. The plan should add `memoryClient` to each service's `EventListenerDeps` interface for testability, matching the existing codebase convention.

### Important #3: `createDecisionPacket` in repository still writes 4 null output fields

The plan removes the 4 output fields from the `DecisionPacket` interface (Task 4.1) but does not mention updating `createDecisionPacket` in the repository (`decision-packet.repository.ts`), which currently initializes `investorProfileOutput: null`, `marketAnalysisOutput: null`, etc. when creating a new packet. These field initializations must also be removed.

### Important #4: Assemble-packet handler test has module caching issue

Task 4.2 test uses `await import('../src/handlers/assemble-packet')` inside each test, but the module is cached after first import. The `memoryClient` is created at module level (line 529-530 of plan). The mock setup via `jest.mock` at the top of the file should work, but the `process.env.MEMORY_ID` set in `beforeEach` will NOT affect the already-evaluated ternary on line 529. The test should use `jest.isolateModulesAsync()` or move client creation to a factory pattern.

### Important #5: Plan does not update `project.json` build target for `assemble-packet.ts`

Task 4.2 mentions adding `assemble-packet.ts` to `additionalEntryPoints` in `project.json`, but the current `project.json` has no `build` target with `additionalEntryPoints`. The decision-workflow-ctrl uses CDK deploy directly (no esbuild build target). The Lambda entry point is resolved by the CDK `NodejsFunction` construct at synth time. The plan should add the Lambda as a `NodejsFunction` in the stack (Task 2.2) rather than adding entry points.

---

## 4. Suggestions (nice to have)

### Suggestion #1: Task ordering — Chunk 3 depends on Chunk 2 IAM grants

The dependency is correct but implicit. Consider noting that Chunk 3 integration tests will fail if Chunk 2 CDK changes are not deployed first (though unit tests with mocks will pass).

### Suggestion #2: Error handling in assemble-packet

The `assemble-packet.ts` handler has no error handling for `JSON.parse` failures on Memory records. If a Memory record has malformed content, the entire assembly fails. Consider wrapping each parse in try/catch.

### Suggestion #3: `readUpstreamOutput` return type mismatch

The spec defines `readUpstreamOutput` returning `Record<string, unknown>[]` but the plan implementation returns `MemoryRecord[]` (with `content: string`, `relevanceScore`, etc.). The plan's implementation is more correct (the caller needs to `JSON.parse(content)` themselves), but this is a spec deviation that should be noted.

---

## 5. File Path Verification

| Plan Path | Exists? | Notes |
|---|---|---|
| `libs/agent-core/src/memory/` | NEW | Parent `libs/agent-core/src/` exists |
| `libs/agent-core/src/index.ts` | YES | |
| `libs/agent-core/test/` | YES | Has 8 existing test files |
| `services/advisory/decision-workflow-ctrl/src/service.stack.ts` | YES | |
| `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` | YES | |
| `services/advisory/decision-workflow-ctrl/src/service-domain/models.ts` | YES | |
| `services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts` | YES | |
| `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts` | YES | |
| `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` | NEW | Parent exists |
| `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts` | YES | |
| `services/advisory/investor-profile-ctrl/src/service.stack.ts` | YES | |
| `services/advisory/market-intelligence-ctrl/src/handlers/event-listener.ts` | YES | |
| `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` | YES | |
| `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` | YES | |
| All 4 agent service `service.stack.ts` files | YES | |
| All 4 agent service test files | Need verification | |

---

## 6. Summary

The plan covers the spec's core architecture well: Memory client in agent-core, CDK wiring, handler integration for all 4 agent services, and decision-workflow-ctrl simplification. Task ordering is correct (agent-core helper first, CDK wiring second, handler integration third, workflow simplification last).

**3 critical issues** need resolution before implementation:
1. Memory strategies must be explicitly included in the CDK task
2. DDB persistence simplification (AgentInvocation records) needs clarification
3. SDK command names are unverified and likely incorrect for the installed version

**5 important issues** would cause implementation friction or test failures if not addressed.
