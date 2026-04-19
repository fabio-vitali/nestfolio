# Agent Contract Tests — Plan 3/3: Remaining services + cross-phase handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Position in series:**
1. Plan 1/3: `2026-04-19-agent-contract-tests-01-foundation.md` — **prerequisite**: library core + tsconfig aliases.
2. Plan 2/3: `2026-04-19-agent-contract-tests-02-first-rollout.md` — **prerequisite**: `advisory-narrative-ctrl` rollout + `AgentTraceTrap` class scaffold.
3. **This plan** — five remaining agent services + cross-phase verification + handoff.

**Goal of the series:** Add deterministic, process-metadata contract assertions to six agent-invoking e2e scenarios by emitting an `AgentTraceEnvelope` from `invokeOrchestrator` on every agent invocation, then asserting on the emitted events in the existing scenarios.

**Goal of THIS plan:** Instrument the remaining five agents (portfolio-engine, investor-profile, decision-lifecycle, market-intelligence, onboarding) using the pattern validated in Plan 2/3. Each service phase declares one event, wires the emitter, grants IAM, widens the `AgentTraceTrap` map, and adds a contract assertion block (or defers for onboarding). Finish with cross-phase green and MEMORY/C4 updates.

**Tech Stack:** TypeScript 5, LangChain.js, LangGraph.js, CopilotKit (onboarding only), AWS SDK v3, CDK v2, AWS AgentCore Runtime, Jest, Nx.

---

## Prerequisites

- [ ] Plan 1/3 merged to `main`.
- [ ] Plan 2/3 merged to `main`. Verify:
  - `grep -n "AgentTraceTrap\|AGENT_TRACE_EVENTS" apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` shows the class + map.
  - `pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=view-decision-explanation` passes (narrative contract assertion green on sandbox).

If either prerequisite fails, stop and land the missing plan first.

## Source of truth

- Design spec: `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`
- Project conventions: `CLAUDE.md`
- Plan 1 exports: `@nestfolio/agent-orchestrator` — `invokeOrchestrator`, `AgentTracer`, `EventBridgeTraceEmitter`, `NoopTraceEmitter`, `TraceEmitter`, `InvokeOptions`.
- Plan 2 exports: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` — `AgentTraceTrap<K>`, `AgentKey`, `AgentTraceEvent`, `WaitForOptions`.

## Scope of this plan

Five services + cross-phase wrap-up:

| Phase | Service | Scenario(s) asserted |
| --- | --- | --- |
| 4 | `portfolio-engine-ctrl` | `rebalance-on-drift.e2e.test.ts` |
| 5 | `investor-profile-ctrl` | `first-decision.e2e.test.ts` |
| 6 | `advisory-ctrl` / `decision-lifecycle` | `first-decision`, `operating-mode-authority`, `reconciliation-correction` |
| 7 | `market-intelligence-ctrl` | `first-decision.e2e.test.ts` (baseline) |
| 8 | `onboarding-bff` | deferred (no CopilotKit scenario exists) |
| 9 | Cross-phase | full-repo green, MEMORY.md, optional C4 regen, deferral log |

Each phase widens the `AgentTraceTrap` map (`apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`) by adding its service's entry.

## File structure

### Modified files in `apps/e2e-feature-tests`
- `src/helpers/agent-trace-trap.ts` — widen `AGENT_TRACE_EVENTS` per phase
- `src/advisory/rebalance-on-drift.e2e.test.ts` — portfolio-engine contract block
- `src/advisory/first-decision.e2e.test.ts` — investor-profile, decision-lifecycle, market-intelligence contract blocks
- `src/advisory/operating-mode-authority.e2e.test.ts` — decision-lifecycle contract block
- `src/advisory/reconciliation-correction.e2e.test.ts` — decision-lifecycle contract block

### Modified files in services
For each of the five services:
- `src/domain/events.ts` — add `{SERVICE}_AGENT_INVOCATION_TRACED` entry
- `agents/<agent-name>/server.ts` — build emitter, pass to `invokeOrchestrator`
- `agents/<agent-name>/graph.ts` — thread emitter (market-intelligence needs single-node StateGraph wrapper like narrative did)
- `src/service.stack.ts` — `bus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal)`
- `test/unit/service.stack.test.ts` — CDK assertion for IAM grant

Additionally for `advisory-ctrl` and `investor-profile-ctrl`: their local in-process fallback call sites (`src/services/decision-lifecycle.service.ts`, `src/agent-service.ts`) receive a `NoopTraceEmitter` explicitly.

Onboarding-bff diverges: see Phase 8.

## Testing strategy (this plan)

Same as Plan 2/3:

1. **Service CDK assertion tests**: assert the `events:PutEvents` grant on the AgentRuntime role.
2. **E2E**: existing scenarios gain assertion blocks; the trace event materialises on EB after the real deployed agent runs.

Emitter DI at each service's `graph.ts`/`server.ts` is covered by `pnpm nx typecheck` via the `InvokeOptions` discriminated union from Plan 1. No tautological `jest.mock(invokeOrchestrator)` tests.

`test-support` and `integration-testing` are NOT extended — reuse `EventBusTrap`, `TestContext`, `OrphanReaper` as-is.

## Verification commands reference

- Build/test/lint/typecheck one project: `pnpm nx {build|test|lint|typecheck} <project>`
- Affected: `pnpm nx affected -t test,build,lint`
- Deploy single service: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<svc>`
- Full-repo: `pnpm nx run-many -t test,lint,build,typecheck`
- E2E run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features`

---

# Phase 4 — `portfolio-engine-ctrl`

**Shippable outcome:** Portfolio engine emits `PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED` and `rebalance-on-drift.e2e.test.ts` asserts its contract.

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/domain/events.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts` (pass emitter options to `invokeOrchestrator`)
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts` (build emitter + pass through)
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts` (PutEvents grant if not already present)
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` (widen `AGENT_TRACE_EVENTS` to include `portfolioEngine`)
- Modify: `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` (contract block)
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts` (IAM grant assertion)

## Task 4.1 — Declare event

- [ ] **Step 1: Check current events file**

Run: `cat services/advisory/portfolio-engine-ctrl/src/domain/events.ts`

- [ ] **Step 2: Add entry**

Inside `PortfolioEngineEventTypes` (verified name — `export const PortfolioEngineEventTypes` at line 4), add:

```ts
PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED: eventName('PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED'),
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/domain/events.ts
git commit -m "feat(portfolio-engine-ctrl): declare PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED event"
```

## Task 4.2 — Wire emitter in graph + server

- [ ] **Step 1: Extend `invokePortfolioEngine` signature in `agents/portfolio-engine/graph.ts` to accept `emitter?: TraceEmitter` and thread it into the existing `invokeOrchestrator` call**

Apply this edit to `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`:

```ts
import { invokeOrchestrator, NoopTraceEmitter, type TraceEmitter } from '@nestfolio/agent-orchestrator';
// ...keep existing imports...

export async function invokePortfolioEngine(params: {
  tenantId: string;
  decisionId: string;
  input: string;
  emitter?: TraceEmitter;
}): Promise<Record<string, unknown>> {
  // ...existing setup (memory, KB, etc.) unchanged...

  const result = await invokeOrchestrator(compiledGraph, input, {
    agent: 'portfolio-engine',
    correlationId: params.decisionId,
    tenantId: params.tenantId,
    emitter: params.emitter ?? new NoopTraceEmitter(),
  });

  // ...existing result handling unchanged...
}
```

> **No graph-side DI unit test** — see rationale in Plan 2/3 Task 3.2. Typecheck covers the `{agent, correlationId, emitter}` contract via the `InvokeOptions` discriminated union; the CDK assertion test and the e2e scenario cover every behaviour that can actually regress.

- [ ] **Step 2: Typecheck the refactor**

Run: `pnpm nx typecheck portfolio-engine-ctrl`
Expected: pass.

- [ ] **Step 3: Modify `agents/portfolio-engine/server.ts`**

Replace with:

```ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { PortfolioEngineEventTypes } from '../../src/domain/events';
import { invokePortfolioEngine } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'], // may be undefined in unit-test/local contexts; emitter no-ops when absent (see Plan 1 Task 1.4)
  source: 'agent-orchestrator@portfolio-engine-ctrl',
  detailType: PortfolioEngineEventTypes.PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokePortfolioEngine({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
    emitter,
  });
  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('portfolio-engine-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 4: Run unit tests**

Run: `pnpm nx test portfolio-engine-ctrl`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts
git commit -m "feat(portfolio-engine-ctrl): emit AgentTraceEnvelope from agent runtime"
```

## Task 4.3 — Stack grant

- [ ] **Step 1: Capture the `AgentRuntime` construct into a const (if not already) and grant PutEvents**

Apply this edit to `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`:

```ts
const agentRuntime = new AgentRuntime(this, 'AgentRuntime', { /* existing props */ });
// After the AgentRuntime is constructed:
this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);
```

- [ ] **Step 2: Add CDK assertion test**

Apply to `services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts`:

```ts
import { Template, Match } from 'aws-cdk-lib/assertions';
// ...existing stack setup...

it('grants events:PutEvents on the advisory bus to the AgentRuntime role', () => {
  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'events:PutEvents', Effect: 'Allow' }),
      ]),
    },
  });
});
```

Run: `pnpm nx test portfolio-engine-ctrl -- --testPathPattern=service.stack`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/service.stack.ts services/advisory/portfolio-engine-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(portfolio-engine-ctrl): grant PutEvents on advisory bus to AgentRuntime"
```

## Task 4.4 — Widen `AgentTraceTrap` map, deploy, assert in scenario

- [ ] **Step 1: Widen `AGENT_TRACE_EVENTS` in `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`**

Apply this edit (import + new entry):

```ts
import { NarrativeEventTypes } from '@nestfolio/advisory-narrative-ctrl/events';
import { PortfolioEngineEventTypes } from '@nestfolio/portfolio-engine-ctrl/events';

const AGENT_TRACE_EVENTS = {
  advisoryNarrative: {
    bus: 'advisory' as const,
    detailType: NarrativeEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
  },
  portfolioEngine: {
    bus: 'advisory' as const,
    detailType: PortfolioEngineEventTypes.PORTFOLIO_ENGINE_AGENT_INVOCATION_TRACED,
  },
};
```

`AgentKey` widens automatically via `keyof typeof AGENT_TRACE_EVENTS`. No other code changes needed in the class.

- [ ] **Step 2: Deploy**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl`
Expected: deploy succeeds.

- [ ] **Step 3: Audit the fixture chain to locate the drift trigger**

Run: `grep -n "drift\|DRIFT\|rebalance" apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts apps/e2e-feature-tests/src/helpers/fixtures.ts`

Determine whether the portfolio-engine agent fires during a fixture (arm in `beforeEach` before `applyFixtures`) or during a mutation in the `it()` body (arm in `it()` before the mutation).

- [ ] **Step 4: Add trap arming + assertion to `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts`**

```ts
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario — rebalance on drift', () => {
  let portfolioTrap: AgentTraceTrap<'portfolioEngine'>;
  // ...existing state...

  beforeEach(async () => {
    ctx = await buildTestContext();
    tenant = await freshTenant(ctx);
    portfolioTrap = await AgentTraceTrap.arm(ctx, 'portfolioEngine');
    const result = await applyFixtures(ctx, tenant, [onboarded(), withDecision({ ... })]);
    decisionId = result.decisionId as string;
  });

  it('publishes drift and rebalances the portfolio', async () => {
    // ...existing body (publish drift, wait for rebalance, assert state)...

    const traces = await portfolioTrap.waitFor({ correlationId: decisionId });
    const envelope = traces[0].envelope;

    expect(envelope.status).toBe('success');
    expect(envelope.errors).toHaveLength(0);
    expect(envelope.toolCalls).toHaveLength(0);
    expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);

    const models = new Set(envelope.llmCalls.map((l) => l['gen_ai.request.model']));
    expect(models.has('opus') || models.has('sonnet')).toBe(true);

    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(portfolioTrap.getLatencyBudget());
  });
});
```

- [ ] **Step 5: Run scenario**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=rebalance-on-drift`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts
git commit -m "test(e2e): assert portfolio-engine contract in rebalance-on-drift scenario"
```

## Task 4.5 — Phase 4 verification

- [ ] **Step 1: Affected tests**

Run: `pnpm nx affected -t test,lint,build --base=origin/main`
Expected: green.

- [ ] **Step 2: Refresh service card**

Use the `audit-service` skill on `portfolio-engine-ctrl`, commit card if drifted.

**Phase 4 success criteria:** identical structure to Plan 2/3 Phase 3, applied to portfolio-engine.

---

# Phase 5 — `investor-profile-ctrl`

**Shippable outcome:** Investor-profile agent emits `INVESTOR_PROFILE_AGENT_INVOCATION_TRACED`. `first-decision.e2e.test.ts` asserts its contract (the investor-profile agent is invoked as a sub-step of decision finalisation in that scenario).

> **Scenario identification (resolved, not deferred).** Running `grep -rln "investor-profile\|INVESTOR_PROFILE" apps/e2e-feature-tests/src/` on 2026-04-19 returned only `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`. That scenario already exercises the first advisory decision post-onboarding and transitively invokes the investor-profile agent. The correlationId published by the investor-profile agent will be the parent `decisionId` (verify at implementation time — grep the service for how `correlationId` is set on the outbound `InvokeOptions`).

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/domain/events.ts` — add `INVESTOR_PROFILE_AGENT_INVOCATION_TRACED`
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts` — pass emitter to `invokeOrchestrator`
- Modify: `services/advisory/investor-profile-ctrl/src/agent-service.ts` — pass `NoopTraceEmitter` to the local in-process fallback (traces from local fallback are irrelevant in sandbox/prod)
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts` — build EventBridge emitter
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts` — `events:PutEvents` grant
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` — add `investorProfile` entry
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` — arm `investorProfile` trap + assert
- Modify: `services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts` — IAM grant assertion

## Task 5.1 — Declare event

- [ ] **Step 1:** Inside `export const InvestorProfileEventTypes` at `services/advisory/investor-profile-ctrl/src/domain/events.ts:4`, add:

```ts
INVESTOR_PROFILE_AGENT_INVOCATION_TRACED: eventName('INVESTOR_PROFILE_AGENT_INVOCATION_TRACED'),
```

- [ ] **Step 2:** Commit.

```bash
git add services/advisory/investor-profile-ctrl/src/domain/events.ts
git commit -m "feat(investor-profile-ctrl): declare INVESTOR_PROFILE_AGENT_INVOCATION_TRACED event"
```

## Task 5.2 — Thread emitter through graph.ts and agent-service.ts

- [ ] **Step 1: Modify `agents/investor-profile/graph.ts:83`** — replace the existing `invokeOrchestrator(...)` call site options with:

```ts
import { invokeOrchestrator, NoopTraceEmitter, type TraceEmitter } from '@nestfolio/agent-orchestrator';

export async function invokeInvestorProfile(params: {
  tenantId: string;
  decisionId: string;
  input: string;
  emitter?: TraceEmitter;
}): Promise<Record<string, unknown>> {
  // ...existing setup unchanged...

  const result = await invokeOrchestrator(compiledGraph, input, {
    agent: 'investor-profile',
    correlationId: params.decisionId,
    tenantId: params.tenantId,
    emitter: params.emitter ?? new NoopTraceEmitter(),
  });
  // ...existing result handling...
}
```

- [ ] **Step 2: Modify `src/agent-service.ts:53`** — the local in-process fallback. Since `resolveAgentRuntimeUrl()` short-circuits to the remote runtime in sandbox/prod, this path is effectively dead code in deployed environments; pass `NoopTraceEmitter` explicitly for clarity:

```ts
import { invokeOrchestrator, NoopTraceEmitter } from '@nestfolio/agent-orchestrator';

// At the call site (around line 53):
const result = await invokeOrchestrator(compiledGraph, input, {
  agent: 'investor-profile',
  correlationId: params.decisionId,
  tenantId: params.tenantId,
  emitter: new NoopTraceEmitter(),
});
```

> **No graph-side DI unit test** — see rationale in Plan 2/3 Task 3.2. Typecheck + CDK assertion + e2e cover the contract without a tautological mock.

- [ ] **Step 3: Typecheck the refactor**

Run: `pnpm nx typecheck investor-profile-ctrl`
Expected: pass.

- [ ] **Step 4: Modify `agents/investor-profile/server.ts`** — build the EventBridge emitter and pass it through:

```ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { InvestorProfileEventTypes } from '../../src/domain/events';
import { invokeInvestorProfile } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@investor-profile-ctrl',
  detailType: InvestorProfileEventTypes.INVESTOR_PROFILE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokeInvestorProfile({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
    emitter,
  });
  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('investor-profile-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 5: Build and commit**

Run: `pnpm nx build investor-profile-ctrl`
Expected: PASS.

```bash
git add services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts services/advisory/investor-profile-ctrl/src/agent-service.ts services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts
git commit -m "feat(investor-profile-ctrl): emit AgentTraceEnvelope from agent runtime"
```

## Task 5.3 — Stack grant

- [ ] **Step 1:** In `services/advisory/investor-profile-ctrl/src/service.stack.ts`, after the `AgentRuntime` construct is instantiated (capture into `const agentRuntime = new AgentRuntime(...)` if it is not already), add:

```ts
this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);
```

- [ ] **Step 2: Add CDK assertion test**

Apply to `services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts`:

```ts
import { Template, Match } from 'aws-cdk-lib/assertions';
// ...existing stack setup...

it('grants events:PutEvents on the advisory bus to the AgentRuntime role', () => {
  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'events:PutEvents', Effect: 'Allow' }),
      ]),
    },
  });
});
```

Run: `pnpm nx test investor-profile-ctrl -- --testPathPattern=service.stack`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/investor-profile-ctrl/src/service.stack.ts services/advisory/investor-profile-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(investor-profile-ctrl): grant PutEvents on advisory bus to AgentRuntime"
```

## Task 5.4 — Widen `AgentTraceTrap` map, deploy, assert in `first-decision`

- [ ] **Step 1: Widen `AGENT_TRACE_EVENTS` in `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`**

Apply:

```ts
import { InvestorProfileEventTypes } from '@nestfolio/investor-profile-ctrl/events';

// inside AGENT_TRACE_EVENTS (add entry):
investorProfile: {
  bus: 'advisory' as const,
  detailType: InvestorProfileEventTypes.INVESTOR_PROFILE_AGENT_INVOCATION_TRACED,
},
```

- [ ] **Step 2: Deploy**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl`
Expected: deploy succeeds.

- [ ] **Step 3: Add trap arming + assertion to `first-decision.e2e.test.ts`**

The decision-lifecycle trap will also be armed here in Phase 6; for now, add only the `investor-profile` trap:

```ts
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario 11 — investor sees first advisory decision after onboarding', () => {
  let investorProfileTrap: AgentTraceTrap<'investorProfile'>;
  // ...existing state...

  beforeEach(async () => {
    ctx = await buildTestContext();
    tenant = await freshTenant(ctx);
    // ARM BEFORE applyFixtures — the investor-profile agent runs during onboarding/decision bootstrap.
    investorProfileTrap = await AgentTraceTrap.arm(ctx, 'investorProfile');
    const result = await applyFixtures(ctx, tenant, [onboarded(), withDecision({ ... })]);
    decisionId = result.decisionId as string;
  });

  it('...', async () => {
    // ...existing body...

    const traces = await investorProfileTrap.waitFor({ correlationId: decisionId });
    const envelope = traces[0].envelope;

    expect(envelope.status).toBe('success');
    expect(envelope.errors).toHaveLength(0);
    expect(envelope.toolCalls).toHaveLength(0);

    const nodes = new Set(envelope.nodeSequence.map((n) => n.nodeName));
    expect(nodes.size).toBeGreaterThanOrEqual(2); // RAG fan-out has at least 2 nodes

    expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);
    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(investorProfileTrap.getLatencyBudget());
  });
});
```

> **If `correlationId` is NOT `decisionId` at implementation time:** grep the investor-profile service for the `correlationId` value it passes to `invokeOrchestrator` (currently threaded from `params.decisionId` per Task 5.2). If investor-profile is triggered by a non-decision event (e.g. `ONBOARDING_COMPLETED`), the correlationId will be that event's id — capture it from the fixture result instead of `decisionId`.

- [ ] **Step 4: Run the scenario**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=first-decision`
Expected: PASS. If the trap times out, `AgentTraceTrap.waitFor`'s error message will point to arm-before-trigger ordering.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts
git commit -m "test(e2e): assert investor-profile contract in first-decision scenario"
```

## Task 5.5 — Phase 5 verification

- [ ] **Step 1: Affected tests**

Run: `pnpm nx affected -t test,lint,build --base=origin/main`
Expected: all pass.

- [ ] **Step 2: Refresh service card**

Invoke the `audit-service` skill for `investor-profile-ctrl`; commit card if drifted.

**Phase 5 success criteria:**
- Event declared, emitted, subscribed.
- Helper map contains `investorProfile`.
- `first-decision.e2e.test.ts` asserts investor-profile contract and passes on sandbox.

---

# Phase 6 — `advisory-ctrl` / `decision-lifecycle` (highest-complexity rollout)

**Shippable outcome:** Decision-lifecycle agent emits `DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED`. Three scenarios assert the decision-lifecycle contract: `first-decision`, `operating-mode-authority`, `reconciliation-correction`.

**Files:**
- Modify: `services/advisory/advisory-ctrl/src/domain/events.ts` — add `DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED`
- Modify: `services/advisory/advisory-ctrl/agents/decision-lifecycle/graph.ts` — pass emitter to `invokeOrchestrator`
- Modify: `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts` — local in-process fallback: pass `NoopTraceEmitter`
- Modify: `services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts` — build emitter
- Modify: `services/advisory/advisory-ctrl/src/service.stack.ts` — `events:PutEvents` grant on the AgentRuntime role
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` — add `decisionLifecycle`
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts`
- Modify: `services/advisory/advisory-ctrl/test/unit/service.stack.test.ts` — IAM grant assertion

## Task 6.1 — Declare event

- [ ] **Step 1:** Inside `export const AdvisoryCtrlEventTypes` in `services/advisory/advisory-ctrl/src/domain/events.ts`, add:

```ts
DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED: eventName('DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED'),
```

- [ ] **Step 2:** Commit.

```bash
git add services/advisory/advisory-ctrl/src/domain/events.ts
git commit -m "feat(advisory-ctrl): declare DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED event"
```

## Task 6.2 — Wire emitter

- [ ] **Step 1: Modify `agents/decision-lifecycle/graph.ts` (around line 53)** — thread emitter into `invokeOrchestrator`:

```ts
import { invokeOrchestrator, NoopTraceEmitter, type TraceEmitter } from '@nestfolio/agent-orchestrator';

export async function invokeDecisionLifecycle(params: {
  tenantId: string;
  decisionId: string;
  input: string;
  emitter?: TraceEmitter;
}): Promise<Record<string, unknown>> {
  // ...existing setup unchanged (memory, KB, tool bindings, etc.)...

  const result = await invokeOrchestrator(compiledGraph, input, {
    agent: 'decision-lifecycle',
    correlationId: params.decisionId,
    tenantId: params.tenantId,
    emitter: params.emitter ?? new NoopTraceEmitter(),
  });

  // ...existing result handling...
}
```

- [ ] **Step 2: Modify `src/services/decision-lifecycle.service.ts` (around line 111)** — the local fallback runs only when `AGENT_RUNTIME_URL_PARAM` is unset; in sandbox/prod it never fires. Pass `NoopTraceEmitter` explicitly so callers don't get accidental emissions from a non-runtime code path:

```ts
import { invokeOrchestrator, NoopTraceEmitter } from '@nestfolio/agent-orchestrator';

const result = await invokeOrchestrator(compiledGraph, input, {
  agent: 'decision-lifecycle',
  correlationId: params.decisionId,
  tenantId: params.tenantId,
  emitter: new NoopTraceEmitter(),
});
```

- [ ] **Step 3: Modify `agents/decision-lifecycle/server.ts`** — build the EventBridge emitter:

```ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { AdvisoryCtrlEventTypes } from '../../src/domain/events';
import { invokeDecisionLifecycle } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@advisory-ctrl',
  detailType: AdvisoryCtrlEventTypes.DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokeDecisionLifecycle({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
    emitter,
  });
  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('advisory-ctrl decision-lifecycle agent runtime listening on 0.0.0.0:8080');
```

> **No graph-side DI unit test** — see rationale in Plan 2/3 Task 3.2. Decision-lifecycle's four-tool, full-tier orchestration is fully exercised by three e2e scenarios (first-decision, operating-mode-authority, reconciliation-correction) in Task 6.4, which catch real regressions that a mock-only test cannot.

- [ ] **Step 4: Typecheck the refactor**

Run: `pnpm nx typecheck advisory-ctrl`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-ctrl/agents/decision-lifecycle/graph.ts services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts
git commit -m "feat(advisory-ctrl): emit AgentTraceEnvelope from decision-lifecycle agent runtime"
```

## Task 6.3 — Stack grant

- [ ] **Step 1: Audit existing IAM**

Run: `grep -n "events:PutEvents\|grantPutEventsTo" services/advisory/advisory-ctrl/src/service.stack.ts`

The stack already has a `PolicyStatement` with `events:PutEvents` around line 128–135. Verify which principal it attaches to: if it targets a tool-publisher Lambda (not the AgentRuntime role), we need a separate grant for the runtime.

- [ ] **Step 2: Add the AgentRuntime grant**

Capture the construct if it is not already, then add:

```ts
const agentRuntime = new AgentRuntime(this, 'AgentRuntime', { /* existing props */ });
this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);
```

- [ ] **Step 3: CDK assertion test**

Apply to `services/advisory/advisory-ctrl/test/unit/service.stack.test.ts`. Use `Match.arrayWith` on the policy statements so the new grant is additive to the existing tool-publisher policy (don't assert exclusivity):

```ts
import { Template, Match } from 'aws-cdk-lib/assertions';

it('grants events:PutEvents to the AgentRuntime role (in addition to any pre-existing tool-publisher grants)', () => {
  const template = Template.fromStack(stack);
  // Count the number of IAM policies that grant events:PutEvents — should be >= 2 after this change
  // (one for the tool-publisher Lambda, one for the AgentRuntime).
  const policies = Object.values(template.findResources('AWS::IAM::Policy'));
  const policiesWithPutEvents = policies.filter((p) =>
    (p.Properties?.PolicyDocument?.Statement ?? []).some(
      (s: Record<string, unknown>) => s['Action'] === 'events:PutEvents' && s['Effect'] === 'Allow',
    ),
  );
  expect(policiesWithPutEvents.length).toBeGreaterThanOrEqual(2);
});
```

Run: `pnpm nx test advisory-ctrl -- --testPathPattern=service.stack`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-ctrl/src/service.stack.ts services/advisory/advisory-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(advisory-ctrl): grant PutEvents on advisory bus to decision-lifecycle AgentRuntime"
```

## Task 6.4 — Widen helper + three scenario assertions

- [ ] **Step 1: Widen `AGENT_TRACE_EVENTS` in `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`**

```ts
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';

// inside AGENT_TRACE_EVENTS:
decisionLifecycle: {
  bus: 'advisory' as const,
  detailType: AdvisoryCtrlEventTypes.DECISION_LIFECYCLE_AGENT_INVOCATION_TRACED,
},
```

- [ ] **Step 2: Deploy advisory-ctrl**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-ctrl`

- [ ] **Step 3: Extend `first-decision.e2e.test.ts` — add decisionLifecycle trap alongside the investor-profile trap from Phase 5**

```ts
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario 11 — ...', () => {
  let investorProfileTrap: AgentTraceTrap<'investorProfile'>;
  let decisionLifecycleTrap: AgentTraceTrap<'decisionLifecycle'>;

  beforeEach(async () => {
    ctx = await buildTestContext();
    tenant = await freshTenant(ctx);
    investorProfileTrap = await AgentTraceTrap.arm(ctx, 'investorProfile');
    decisionLifecycleTrap = await AgentTraceTrap.arm(ctx, 'decisionLifecycle');
    const result = await applyFixtures(ctx, tenant, [onboarded(), withDecision({ ... })]);
    decisionId = result.decisionId as string;
  });

  it('...', async () => {
    // ...existing body and investor-profile assertion from Phase 5...

    // decision-lifecycle contract
    const dlTraces = await decisionLifecycleTrap.waitFor({ correlationId: decisionId });
    const envelope = dlTraces[0].envelope;

    expect(envelope.status).toBe('success');
    expect(envelope.errors).toHaveLength(0);

    const nodes = new Set(envelope.nodeSequence.map((n) => n.nodeName));
    expect(nodes.has('userGoals') || nodes.has('goalExtraction')).toBe(true);
    expect(nodes.has('portfolioConstruction') || nodes.has('construction')).toBe(true);

    const toolsCalled = new Set(envelope.toolCalls.map((c) => c.toolName));
    expect(toolsCalled.has('portfolio-lookup')).toBe(true);
    expect(toolsCalled.has('market-data')).toBe(true);
    expect(envelope.toolCalls.every((c) => c.status === 'success')).toBe(true);

    for (const call of envelope.llmCalls.filter((l) => l.escalatedFromTier)) {
      expect(['haiku', 'sonnet', 'opus']).toContain(call.escalatedFromTier);
    }

    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(decisionLifecycleTrap.getLatencyBudget());
  });
});
```

- [ ] **Step 4: Add decisionLifecycle trap + assertion to `operating-mode-authority.e2e.test.ts`**

```ts
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario — operating mode authority', () => {
  let decisionLifecycleTrap: AgentTraceTrap<'decisionLifecycle'>;

  beforeEach(async () => {
    ctx = await buildTestContext();
    tenant = await freshTenant(ctx);
    decisionLifecycleTrap = await AgentTraceTrap.arm(ctx, 'decisionLifecycle');
    const result = await applyFixtures(ctx, tenant, [onboarded(), withDecision({ ... })]);
    decisionId = result.decisionId as string;
  });

  it('...', async () => {
    // ...existing body...

    const traces = await decisionLifecycleTrap.waitFor({ correlationId: decisionId });
    const envelope = traces[0].envelope;

    expect(envelope.status).toBe('success');
    expect(envelope.errors).toHaveLength(0);

    // operating-mode scenarios may exercise a subset of nodes — keep this assertion loose
    expect(envelope.nodeSequence.length).toBeGreaterThanOrEqual(1);
    expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);

    // Tools: operating-mode decisions exercise at least portfolio-lookup; market-data may be optional
    const toolsCalled = new Set(envelope.toolCalls.map((c) => c.toolName));
    expect(toolsCalled.size).toBeGreaterThanOrEqual(1);
    expect(envelope.toolCalls.every((c) => c.status === 'success')).toBe(true);

    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(decisionLifecycleTrap.getLatencyBudget());
  });
});
```

- [ ] **Step 5: Add decisionLifecycle trap + assertion to `reconciliation-correction.e2e.test.ts`**

```ts
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario — reconciliation correction', () => {
  let decisionLifecycleTrap: AgentTraceTrap<'decisionLifecycle'>;

  beforeEach(async () => {
    ctx = await buildTestContext();
    tenant = await freshTenant(ctx);
    decisionLifecycleTrap = await AgentTraceTrap.arm(ctx, 'decisionLifecycle');
    const result = await applyFixtures(ctx, tenant, [onboarded(), withDecision({ ... })]);
    decisionId = result.decisionId as string;
  });

  it('...', async () => {
    // ...existing body...

    const traces = await decisionLifecycleTrap.waitFor({ correlationId: decisionId });
    const envelope = traces[0].envelope;

    expect(envelope.status).toBe('success');
    expect(envelope.errors).toHaveLength(0);

    // Reconciliation-correction may skip portfolio-lookup — do not require it
    const toolsCalled = new Set(envelope.toolCalls.map((c) => c.toolName));
    expect(toolsCalled.size).toBeGreaterThanOrEqual(1);
    expect(envelope.toolCalls.every((c) => c.status === 'success')).toBe(true);

    expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);
    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(decisionLifecycleTrap.getLatencyBudget());
  });
});
```

- [ ] **Step 6: Run all three scenarios**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern='first-decision|operating-mode-authority|reconciliation-correction'`
Expected: all three pass.

- [ ] **Step 7: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts
git commit -m "test(e2e): assert decision-lifecycle contract across three advisory scenarios"
```

## Task 6.5 — Phase 6 verification

- [ ] **Step 1:** Run `pnpm nx affected -t test,lint,build --base=origin/main` — expect green.
- [ ] **Step 2:** Invoke `audit-service` for `advisory-ctrl`; commit card if drifted.

**Phase 6 success criteria:**
- Three scenarios asserting decision-lifecycle contract are green.
- Tool-call/node-sequence assertions are sized to each scenario's actual topology (loose enough to survive prompt reshuffles, tight enough to catch "0 tools called" or "0 LLM calls" regressions).

---

# Phase 7 — `market-intelligence-ctrl`

**Shippable outcome:** Market-intelligence agent emits `MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED`. `first-decision.e2e.test.ts` asserts the baseline contract (market-intelligence is invoked as a sub-step of decision analysis).

> **Scenario identification (resolved).** Market-intelligence runs as a sub-step of decision-lifecycle during first-decision. Same scenario file as Phases 5 and 6 (`first-decision.e2e.test.ts`). Three traps — `investorProfile`, `decisionLifecycle`, `marketIntelligence` — are armed in `beforeEach`, each asserted in the `it()` body. correlationId expected = `decisionId` for all three (verify at implementation time via grep of market-intelligence's `correlationId` parameter).

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/domain/events.ts`
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts` (wrap `agentNode` in single-node StateGraph → route through `invokeOrchestrator`)
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts`

## Task 7.1 — Declare event

- [ ] **Step 1:** Inside `export const MarketIntelligenceEventTypes` in `services/advisory/market-intelligence-ctrl/src/domain/events.ts`, add:

```ts
MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED: eventName('MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED'),
```

- [ ] **Step 2:** Commit.

```bash
git add services/advisory/market-intelligence-ctrl/src/domain/events.ts
git commit -m "feat(market-intelligence-ctrl): declare MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED event"
```

## Task 7.2 — Refactor graph.ts through `invokeOrchestrator`

Market-intelligence currently invokes `agentNode({input})` directly, bypassing `invokeOrchestrator`. To attach the tracer, wrap it in a single-node `StateGraph` and invoke via `invokeOrchestrator` — identical pattern to Plan 2/3 Task 3.2 (narrative).

- [ ] **Step 1: Apply this edit to `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`**

```ts
import { Annotation, StateGraph } from '@langchain/langgraph';
import { invokeOrchestrator, NoopTraceEmitter, type TraceEmitter } from '@nestfolio/agent-orchestrator';
// keep existing imports (buildMemoryClient, createAgentNode, etc.)

const MarketIntelState = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<Record<string, unknown>>,
});

function buildGraph() {
  const builder = new StateGraph(MarketIntelState);
  builder.addNode('market-intelligence', async (state) => {
    const result = await agentNode({ input: state.input });
    return { output: result as Record<string, unknown> };
  });
  builder.addEdge('__start__', 'market-intelligence');
  builder.addEdge('market-intelligence', '__end__');
  return builder.compile();
}

const compiledGraph = buildGraph();

export async function invokeMarketIntelligence(params: {
  tenantId: string;
  decisionId: string;
  input: string;
  emitter?: TraceEmitter;
}): Promise<Record<string, unknown>> {
  // ...existing KB/memory bootstrap unchanged...

  const result = await invokeOrchestrator(compiledGraph, { input: enrichedInput }, {
    agent: 'market-intelligence',
    correlationId: params.decisionId,
    tenantId: params.tenantId,
    emitter: params.emitter ?? new NoopTraceEmitter(),
  });

  if ('serviceUnavailable' in result) throw new Error(`Market-intelligence unavailable: ${result.reason}`);
  const output = (result as { output?: Record<string, unknown> }).output ?? {};
  // ...existing memory writeback unchanged...
  return output;
}
```

> **No graph-side DI unit test** — see rationale in Plan 2/3 Task 3.2. Covered by typecheck + e2e in Task 7.4.

- [ ] **Step 2: Typecheck the refactor**

Run: `pnpm nx typecheck market-intelligence-ctrl`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts
git commit -m "refactor(market-intelligence-ctrl): route agent through invokeOrchestrator"
```

## Task 7.3 — Wire server and stack grant

- [ ] **Step 1: Modify `agents/market-intelligence/server.ts`**

```ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { MarketIntelligenceEventTypes } from '../../src/domain/events';
import { invokeMarketIntelligence } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@market-intelligence-ctrl',
  detailType: MarketIntelligenceEventTypes.MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokeMarketIntelligence({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
    emitter,
  });
  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('market-intelligence-ctrl agent runtime listening on 0.0.0.0:8080');
```

Run: `pnpm nx build market-intelligence-ctrl`
Expected: PASS.

- [ ] **Step 2: Stack grant**

In `services/advisory/market-intelligence-ctrl/src/service.stack.ts`, after the `AgentRuntime` construct (capture into `const agentRuntime` if not already):

```ts
this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);
```

- [ ] **Step 3: CDK assertion test**

Apply to `services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts`:

```ts
import { Template, Match } from 'aws-cdk-lib/assertions';

it('grants events:PutEvents on the advisory bus to the AgentRuntime role', () => {
  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'events:PutEvents', Effect: 'Allow' }),
      ]),
    },
  });
});
```

Run: `pnpm nx test market-intelligence-ctrl -- --testPathPattern=service.stack`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts services/advisory/market-intelligence-ctrl/src/service.stack.ts services/advisory/market-intelligence-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(market-intelligence-ctrl): emit trace envelope + grant PutEvents to AgentRuntime"
```

## Task 7.4 — Widen helper and assert in `first-decision`

- [ ] **Step 1: Widen `AGENT_TRACE_EVENTS` in `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`**

```ts
import { MarketIntelligenceEventTypes } from '@nestfolio/market-intelligence-ctrl/events';

// inside AGENT_TRACE_EVENTS:
marketIntelligence: {
  bus: 'advisory' as const,
  detailType: MarketIntelligenceEventTypes.MARKET_INTELLIGENCE_AGENT_INVOCATION_TRACED,
},
```

- [ ] **Step 2: Deploy**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=market-intelligence-ctrl`
Expected: deploy succeeds.

- [ ] **Step 3: Extend `first-decision.e2e.test.ts` to arm the third trap and assert market-intelligence contract**

```ts
describe('scenario 11 — ...', () => {
  let investorProfileTrap: AgentTraceTrap<'investorProfile'>;
  let decisionLifecycleTrap: AgentTraceTrap<'decisionLifecycle'>;
  let marketIntelligenceTrap: AgentTraceTrap<'marketIntelligence'>;

  beforeEach(async () => {
    ctx = await buildTestContext();
    tenant = await freshTenant(ctx);
    investorProfileTrap = await AgentTraceTrap.arm(ctx, 'investorProfile');
    decisionLifecycleTrap = await AgentTraceTrap.arm(ctx, 'decisionLifecycle');
    marketIntelligenceTrap = await AgentTraceTrap.arm(ctx, 'marketIntelligence');
    const result = await applyFixtures(ctx, tenant, [onboarded(), withDecision({ ... })]);
    decisionId = result.decisionId as string;
  });

  it('...', async () => {
    // ...existing body + investor-profile + decision-lifecycle assertions...

    // market-intelligence baseline contract
    const miTraces = await marketIntelligenceTrap.waitFor({ correlationId: decisionId });
    const miEnvelope = miTraces[0].envelope;

    expect(miEnvelope.status).toBe('success');
    expect(miEnvelope.errors).toHaveLength(0);
    expect(miEnvelope.llmCalls.length).toBeGreaterThanOrEqual(1);
    expect(miEnvelope['gen_ai.invocation.latency_ms']).toBeLessThan(marketIntelligenceTrap.getLatencyBudget());
  });
});
```

- [ ] **Step 4: Run the scenario**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=first-decision`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts
git commit -m "test(e2e): assert market-intelligence contract in first-decision scenario"
```

## Task 7.5 — Phase 7 verification

- [ ] **Step 1:** `pnpm nx affected -t test,lint,build --base=origin/main` — green.
- [ ] **Step 2:** `audit-service` on `market-intelligence-ctrl`; commit card if drifted.

**Phase 7 success criteria:** market-intelligence emits + `first-decision` asserts baseline contract (1+ LLM call, no errors, under latency budget).

---

# Phase 8 — `onboarding-bff` (last; investor bus; CopilotKit seam)

**Shippable outcome:** Onboarding agent emits `ONBOARDING_AGENT_INVOCATION_TRACED` per turn on the investor bus. The infrastructure is complete (event declared, emitter wired, IAM granted, helper widened). An **e2e assertion scenario is explicitly deferred** to a follow-up plan because no existing e2e scenario drives CopilotKit turns — see Task 8.5.

> **Scenario identification (explicit deferral).** Running `grep -rln "onboard\|copilotkit" apps/e2e-feature-tests/src/` on 2026-04-19 returns zero matches. No current e2e scenario drives CopilotRuntime. Adding a CopilotKit-driving scenario is substantial scope (session state, multi-turn messaging, server-sent events) that does not belong in this plan. Phase 8 therefore lands all infrastructure but does NOT add an assertion block. Phase 9.5 records the deferral as a follow-up item.

**Complication acknowledged in spec:** onboarding routes through CopilotRuntime + LangGraphAgent adapter, NOT through `invokeOrchestrator`. The plan below uses a localised seam that preserves the spec's "emission is a first-class domain event" commitment while fitting CopilotKit.

**Files:**
- Modify: `services/investor/onboarding-bff/src/domain/events.ts`
- Modify: `services/investor/onboarding-bff/agents/onboarding/server.ts`
- Modify: `services/investor/onboarding-bff/agents/onboarding/graph.ts` (attach `AgentTracer` via `graph.withConfig({callbacks})` at compile time)
- Modify: `services/investor/onboarding-bff/src/service.stack.ts` (`events:PutEvents` grant)
- Modify: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` (widen `AGENT_TRACE_EVENTS` with the `onboarding` entry on the investor bus)

## Task 8.1 — Declare event on the onboarding-bff domain/events.ts

> **Note:** `services/investor/onboarding-bff/src/domain/events.ts` currently exports only naked constants (`ONBOARDING_STARTED`, `ONBOARDING_COMPLETED`, `GO_LIVE_CONFIRMED`) — there is no pre-existing `OnboardingBffEventTypes` grouped const. This task ADDS that const (additive; existing naked exports remain untouched to avoid breaking existing callers).

- [ ] **Step 1:** Append to `services/investor/onboarding-bff/src/domain/events.ts`:

```ts
export const OnboardingBffEventTypes = {
  ONBOARDING_AGENT_INVOCATION_TRACED: eventName('ONBOARDING_AGENT_INVOCATION_TRACED'),
} as const;
```

- [ ] **Step 2:** Commit.

## Task 8.2 — Add tracer + emitter seam in `server.ts` + `graph.ts`

The design challenge: CopilotRuntime invokes `graph.invoke` internally via the `LangGraphAgent` adapter. We need (a) the tracer attached as a callback, and (b) emission after each turn.

**Approach:** create a fresh `AgentTracer` + `EventBridgeTraceEmitter` per HTTP request. Attach tracer via `graph.withConfig({ callbacks: [tracer] })` before handing the graph to `LangGraphAgent`. After `runtime.process(...)` resolves, emit. Errors from the adapter go through status='error'.

- [ ] **Step 1: Modify `buildOnboardingGraph` in `agents/onboarding/graph.ts`** to accept an optional `tracer: BaseCallbackHandler` and, if present, call `graph.withConfig({ callbacks: [tracer] })` on the compiled graph before returning. Example:

```ts
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';

export function buildOnboardingGraph(
  deps: { repo: OnboardingRepository },
  opts?: { tracer?: BaseCallbackHandler },
) {
  // ... existing graph construction unchanged ...
  const compiled = graph.compile();
  return opts?.tracer ? compiled.withConfig({ callbacks: [opts.tracer] }) : compiled;
}
```

- [ ] **Step 2: Modify `agents/onboarding/server.ts`** to instantiate tracer + emitter per request and emit after `runtime.process()`:

```ts
import { AgentTracer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { OnboardingBffEventTypes } from '../../src/domain/events';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'], // may be undefined in unit-test/local contexts; emitter no-ops when absent (see Plan 1 Task 1.4)
  source: 'agent-orchestrator@onboarding-bff',
  detailType: OnboardingBffEventTypes.ONBOARDING_AGENT_INVOCATION_TRACED,
});

// inside /copilotkit handler:
app.post('/copilotkit', async (c) => {
  const tableName = process.env['TABLE_NAME'] ?? '';
  const repo = new OnboardingRepository(tableName);
  const tenantId = c.req.header('x-tenant-id') ?? '';
  const sessionId = c.req.header('x-session-id') ?? c.req.header('x-user-id') ?? '';

  const tracer = new AgentTracer();
  const graph = buildOnboardingGraph({ repo }, { tracer });

  const runtime = new CopilotRuntime();
  const adapter = new LangGraphAgent({ graph });

  let status: 'success' | 'error' = 'success';
  try {
    return await runtime.process(c.req.raw, adapter);
  } catch (err) {
    status = 'error';
    throw err;
  } finally {
    if (sessionId && tenantId) {
      emitter
        .emit(tracer.build(status), { tenantId, correlationId: sessionId, agent: 'onboarding' })
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('onboarding trace emit failed', e);
        });
    }
  }
});
```

> This seam IS a deviation from "emission lives in invokeOrchestrator" for the specific case of CopilotKit. It is acceptable because (a) onboarding does not call invokeOrchestrator at all, (b) the tracer still attaches via LangChain callbacks, (c) emission is still gated on `correlationId`/`tenantId` presence, and (d) failures are isolated to a `.catch` warning. Document this deviation in the onboarding-bff service card (Task 8.6).

> **No server-wiring unit test.** Stubbing `CopilotRuntime.process` and asserting `emitter.emit` was called with specific arguments would tautologically verify the code you just wrote. The custom CopilotKit seam is documented as a known deviation and will get real coverage when the onboarding e2e scenario lands (Phase 9.5 deferral). Until then, typecheck + CDK assertion (Task 8.3) + manual smoke test on first deploy are the safety net.

- [ ] **Step 3: Typecheck**

Run: `pnpm nx typecheck onboarding-bff`
Expected: pass.

- [ ] **Step 4: Commit.**

## Task 8.3 — Stack grant

- [ ] **Step 1:** In `services/investor/onboarding-bff/src/service.stack.ts`, after the `AgentRuntime` construct, add:

```ts
this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);
```

> Note: `this.eventBus` here refers to the **investor** bus (onboarding-bff lives in the investor domain). This is the only service in the plan whose emitter targets the investor bus, not advisory.

- [ ] **Step 2: CDK assertion test**

Apply to `services/investor/onboarding-bff/test/unit/service.stack.test.ts`:

```ts
import { Template, Match } from 'aws-cdk-lib/assertions';

it('grants events:PutEvents on the investor bus to the AgentRuntime role', () => {
  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({ Action: 'events:PutEvents', Effect: 'Allow' }),
      ]),
    },
  });
});
```

Run: `pnpm nx test onboarding-bff -- --testPathPattern=service.stack`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add services/investor/onboarding-bff/src/service.stack.ts services/investor/onboarding-bff/test/unit/service.stack.test.ts
git commit -m "feat(onboarding-bff): grant PutEvents on investor bus to AgentRuntime"
```

## Task 8.4 — Widen helper

- [ ] **Step 1: Widen `AGENT_TRACE_EVENTS` in `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` — note the `investor` bus**

```ts
import { OnboardingBffEventTypes } from '@nestfolio/onboarding-bff/events';

// inside AGENT_TRACE_EVENTS:
onboarding: {
  bus: 'investor' as const,  // INVESTOR bus, not advisory
  detailType: OnboardingBffEventTypes.ONBOARDING_AGENT_INVOCATION_TRACED,
},
```

- [ ] **Step 2: Typecheck**

Run: `pnpm nx typecheck e2e-feature-tests`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts
git commit -m "feat(e2e): widen AgentTraceTrap map with onboarding (investor bus)"
```

## Task 8.5 — Deferred: no CopilotKit scenario exists

**Status: intentionally deferred.** No existing e2e scenario drives CopilotRuntime turns (confirmed by grep on 2026-04-19). Adding one requires building a CopilotKit session harness — session management, multi-turn message exchange over SSE, CORS/auth headers — which is out-of-scope for this plan.

**Follow-up tracked in Phase 9.5:** a new plan (`2026-XX-XX-onboarding-e2e-scenario.md`) will add the scenario and the multi-turn assertion block that would live here. When that plan lands, the assertion code will look like:

```ts
// REFERENCE ONLY — DO NOT COMMIT UNTIL FOLLOW-UP PLAN
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario — onboarding CopilotKit multi-turn', () => {
  let onboardingTrap: AgentTraceTrap<'onboarding'>;

  beforeEach(async () => {
    ctx = await buildTestContext();
    tenant = await freshTenant(ctx);
    onboardingTrap = await AgentTraceTrap.arm(ctx, 'onboarding');
    // NEW: copilotkit session harness to send multi-turn messages
  });

  it('...', async () => {
    // ...drive N turns via CopilotKit...

    const traces = await onboardingTrap.waitFor({ correlationId: onboardingSessionId, minCount: 1 });
    const final = traces[traces.length - 1].envelope;

    expect(final.status).toBe('success');
    expect(final.errors).toHaveLength(0);
    const toolNames = new Set(traces.flatMap((t) => t.envelope.toolCalls.map((c) => c.toolName)));
    expect(toolNames.size).toBeGreaterThanOrEqual(1);
    expect(final.nodeSequence.length).toBeGreaterThanOrEqual(1);
    for (const trace of traces) {
      for (const call of trace.envelope.llmCalls) {
        expect(call['gen_ai.request.model']).toBe('sonnet');
      }
    }
  });
});
```

Action for this plan: **none.** Move on to Task 8.6.

## Task 8.6 — Phase 8 verification + service card refresh

- [ ] **Step 1:** `pnpm nx affected -t test,lint,build --base=origin/main` — green.
- [ ] **Step 2:** Invoke `audit-service` for `onboarding-bff`; ensure the refreshed CLAUDE.md card documents the CopilotKit emission seam deviation (one sentence under AgentRuntime section: "Emission lives in the `/copilotkit` request handler, not in `invokeOrchestrator` — see `agents/onboarding/server.ts`.").
- [ ] **Step 3:** Commit card if drifted.

**Phase 8 success criteria:**
- Onboarding emits per turn on investor bus (verified via unit test + sandbox deploy smoke).
- Helper map complete; all six services represented.
- E2E assertion block explicitly deferred to a follow-up plan, recorded in Phase 9.5.

---

# Phase 9 — Cross-phase verification and handoff

## Task 9.1 — Full-repo green

- [ ] **Step 1: Full test + build**

Run: `pnpm nx run-many -t test,lint,build,typecheck`
Expected: all pass.

- [ ] **Step 2: Full e2e sweep**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features`
Expected: every scenario green.

## Task 9.2 — Helper map parity (enforced at the type level — no runtime test)

**No new test is added.** The original plan proposed a runtime parity test that required a `__testOnly_AGENT_TRACE_EVENTS` re-export to reach into the helper's internals. It's been removed because TypeScript already enforces the same guarantees at compile time:

- **Every AgentKey is covered.** `AgentKey = keyof typeof AGENT_TRACE_EVENTS` means the union literally is the map's key set. Every scenario that calls `AgentTraceTrap.arm(ctx, 'xyz')` must pass a key that exists in the map — `pnpm nx typecheck e2e-feature-tests` catches missing entries.
- **Every detailType is typed.** Each entry's `detailType` value is imported from the owning service's `domain/events.ts`, so any service-side rename forces an e2e helper update via a type error.
- **Bus routing is literal.** `bus: 'advisory' as const` / `bus: 'investor' as const` are string literals — no runtime drift possible.

A runtime test of the same facts would (a) require punching a hole through encapsulation (the `__testOnly_` re-export), and (b) verify only what the type system already verifies, at the cost of one more moving part.

- [ ] **Step 1: Verify typecheck covers the contract**

Run: `pnpm nx typecheck e2e-feature-tests`
Expected: pass. If a service's event constant was renamed without updating the helper map, this is where the failure surfaces.

- [ ] **Step 2: (No commit — nothing to add.)**

If a future refactor makes the type-level guarantee weaker (e.g. if `AGENT_TRACE_EVENTS` is ever exposed as a wider type), reconsider adding a runtime parity test at that point.

## Task 9.3 — Update `MEMORY.md` topic file

- [ ] **Step 1: Create topic file** `project_agent_contract_tests.md` describing the feature, events, helper, and which scenarios assert which agent's contract.

- [ ] **Step 2: Add a single line under "Recently Completed Work" in `MEMORY.md`:**

```
- **Agent contract tests** — SHIPPED YYYY-MM-DD: 6 agents emit AgentTraceEnvelope per invocation; 5+ advisory scenarios + 1 onboarding scenario assert process metadata (tools, models, nodes, latency). See `project_agent_contract_tests.md`.
```

- [ ] **Step 3: Commit.**

## Task 9.4 — Regenerate C4 diagrams (optional but recommended)

- [ ] Invoke the `generate-c4-diagrams` skill — the emitter is a new outbound edge from each agent runtime to its domain bus; stage-1 will pick it up if the service stacks changed.

## Task 9.5 — Plan summary / deferrals

Investor-profile (Phase 5) and market-intelligence (Phase 7) assertion blocks landed inside `first-decision.e2e.test.ts`. **Onboarding (Phase 8) is explicitly deferred** because no existing e2e scenario drives CopilotRuntime.

- [ ] **Step 1: Record the onboarding deferral in `project_agent_contract_tests.md`**

Add the following section to that topic file:

```
## Deferred

- **Onboarding e2e assertion** — Phase 8 of agent-contract-tests landed infrastructure only (event, emitter, IAM grant, helper map entry).
  No e2e assertion block exists because no current scenario drives CopilotKit turns.
  Follow-up plan: `docs/superpowers/plans/2026-XX-XX-onboarding-e2e-scenario.md` (to be created)
  — scope: add a CopilotKit session harness to `apps/e2e-feature-tests` + a multi-turn
  scenario + the assertion block sketched in the contract-tests plan Phase 8 Task 8.5.
```

- [ ] **Step 2: Commit the summary**

```bash
git add memory/project_agent_contract_tests.md  # adjust path to your memory dir
git commit -m "docs: record onboarding-e2e deferral for agent contract tests"
```

**Phase 9 success criteria:**
- All tests green.
- Service cards and MEMORY.md reflect new feature.
- Deferrals (if any) documented.

---

# Cross-cutting guidance

## Committing cadence

One commit per sub-task as listed. Do not batch. Use conventional commits (`feat`, `test`, `refactor`, `docs`, `chore`) with scope matching the project name.

## Known deviations from the spec (introduced in this plan)

- **Market-intelligence refactor.** `market-intelligence-ctrl` currently uses `agentNode` directly, not `invokeOrchestrator`. Task 7.2 wraps `agentNode` in a single-node StateGraph so the `invokeOrchestrator` path is uniform. No behaviour change; only plumbing. (Narrative already got this treatment in Plan 2/3 Task 3.2.)
- **Onboarding-bff emission seam.** The spec's "emission lives in `invokeOrchestrator`" commitment does not fit CopilotRuntime cleanly. This plan localises emission into the CopilotKit request handler (Phase 8 Task 8.2). The tracer still attaches via LangChain callbacks through `graph.withConfig`, so the envelope content is produced identically to the other five services. Document this in the onboarding-bff service card.

(See Plan 1/3 for deviations about event detail shape and the `InvokeOptions` discriminated union. See Plan 2/3 for the `AgentTraceTrap` class shape and `EventBusTrap.init` → `deploy` naming.)

## Verification checklist before merge (per service phase)

- [ ] Event constant present in `domain/events.ts`.
- [ ] `server.ts` builds `EventBridgeTraceEmitter` with the correct `detailType`.
- [ ] `agents/<agent-name>/graph.ts` routes through `invokeOrchestrator` with `agent/correlationId/tenantId/emitter`.
- [ ] `service.stack.ts` grants `events:PutEvents` to `agentRuntime.runtime.grantPrincipal`.
- [ ] `pnpm nx typecheck <service>` passes (the `InvokeOptions` discriminated union is the emitter-DI contract — a typecheck failure here is what a DI unit test would have caught).
- [ ] CDK assertion test asserts the IAM grant.
- [ ] Helper map widened.
- [ ] At least one e2e scenario asserts the agent's contract; trap deployed before trigger. (Onboarding-bff is exempt until its e2e scenario lands — Phase 9.5 deferral.)
- [ ] Deploy succeeds.
- [ ] Scenario passes on sandbox (`--prefix=dev`).
- [ ] Service CLAUDE.md card refreshed.

## Series complete

Once Phase 9 is merged, the full contract-tests series is done:

- Plan 1/3 foundation: library + tsconfig aliases.
- Plan 2/3 first rollout: `advisory-narrative-ctrl` + `AgentTraceTrap`.
- Plan 3/3 (this plan): five remaining agents + verification + deferral log.

Follow-up: `2026-XX-XX-onboarding-e2e-scenario.md` (CopilotKit-driving e2e scenario for onboarding-bff).
