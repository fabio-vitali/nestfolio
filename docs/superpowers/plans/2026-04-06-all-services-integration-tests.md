# All-Services Integration Tests — Execution Prompt

> **For agentic workers:** Use `superpowers:subagent-driven-development` to dispatch parallel sub-agents within each batch. Each batch must complete before the next begins. Use `superpowers:verification-before-completion` before marking any batch done.

**Goal:** Implement integration tests for ALL remaining services (29 of 33), following the 4 established patterns from the reference implementations.

**Context:** Phase 1-3 of `docs/superpowers/plans/2026-04-05-per-service-integration-tests.md` is complete. The `libs/integration-testing` library and 4 reference tests exist. The alignment plan `docs/superpowers/plans/2026-04-06-integration-test-alignment.md` has been executed. All infrastructure (source filters, CDC test-tenant tagging, Cognito admin auth, ParamsAndSecrets) is deployed.

---

## Issue Tracker

**CRITICAL:** Maintain a running issue log at `docs/superpowers/plans/integration-test-issues.md` throughout execution. Every time you encounter ANY of the following, log it immediately:

- Code bugs (wrong keys, missing fields, broken imports)
- Pattern inconsistencies (services that don't follow expected conventions)
- Missing event types or mismatched event names
- DDB key schema surprises (pk/sk patterns that differ from expectations)
- CDK stack issues (missing constructs, wrong SSM paths)
- Test infrastructure gaps (missing fixtures, needed utilities)
- Broken or stale service CLAUDE.md cards

Format each entry as:

```markdown
### Issue #{n}: {short title}
- **Service:** {service-name}
- **Category:** bug | inconsistency | missing | stale-docs
- **Description:** {what you found}
- **Resolution:** {what you did to fix it, or DEFERRED if not fixable in test}
- **Affected services:** {list of other services that might have the same issue}
```

---

## Prerequisites (verify before starting)

- [ ] Confirm 4 reference integration tests pass:
  ```bash
  pnpm nx run investor-bff:test-integration
  pnpm nx run investor-ctrl:test-integration
  pnpm nx run investor-adpt:test-integration
  pnpm nx run broker-alpaca-adpt:test-integration
  ```
- [ ] Create `docs/superpowers/plans/integration-test-issues.md` with header

---

## Reference Implementations

Study these 4 files before writing ANY test — they are the canonical patterns:

| Pattern | Reference File | Fixtures Used |
|---------|---------------|---------------|
| Cross-domain ADPT | `services/investor/investor-adpt/test/integration/from-execution.integration.test.ts` | EventBridgeClient, EventBusTrap |
| CTRL (event→DDB→CDC) | `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts` | EventBridgeClient, EventBusTrap |
| BFF (GraphQL) | `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts` | CognitoFixture, AppSyncClient, EventBusTrap, TableAssertions |
| 3P ADPT (mock API) | `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts` | MockApiFixture, SsmOverrideFixture, EventBridgeClient, EventBusTrap, TableAssertions |

---

## Per-Service Scaffolding Checklist

For EACH service that doesn't already have integration tests, you must:

1. **Read** the service's `CLAUDE.md` — understand its Ingress subscriptions, Egress CDC emissions, State, Facade
2. **Read** the service's `src/handlers/event-listener.ts` (or equivalent) — understand what it does with each event
3. **Read** the service's `src/domain/events.ts` — get exact event type strings
4. **Read** the service's `project.json` — check if `test-integration` target exists
5. **If no `test-integration` target:** add it + create `jest.integration.config.js` + move existing tests to `test/unit/` if not already done (follow the pattern from investor-ctrl's project.json and jest configs)
6. **Create** `test/integration/{service-name}.integration.test.ts`
7. **Run** `pnpm nx run {service-name}:test-integration` — verify it passes
8. **Log** any issues found to the issue tracker

---

## Batch 1: Cross-Domain Adapters (3 services, PARALLEL)

**Pattern:** EB Rule forwarding — put event on source bus, verify it arrives on target bus.
**Reference:** `investor-adpt/test/integration/from-execution.integration.test.ts`

Each adapter has 1-3 forwarding rules. Write ONE test per rule (pick one representative event type per rule).

### 1a. advisory-adpt

Read `services/advisory/advisory-adpt/CLAUDE.md` and `src/service.stack.ts`.

3 rules to test:
- Investor → Advisory: pick `GOAL_UPDATED` → trap on advisoryBus
- Execution → Advisory: pick `ORDER_FILLED` → trap on advisoryBus
- Ledger → Advisory: pick `PORTFOLIO_UPDATED` → trap on advisoryBus

```
putEvent({ bus: 'investor', targetService: 'advisory-adpt', detailType: 'GOAL_UPDATED', ... })
→ EventBusTrap on advisory bus, waitForEvent({ detailType: 'GOAL_UPDATED' })
```

### 1b. execution-adpt

Read `services/execution/execution-adpt/CLAUDE.md` and `src/service.stack.ts`.

2 rules to test:
- Advisory → Execution: pick `DECISION_APPROVED` → trap on executionBus
- Investor → Execution: pick `EXECUTION_MODE_CHANGED` → trap on executionBus

### 1c. ledger-adpt

Read `services/ledger/ledger-adpt/CLAUDE.md` and `src/service.stack.ts`.

1 rule to test:
- Execution → Ledger: pick `ORDER_FILLED` → trap on ledgerBus

**Dispatch:** 3 parallel sub-agents, one per adapter. Each agent reads the service CLAUDE.md, stack file, creates the integration test, adds project.json target if needed, and runs it.

---

## Batch 2: Simple CTRL Services (6 services, PARALLEL in groups of 3)

**Pattern:** Event → SQS → Lambda → DDB write → CDC → EventBridge
**Reference:** `investor-ctrl/test/integration/onboarding-notification.integration.test.ts`

For each CTRL, pick ONE inbound event that triggers a DDB write, then verify the CDC output event via EventBusTrap.

**IMPORTANT:** Read the event-listener handler to understand:
- What DDB entity gets created (pk/sk pattern)
- Which CDC event types that entity emits (from `domain/events.ts` + `eventTypes` in stack)

### 2a. compliance-ctrl (advisory domain)

- Trigger: `DECISION_PACKET_CREATED` on advisoryBus → target `compliance-ctrl`
- Expected: DDB ComplianceCheck record → CDC emits `DECISION_APPROVED` or `DECISION_BLOCKED`
- Trap on advisoryBus for the CDC output

### 2b. execution-ctrl (execution domain)

- Trigger: `DECISION_APPROVED` on executionBus → target `execution-ctrl`
- Expected: DDB Order record → CDC emits `ORDER_SUBMITTED` or `ORDER_STAGED`
- Trap on executionBus for the CDC output

### 2c. ledger-ctrl (ledger domain)

- Trigger: `ORDER_FILLED` on ledgerBus → target `ledger-ctrl`
- Expected: DDB LedgerEntry + BalanceEvent → CDC emits `BALANCE_UPDATED` or `LEDGER_ENTRY_RECORDED`
- Trap on ledgerBus for the CDC output

### 2d. reconciliation-ctrl (ledger domain)

- Read CLAUDE.md first to understand its subscriptions and outputs
- Follow same pattern: trigger event → verify DDB + CDC

### 2e. broker-sim-adpt (execution domain)

Although named "-adpt", this is effectively a CTRL pattern (no external API — pure simulation):
- Trigger: `SIM_ORDER_REQUESTED` on executionBus → target `broker-sim-adpt`
- Expected: DDB VirtualTrade → CDC emits `SIM_ORDER_FILLED`
- Trap on executionBus

### 2f. broker-ctrl (execution domain)

**Complex:** Has 4 ingress handlers + Orchestration SFs. Test ONLY the simplest path:
- Trigger: `EXECUTION_MODE_CHANGED` on executionBus → target `broker-ctrl`
- Expected: DDB mode cache record written
- Verify via TableAssertions (no CDC for this path)
- NOTE: Do NOT test the Order SF path — requires SF callback chain, too complex for first pass

**Dispatch:** 2 rounds of 3 parallel sub-agents each.

---

## Batch 3: BFF Services (3 services, PARALLEL)

**Pattern:** Cognito auth → GraphQL mutation → DDB write → CDC
**Reference:** `investor-bff/test/integration/initiate-deposit.integration.test.ts`

Each BFF has an AppSync Facade. Pick ONE simple mutation to test.

**IMPORTANT:** Each BFF uses the same Cognito User Pool (investor-web). The `AppSyncClient` constructor takes the service name as 3rd param.

### 3a. advisory-bff

- Read CLAUDE.md and discover available mutations (discoverJsResolvers)
- Read `src/graphql/js-function/` to find mutation names and their DDB effects
- Example: `confirmDecision` or similar mutation → DDB UserConfirmation → CDC `USER_CONFIRMED`
- Use: `new AppSyncClient(ctx, tokens, 'advisory-bff')`

### 3b. dashboard-bff

- Read CLAUDE.md — note: dashboard-bff may be READ-ONLY (queries, no mutations)
- If read-only: test the event-listener path instead (put event → verify DDB materialization via TableAssertions)
- If it has mutations: test one mutation end-to-end
- Use: `new AppSyncClient(ctx, tokens, 'dashboard-bff')`

### 3c. ledger-bff

- Read CLAUDE.md and discover mutations
- Use: `new AppSyncClient(ctx, tokens, 'ledger-bff')`

**Dispatch:** 3 parallel sub-agents.

---

## Batch 4: Complex CTRL Services with AgentRuntime (5 services, SEQUENTIAL)

**These services have AgentRuntime (Bedrock agents). Testing the agent path end-to-end is NOT in scope for this batch.** Instead, test only the event-listener path (Ingress → DDB write → CDC), same as Batch 2.

### 4a. advisory-ctrl
### 4b. advisory-narrative-ctrl
### 4c. investor-profile-ctrl
### 4d. market-intelligence-ctrl
### 4e. portfolio-engine-ctrl

For each:
1. Read CLAUDE.md to find Ingress subscriptions
2. Read event-listener.ts to find what DDB entity gets written
3. Pick ONE event that triggers a simple DDB write (NOT an agent invocation)
4. If ALL inbound events trigger agent invocations (no direct DDB write), then test: put event → verify DDB AgentInvocation or WorkflowState record → verify CDC event

**IMPORTANT:** If you discover that a service's event-listener ONLY dispatches to AgentRuntime (no direct DDB writes), log this in the issue tracker and write a minimal test that at least verifies the event is received (DDB write of invocation record).

**Dispatch:** Up to 3 parallel sub-agents per round (some may have dependencies if they share event types).

---

## Batch 5: Orchestration CTRL (1 service, SEQUENTIAL)

### 5a. decision-workflow-ctrl

**Complex:** Has Step Functions orchestration with dual Ingress (Trigger + Callback).

Test the TriggerIngress path only:
- Trigger: `MANDATE_CREATED` on advisoryBus → target `decision-workflow-ctrl`
- Expected: DDB WorkflowTrigger record → CDC emits `WORKFLOW_TRIGGER`
- DO NOT test the full SF workflow (requires agent completion callbacks)

---

## Batch 6: Third-Party Data Feed Adapters (5 services, PARALLEL in groups)

**Pattern:** These adapters call external APIs (Alpha Vantage, FRED, Yahoo Finance, etc.). They follow the same architecture: event triggers fetch → DDB write → CDC.

**Strategy:** For each adapter, decide:
- **Option A (preferred):** If the adapter uses SSM/Secrets for API config (like broker-alpaca-adpt), use `MockApiFixture` + `SsmOverrideFixture` to redirect to a mock
- **Option B:** If the handler is simple enough, test only that the event is received and a DDB record attempt is made (even if the API call fails gracefully)

### Services:
- alpha-vantage-adpt (has SSM API key → Option A viable, need mock Alpha Vantage handler)
- fred-adpt (read CLAUDE.md to determine API config pattern)
- marketwatch-adpt (read CLAUDE.md)
- sec-edgar-adpt (public API, may not need SSM override)
- yahoo-finance-adpt (read CLAUDE.md)

For each:
1. Read CLAUDE.md + event-listener.ts + service.stack.ts
2. Identify how API config is loaded (env var? SSM? Secrets?)
3. If SSM/ParamsAndSecrets: create a mock handler + use SsmOverrideFixture
4. If hardcoded env var: log as issue (needs stack change to support ParamsAndSecrets)
5. If public API with no auth: may be able to test directly (but mock is still preferred for reliability)

**Mock handlers:** Create one mock handler per API in `libs/integration-testing/src/mock-handlers/`:
- `mock-alpha-vantage.ts` (return canned news/indicator response)
- `mock-fred.ts` (return canned economic data)
- etc.

Add `build:mocks` commands for each in `libs/integration-testing/project.json`.

**Dispatch:** 2-3 parallel sub-agents per round.

---

## Batch 7: Special Services

### 7a. onboarding-bff

**Special:** Has AgentRuntime but NO AppSync Facade. Has CDC for ONBOARDING_COMPLETED.

Strategy: Test the CDC path only — if there's a way to trigger a DDB write (e.g., via the agent's commit-phase tool writing to DDB), verify the CDC output. Otherwise, this may need to be deferred.

Read CLAUDE.md + handler code to determine feasibility.

### 7b. HUB Services (4 services — SKIP)

- investor-hub, advisory-hub, execution-hub, ledger-hub
- These are infrastructure-only (EventBridge bus + SSM). No handlers, no DDB, no CDC.
- **Do NOT write integration tests for hubs.** Their correctness is verified implicitly by all other tests (events flow through the bus).

### 7c. investor-web (SKIP)

- Frontend Angular app. Not a backend service.
- Integration testing would be E2E/Cypress, not in scope.

---

## Final: Issue Verification Sweep

After ALL batches are complete:

1. **Read** `docs/superpowers/plans/integration-test-issues.md` in full
2. **For each issue with "Affected services: ..."**, dispatch a parallel sub-agent to verify ALL listed services against that issue
3. **Cross-check patterns:** For each issue category, grep the entire codebase to find ALL instances:
   - If issue was a wrong claim key → `grep -r "custom:tenantId" services/ libs/`
   - If issue was a wrong SSM path → verify all services use consistent `ssmServicePath` patterns
   - If issue was a missing event type → check all `domain/events.ts` files
   - If issue was a stale CLAUDE.md → re-run `audit-service` skill for affected services
4. **Fix** any newly discovered instances
5. **Update** the issue tracker with the sweep results
6. **Regenerate** stale service CLAUDE.md cards using the `audit-service` skill for any service where code was modified
7. **Run** ALL integration tests one final time:
   ```bash
   pnpm nx run-many -t test-integration --all
   ```

---

## Completion Criteria

- [ ] All 29 remaining services have integration tests (except 4 hubs + investor-web = 5 skipped)
- [ ] All tests pass: `pnpm nx run-many -t test-integration --all`
- [ ] Issue tracker is complete with all findings
- [ ] Verification sweep has been executed
- [ ] All affected CLAUDE.md cards regenerated
- [ ] No `custom:tenantId` (camelCase) anywhere in codebase
- [ ] All integration test files follow naming convention: `test/integration/{name}.integration.test.ts`
- [ ] All services have `test-integration` target in `project.json`

---

## Context Efficiency Guidelines

- **DO NOT** read all 29 service files upfront. Read each service's CLAUDE.md + handler code only when its batch starts.
- **Dispatch parallel sub-agents** within each batch. Each sub-agent should be self-contained with:
  - The reference implementation file path
  - The specific service name and domain
  - The issue tracker file path
  - Instructions to read CLAUDE.md first
- **Keep the main agent lean** — it coordinates batches and aggregates issues, sub-agents do the implementation work.
- **Phase boundaries:** If context gets heavy after 3-4 batches, summarize progress in the issue tracker and suggest the user start a new conversation for remaining batches. Each batch is independently resumable.
- **Commit after each batch**, not after each service. This keeps git history clean:
  ```
  feat(integration-tests): add cross-domain adapter tests (batch 1)
  feat(integration-tests): add CTRL service tests (batch 2)
  feat(integration-tests): add BFF service tests (batch 3)
  ...
  ```
