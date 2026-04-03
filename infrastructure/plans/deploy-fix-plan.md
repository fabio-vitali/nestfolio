# Plan: Fix All Remaining Deployment Issues + Update Skills Documentation

## Context

Deployed 22/33 services with prefix `dev` to account 771924376645 (us-east-1). 11 services remain blocked by 6 distinct categories of issues. During deployment, we also discovered and fixed 5 CDK infrastructure bugs that need their generating documentation (skills) updated to prevent recurrence.

### Already deployed (22 services)
advisory-hub, execution-hub, investor-hub, ledger-hub, investor-web, investor-ctrl, investor-bff, investor-adpt, dashboard-bff, ledger-ctrl, ledger-bff, ledger-adpt, reconciliation-ctrl, execution-ctrl, execution-adpt, broker-sim-adpt, broker-alpaca-adpt, advisory-adpt, compliance-ctrl, marketwatch-adpt, sec-edgar-adpt, yahoo-finance-adpt

### Code already fixed during deployment (committed but skills not yet updated)
1. **deploy.sh** — Fixed `for...in` jq word-splitting bug (5 loops → `while IFS= read`), fixed `--prefix` arg passing (`-c prefix=` → `--prefix=`)
2. **All 33 main.ts** — Added `observability` to destructuring from `resolvePipelineConfig()` and stack props
3. **Facade SSM path** — Changed from `naming.ssmParameterPath()` (subsystem-scoped) to `naming.ssmServicePath()` (service-scoped) in `libs/cdk-constructs/src/core/facade.ts`
4. **Egress filter limit** — TEMPORARY: skips all filters when >5 (needs proper fix, see A6)
5. **AgentRuntime naming** — Sanitize underscores→hyphens for Gateway/target names in `libs/cdk-constructs/src/extensions/agent-runtime.ts`
6. **NamingService** — Added `ssmServicePath()` method to `libs/cdk-constructs/src/utils/naming-service.ts`
7. **onboarding-bff** — Fixed `runtimeName: 'onboarding-agent'` → `'onboarding_agent'`

---

## Part A: Fix CDK Code Bugs (5 services)

### A1. broker-ctrl — Step Functions HandleTimeout unreachable

**File:** `services/execution/broker-ctrl/src/state-machine/order-state-machine.ts`

**Problem:** HandleTimeout is a CustomState (line 416) only referenced via raw JSON `Catch[].Next: 'HandleTimeout'` strings in 3 CustomStates (RouteOrder line 108, WaitForMoreFills line 219, WaitForRetryResult line 347). CDK's graph traversal only discovers catch targets registered via `.addCatch()`. Raw JSON Catch is opaque to CDK — HandleTimeout never enters the StateGraph and is excluded from rendered ASL.

**Proposed fix (CDK-native):** Use `CustomState.addCatch()` on the 3 affected states:
1. Remove `Catch` arrays from raw `stateJson` in RouteOrder, WaitForMoreFills, WaitForRetryResult
2. Add `.addCatch(handleTimeout, { errors: ['States.Timeout'], resultPath: '$.error' })` in the "Wire the chain" section
3. This makes CDK register HandleTimeout in the graph via `bindToGraph()`

**Source:** CDK CustomState API docs confirm `.addCatch()` support. GitHub issue aws/aws-cdk#25798.

**Deploy after fix:** Delete ROLLBACK_COMPLETE stack + orphaned log groups `/aws/vendedlogs/states/dev-broker-ctrl-{orderstatemachine,healstatemachine}`, then deploy.

---

### A2. decision-workflow-ctrl — Memory namespace missing {sessionId}

**File:** `services/advisory/decision-workflow-ctrl/src/service.stack.ts`

**Problem:** BedrockAgentCore Memory strategies with `NarrativeSessionSummarizer` type require `{sessionId}` in namespace. Error: "Memory strategy NarrativeSessionSummarizer is of Summarization type requiring {sessionId} as a mandatory part of namespace"

**Fix:** Update all 4 Memory strategy namespaces to include `sessions/{sessionId}`:
- `/investor-profile/{actorId}/preferences` → `/investor-profile/{actorId}/sessions/{sessionId}/preferences`
- `/market-intelligence/{actorId}/signals` → `/market-intelligence/{actorId}/sessions/{sessionId}/signals`
- `/portfolio-engine/{actorId}/rationale` → `/portfolio-engine/{actorId}/sessions/{sessionId}/rationale`
- `/advisory-narrative/{actorId}/preferences` → `/advisory-narrative/{actorId}/sessions/{sessionId}/preferences`

**Deploy after fix:** Delete ROLLBACK_COMPLETE stack + orphaned log group, then deploy.

---

### A3. advisory-bff — Missing JS resolver files

**Files to rename:**
- `transact-confirm-decision.fn.js` → `confirm-decision.fn.js`
- `transact-reject-decision.fn.js` → `reject-decision.fn.js`
- In: `services/advisory/advisory-bff/src/graphql/js-function/`

**Why:** `discoverJsResolvers()` converts camelCase mutation `confirmDecision` → kebab-case file `confirm-decision.fn.js`. The `transact-` prefix was wrong.

---

### A4. fred-adpt — addObservability type mismatch

**File:** `services/advisory/fred-adpt/src/service.stack.ts` (lines 74-78)

**Fix:**
```typescript
// Before (wrong)
this.addObservability({ ingress: ingress.handler, egress: egress.handler, extra: [fetchTrigger] });
// After (correct)
this.addObservability({ ingress, egress, extraLambdas: [fetchTrigger] });
```

---

### A5. alpha-vantage-adpt + fred-adpt — API keys in Secrets Manager

**Files:**
- `services/advisory/alpha-vantage-adpt/src/service.stack.ts`
- `services/advisory/fred-adpt/src/service.stack.ts`

**Keys to store in Secrets Manager:**
- `nestfolio/dev-advisory/alpha-vantage-api-key` = `K6W0S73330BT8LU2`
- `nestfolio/dev-advisory/fred-api-key` = `3a2ccb587f46054c747e86a2ab89309b`

**CDK change:** Replace `StringParameter.valueForStringParameter()` with `Secret.fromSecretNameV2()` + `secret.grantRead(handler)`

---

### A6. Egress filter limit — Scalable multi-mapping approach (NEEDS VERIFICATION)

**File:** `libs/cdk-constructs/src/core/egress.ts`

**Problem:** AWS limits DynamoDB Stream event source mapping to 5 filter criteria. Current TEMPORARY fix silently drops ALL filters when >5.

**Affected services (>5 filters):**
| Service | Filter count |
|---------|-------------|
| investor-bff | 11 |
| advisory-bff | 6 |
| advisory-ctrl | 6 |
| ledger-ctrl | 6 |

**Proposed fix:** Create multiple `DynamoEventSource` on same Lambda, batching 5 filters each.

**⚠️ NEEDS VERIFICATION:**
- Can one Lambda have multiple DynamoEventSource on the SAME DynamoDB table?
- Does CDK deduplicate or reject this?
- Does CloudFormation allow multiple `AWS::Lambda::EventSourceMapping` resources on the same stream ARN?
- Are there DynamoDB Streams fan-out limits?
- What about DLQ handling — does each mapping get the same DLQ?

**Alternative approaches if batching doesn't work:**
1. Compound filters using `OR` logic within a single FilterCriteria (e.g., `__typename: [FilterRule.isEqual('A'), FilterRule.isEqual('B')]`)
2. Filter in Lambda code (current fallback — works but wastes invocations)
3. AWS quota increase request (5 → 10 filters per mapping)

---

## Part B: Deploy AgentRuntime Services (6 services)

Docker is available. Deploy:
1. `onboarding-bff` (Investor)
2. `advisory-ctrl` (Advisory)
3. `advisory-narrative-ctrl` (Advisory)
4. `market-intelligence-ctrl` (Advisory)
5. `portfolio-engine-ctrl` (Advisory)
6. `investor-profile-ctrl` (Advisory)

---

## Part C: Update Skills Documentation (prevent recurrence)

### C1. `.claude/skills/cdk-patterns/SKILL.md` — 6 updates
1. Egress filter handling (batching or limit warning)
2. Facade SSM path: `ssmServicePath` not `ssmParameterPath`
3. AgentRuntime naming rules (underscores for runtime, auto-sanitize for gateway)
4. Memory namespace: `{sessionId}` required for summarization strategies
5. addObservability: expects construct objects, not `.handler`
6. Orchestration: use `.addCatch()` not raw JSON Catch in CustomState

### C2. `.claude/skills/create-service/SKILL.md` — 1 update
- main.ts template with `observability` in destructuring and stack props

### C3. `.claude/skills/event-processor-patterns/SKILL.md` — 1 update
- Warning: CustomState `.addCatch()` required for CDK graph resolution

---

## Execution Order

1. A1-A5 — Fix CDK code bugs
2. Create Secrets Manager secrets
3. Deploy fixed services + clean up ROLLBACK_COMPLETE stacks
4. A6 — Implement Egress filter fix (after verification)
5. B — Deploy 6 AgentRuntime services
6. C — Update 3 skill files
7. Phase 4 hub re-deploy
