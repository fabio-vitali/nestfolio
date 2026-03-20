# Plan Review: Conversational Onboarding Agent

**Plan:** `docs/superpowers/plans/2026-03-19-conversational-onboarding-agent.md`
**Spec:** `docs/superpowers/specs/2026-03-19-conversational-onboarding-agent-design.md`
**Date:** 2026-03-19

---

## 1. Completeness

| Spec Section | Plan Coverage | Status |
|---|---|---|
| S1. High-Level Architecture | Tasks 8-10, full graph + CDK stack | PASS |
| S2. LangGraph Agent Design (state, 7 phases, tools) | Tasks 4-8 | PASS |
| S3. Frontend Integration (renderers, CopilotKit, store) | Tasks 12-15 | PASS |
| S4. Backend service structure | Tasks 1-9 | PASS |
| S5. Data Model (AccountMode, OnboardingSession, phase mapping) | Tasks 2-3 | PASS |
| S6. Session Resume & Error Handling | Partial -- see issues below | ISSUE |
| S7. Testing Strategy | Tests in every task | PASS |
| S8. Removal from investor-bff | Tasks 16-17 | PASS |
| S9. Dependencies & Packages | Task 12 | PASS |
| S10. Fallback Plan (AG-UI) | Task 15 mentions it | PASS |
| S11. RAG Knowledge Base docs | Task 11 | PASS |
| S12. Theme Consistency / CSS overrides | Task 14 Step 3 | PASS |

---

## 2. Issues Found

### CRITICAL

**C1: Missing Dockerfile for AgentRuntime container**

The `AgentRuntime` construct calls `AgentRuntimeArtifact.fromAsset(agentCodePath)` which requires a **Dockerfile** in the asset directory. The plan's CDK stack (Task 10) passes `agentCodePath: path.join(__dirname, '..')` but no task creates a `Dockerfile` or `docker-compose.yml` in the service root. The existing advisory services that use `AgentRuntime` also reference code paths that contain Dockerfiles.

**Fix:** Add a task (before Task 10) to create `services/investor/onboarding-agent-bff/Dockerfile` that builds the Hono server for the AgentCore container runtime.

---

**C2: CDK stack missing `tables` prop -- no DDB access granted**

The spec says "Agent writes directly to DynamoDB using investor-bff's table." The plan's CDK stack (Task 10, line 2123) creates the `AgentRuntime` but does NOT pass the `tables` prop. Without `tables: [investorTable]`, the runtime's IAM role won't have DDB read/write access. The `tableName` SSM parameter is resolved as a string, not an `ITable` reference.

The spec's CDK snippet (Section 4) correctly shows `tables: [investorTable]`, but the plan does not look up the actual table construct. Since the table is owned by `investor-hub`, the stack needs to import it via `Table.fromTableArn()` or `Table.fromTableName()`.

**Fix:** Add a `Table.fromTableName()` lookup in the CDK stack and pass it to `AgentRuntime` as `tables: [investorTable]`.

---

### IMPORTANT

**I1: Session resume logic is incomplete**

The spec (Section 6) defines a detailed session lifecycle:
- Query `OnboardingSession` on page load
- If active: rehydrate state from DDB, load conversation from AgentCore Memory, agent says "Bentornato!"
- If completed: show recap + CTA

The plan has `getActiveSession` in the repository (Task 3) but **no task** covers:
1. The frontend calling session-check on mount
2. The runtime/server.ts handling session rehydration (loading committed DDB data into LangGraph state)
3. Loading conversation history from AgentCore Memory via `agentMemorySessionId`

**Fix:** Add a task (in Chunk 2 or 3) that implements the session resume flow in `server.ts` or a dedicated `session.ts` module, with tests for resume from phases 1-6.

---

**I2: Max-turns safety cap (50 turns) not implemented**

The spec requires a 50-turn safety cap where the agent commits all collected data, shows progress summary, and presents a "Riprendi piu tardi" CTA. No phase node, router logic, or test covers this.

**Fix:** Add turn counting to the `OnboardingAnnotation` state (`turnCount: number`) and a conditional check in the router or as middleware that triggers the safety cap behavior. Add a test case.

---

**I3: Error handling behaviors not fully covered**

The spec defines 6 error scenarios (timeout, DDB failure, invalid state, gibberish, SSE disconnect, model error). The plan covers:
- Gibberish: implicitly via system prompt
- Model error: mentioned in spec but no `withRetry` escalation is wired in graph.ts

Missing from the plan:
- Agent response timeout (>15s) UI indicator + retry
- SSE disconnect auto-reconnect on frontend
- Invalid agent state Zod validation catch

**Fix:** Add error handling steps to Tasks 9 (server-side timeout/retry) and 14 (frontend reconnect/timeout UI).

---

**I4: `commitHorizon` missing from repository tests**

Task 3 tests 8 methods but `commitHorizon` is not tested. The implementation queries existing goals and updates them -- this is non-trivial logic that needs test coverage (especially the `queryByPk` + `UpdateCommand` path and the edge case where no goal exists).

**Fix:** Add `commitHorizon` test cases in Task 3 Step 1.

---

**I5: `RiskProfile` SK pattern inconsistency**

The spec says `RiskProfile#{profileId}` (with a generated ID suffix), but the plan's repository implementation (line 812) uses `sk: 'RiskProfile'` (no suffix). This means only one risk profile per user, which may be intentional for onboarding but conflicts with the spec's notation. Similarly, `OperatingMode` uses `sk: 'OperatingMode'` (no suffix) while the spec says `OperatingMode#{id}`.

**Fix:** Clarify which pattern is correct. If the intent is one-per-user (likely for onboarding), update the spec. If multiple are allowed, add the `#{id}` suffix in the repository.

---

### SUGGESTIONS

**S1: Phase nodes are identical -- simplify file structure**

All 7 phase files (`horizon.ts`, `mode.ts`, etc.) re-export from `goal.ts`. The plan acknowledges this (line 1806) but still creates 7 files. Consider having only `goal.ts` export the factory and letting `graph.ts` call `createPhaseNode(phaseName, deps)` directly, eliminating 6 boilerplate files.

---

**S2: `onboarding-chat.component.ts` has placeholder, not CopilotKit wiring**

Task 14 creates the component with a `<div class="chat-placeholder">` comment. Task 15 is supposed to wire CopilotKit but its implementation is entirely pseudo-code (`// Add CopilotKit imports...`). This is the riskiest part of the plan -- the exact `@copilotkitnext/angular` API is unknown.

**Recommendation:** Task 15 should include a concrete compatibility verification step: import the module, check if it compiles, and if not, immediately switch to the AG-UI fallback path with a defined set of components.

---

**S3: `pnpm.overrides` may also need `@angular/platform-browser`**

The spec lists overrides for `@angular/core`, `@angular/common`, and `@angular/cdk`. Depending on `@copilotkitnext/angular`'s actual dependencies, `@angular/platform-browser` may also be needed.

---

**S4: No `tsconfig` path alias for the new service domain barrel**

The jest.config maps `@nestfolio/investor-bff/service` but there is no corresponding path alias for `@nestfolio/onboarding-agent-bff/service` in `tsconfig.base.json`. If other services need to import events from this service (consumer pattern), the alias should be added.

---

## 3. File Structure

All files from the spec are accounted for in the plan. Extra files in the plan that are not in the spec:
- `src/service-domain/models.ts` (plan separates interfaces from Zod schemas) -- reasonable addition
- `src/service-domain/index.ts` (barrel) -- standard pattern
- `src/main.ts` (CDK entry) -- required, implicitly expected

**Missing from plan:**
- `Dockerfile` (needed by `AgentRuntime.fromAsset()`) -- **Critical**
- No `package.json` in the service dir (not needed if Nx root handles it) -- OK

---

## 4. Task Ordering & Dependencies

| Chunk | Tasks | Dependencies | Parallelizable? |
|---|---|---|---|
| 1: Backend Scaffolding | 1-4 | Sequential (1 before 2-4) | Tasks 2, 3, 4 parallelizable after Task 1 |
| 2: Agent Graph | 5-9 | 5 before 6-8; 7 needs 3+5; 9 needs 8 | 5 and 6 parallelizable |
| 3: CDK + RAG | 10-11 | 10 needs 1+9; 11 independent | 10 and 11 parallelizable |
| 4: Frontend | 12-15 | 12 first; 13 and 14 parallelizable; 15 needs 13+14 | Partially |
| 5: Cleanup | 16-17 | After Chunk 4; 16 and 17 parallelizable | Yes |
| 6: Verification | 18 | After all | No |

Task ordering is correct. Good separation of concerns.

---

## 5. TDD

All implementation tasks follow test-first approach:
- Write test -> verify fail -> implement -> verify pass -> commit

Exception: Task 6 (prompts) has no tests, noted as "tested implicitly via phase nodes." This is acceptable since prompts are string constants.

Exception: Task 10 (CDK stack) has no CDK test (snapshot or assertion). This is consistent with existing service patterns in the codebase.

---

## 6. Codebase Pattern Compliance

| Pattern | Plan Compliance | Status |
|---|---|---|
| `project.json` structure | Matches `advisory-narrative-ctrl` exactly | PASS |
| `jest.config.js` structure | Matches advisory-ctrl pattern | PASS |
| Test files in `test/` not `src/__tests__/` | All tests in `test/` | PASS |
| `testEnvironment: 'node'` for backend | Correctly set | PASS |
| `TableRepository` pattern | Used for `OnboardingRepository` | PASS |
| `transactWrite` + `EditEvent` pattern | Implemented correctly | PASS |
| `withMethodLogging` pattern | Applied to all repository methods | PASS |
| `ServiceStack` base class | Used in `service.stack.ts` | PASS |
| `resolvePipelineConfig` in main.ts | Correctly implemented | PASS |
| `KnowledgeBase` construct interface | Matches `KnowledgeBaseProps` exactly | PASS |
| `AgentRuntime` construct interface | Missing `tables` prop -- see C2 | ISSUE |
| Tags: `scope:investor`, `type:bff` | Correctly set | PASS |

---

## 7. Summary

**Overall Assessment:** The plan is thorough and well-structured with 18 tasks across 6 logical chunks. It correctly follows TDD, existing codebase patterns, and covers the vast majority of the spec. The critical gaps are the missing Dockerfile and DDB table access in the CDK stack. The session resume and max-turns features need explicit implementation tasks.

### Action Items

| Priority | Issue | Action |
|---|---|---|
| Critical | C1: Missing Dockerfile | Add task before Task 10 |
| Critical | C2: Missing `tables` prop | Fix Task 10 CDK stack |
| Important | I1: Session resume not implemented | Add task in Chunk 2 |
| Important | I2: Max-turns cap missing | Add turn counter to state + router check |
| Important | I3: Error handling gaps | Add steps to Tasks 9 and 14 |
| Important | I4: `commitHorizon` untested | Add test cases to Task 3 |
| Important | I5: SK pattern inconsistency | Clarify spec vs plan |
| Suggestion | S1: Simplify phase files | Remove 6 boilerplate re-exports |
| Suggestion | S2: Task 15 too vague | Add concrete verification steps |
| Suggestion | S3: May need more pnpm overrides | Verify at install time |
| Suggestion | S4: Missing tsconfig path alias | Add if cross-service import needed |
