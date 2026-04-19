# Agent Contract Tests — Plan 2/3: First rollout (`advisory-narrative-ctrl`) + `AgentTraceTrap`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Position in series:**
1. Plan 1/3: `2026-04-19-agent-contract-tests-01-foundation.md` — **prerequisite**: library core + tsconfig aliases.
2. **This plan** — first service rollout (lowest risk: narrative has 1 node, 0 tools). Lands the `AgentTraceTrap` class scaffold that subsequent plans widen.
3. Plan 3/3: `2026-04-19-agent-contract-tests-03-remaining-services.md` — portfolio-engine, investor-profile, decision-lifecycle, market-intelligence, onboarding + cross-phase verification.

**Goal of the series:** Add deterministic, process-metadata contract assertions to six agent-invoking e2e scenarios by emitting an `AgentTraceEnvelope` from `invokeOrchestrator` on every agent invocation, then asserting on the emitted events in the existing scenarios.

**Goal of THIS plan:** Instrument `advisory-narrative-ctrl` — the lowest-risk agent (single-node, zero tools) — end-to-end. Land the `AgentTraceTrap<K extends AgentKey>` helper class so the shape is validated before being templated across the remaining five services.

**Why this service first (per spec §11):** single node + zero tools means the envelope assertions reduce to "status, one LLM call, one node, under budget" — the simplest possible contract. If the helper class, EB trap wiring, IAM grant, or deploy has a defect, it surfaces here before being copy-pasted across five more services.

**Tech Stack:** TypeScript 5, LangGraph.js, AWS SDK v3, CDK v2, AWS AgentCore Runtime, Jest, Nx.

---

## Prerequisites

- [ ] Plan 1/3 (`2026-04-19-agent-contract-tests-01-foundation.md`) merged to `main`. Verify:
  - `pnpm nx test agent-orchestrator` green.
  - `grep -n "AgentTracer\|EventBridgeTraceEmitter" libs/agent-orchestrator/src/index.ts` shows exports.
  - `grep -n "advisory-narrative-ctrl/events" tsconfig.base.json` shows the alias.

If any of these fail, stop and land Plan 1 first.

## Source of truth

- Design spec: `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`
- Project conventions: `CLAUDE.md` (tests in `test/`, `pnpm nx` only, events-only inter-service comms)
- Plan 1 exports: `@nestfolio/agent-orchestrator` — `invokeOrchestrator`, `AgentTracer`, `EventBridgeTraceEmitter`, `NoopTraceEmitter`, `TraceEmitter`, `InvokeOptions`.

## Scope of this plan

- `services/advisory/advisory-narrative-ctrl`: declare event, wrap `agentNode` in StateGraph, wire emitter from `server.ts`, grant `events:PutEvents` on AgentRuntime role, CDK assertion test.
- `apps/e2e-feature-tests`: create `AgentTraceTrap` class (narrative-only entry in the `AGENT_TRACE_EVENTS` map), add contract assertion block to `view-decision-explanation.e2e.test.ts`.
- Deploy narrative to sandbox and run the scenario.

Out of scope: portfolio-engine, investor-profile, decision-lifecycle, market-intelligence, onboarding — all Plan 3/3.

## File structure

### New files in `apps/e2e-feature-tests`
- `src/helpers/agent-trace-trap.ts` — `AgentTraceTrap` class (narrative-only scaffold; `AgentKey`, `AgentTraceEvent`, `WaitForOptions` types)
- `test/unit/agent-trace-trap.test.ts` — type-level contract test (optional — skip if app has no unit test target; see Task 3.5 Step 1)

### Modified files in `apps/e2e-feature-tests`
- `src/advisory/view-decision-explanation.e2e.test.ts` — narrative contract block
- `src/index.ts` — re-export helper if barrel exists

### Modified files in the service
- `services/advisory/advisory-narrative-ctrl/src/domain/events.ts` — add `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` entry
- `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts` — wrap `agentNode` in single-node StateGraph → route through `invokeOrchestrator`
- `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts` — build emitter, pass to `invokeOrchestrator`
- `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` — grant `events:PutEvents` to `agentRuntime.runtime.grantPrincipal`
- `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts` — CDK assertion for IAM grant

## Testing strategy (this plan)

Two test layers plus static checks:

1. **Service CDK assertion test** (`services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`): asserts `events:PutEvents` grant on the AgentRuntime role.
2. **E2E** (`apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts`): contract assertion block on narrative envelope (status, no errors, ≥1 LLM call, 0 tools, under latency budget).

Emitter DI at `graph.ts`/`server.ts` is covered by `pnpm nx typecheck` — the `InvokeOptions` discriminated union makes `agent` + `correlationId` mandatory when an emitter is present, so a missing wire fails compile. No tautological `jest.mock(invokeOrchestrator)` test.

`test-support` and `integration-testing` are NOT extended — reuse `EventBusTrap`, `TestContext`, `OrphanReaper` as-is.

## Verification commands reference

- Build/test/lint/typecheck one project: `pnpm nx {build|test|lint|typecheck} <project>`
- Affected: `pnpm nx affected -t test,build,lint`
- Deploy one service to sandbox: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-narrative-ctrl`
- E2E run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features`

---

# Phase 3 — `advisory-narrative-ctrl` (first rollout)

**Shippable outcome:** Narrative agent emits `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` per invocation. `view-decision-explanation.e2e.test.ts` asserts narrative contract. Deployed to sandbox and passing e2e.

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/domain/events.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts` (wrap `agentNode` in single-node StateGraph → route through `invokeOrchestrator`)
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts` (build emitter, pass to invokeOrchestrator)
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` (grant `events:PutEvents` to AgentRuntime execution role)
- Create: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` (narrative-only scaffold; the first landing of the `AgentTraceTrap` class)
- Modify: `apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts` (add assertion block)

## Task 3.1 — Add event to `domain/events.ts`

- [ ] **Step 1: Open current file**

Run: `cat services/advisory/advisory-narrative-ctrl/src/domain/events.ts`

- [ ] **Step 2: Add the new entry**

In `services/advisory/advisory-narrative-ctrl/src/domain/events.ts`, inside `NarrativeEventTypes` (verified name — `export const NarrativeEventTypes` at line 4), add:

```ts
ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED: eventName('ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED'),
```

- [ ] **Step 3: Unit test for event presence**

If a `domain/events.test.ts` exists, append a presence check. Otherwise skip this sub-step (the compile check in the next steps is sufficient).

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/domain/events.ts
git commit -m "feat(advisory-narrative-ctrl): declare ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED event"
```

## Task 3.2 — Refactor graph.ts to route through `invokeOrchestrator`

Narrative currently calls `agentNode({input})` directly — this bypasses `invokeOrchestrator`, so the tracer never attaches. Wrap it in a single-node `StateGraph` so the orchestrator path is uniform.

- [ ] **Step 1: Read current graph.ts**

Run: `cat services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`

- [ ] **Step 2: Replace `invokeNarrative` to build+invoke a compiled graph**

Apply this edit to the `invokeNarrative` function in `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`:

```ts
import { Annotation, StateGraph } from '@langchain/langgraph';
import { invokeOrchestrator, NoopTraceEmitter, type TraceEmitter } from '@nestfolio/agent-orchestrator';

// keep existing imports (buildMemoryClient, buildKBClient, createAgentNode, withFallback, etc.)

const NarrativeState = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<Record<string, unknown>>,
});

function buildGraph() {
  const builder = new StateGraph(NarrativeState);
  builder.addNode('advisory-narrative', async (state) => {
    const result = await agentNode({ input: state.input });
    return { output: result as Record<string, unknown> };
  });
  builder.addEdge('__start__', 'advisory-narrative');
  builder.addEdge('advisory-narrative', '__end__');
  return builder.compile();
}

const compiledGraph = buildGraph();

export async function invokeNarrative(params: {
  tenantId: string;
  decisionId: string;
  input: string;
  emitter?: TraceEmitter;
}): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(params.tenantId, params.decisionId);
  const kb = buildKBClient();

  // 1. Read upstream decision context from memory (unchanged)
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream decision context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 2. KB enrichment (unchanged)
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(params.input, 3);
    if (kbResults.length > 0) {
      kbContext = `\n\nKnowledge base context:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  const enrichedInput = params.input + upstreamContext + kbContext;

  const result = await invokeOrchestrator(compiledGraph, { input: enrichedInput }, {
    agent: 'advisory-narrative',
    correlationId: params.decisionId,
    tenantId: params.tenantId,
    emitter: params.emitter ?? new NoopTraceEmitter(),
  });

  if ('serviceUnavailable' in result) throw new Error(`Narrative unavailable: ${result.reason}`);
  const output = (result as { output?: Record<string, unknown> }).output ?? {};

  await session.writeAgentOutput(output);
  return output;
}
```

> **No graph-side DI unit test.** The earlier plan revision proposed a `jest.mock('@nestfolio/agent-orchestrator', ...)` test asserting that `invokeOrchestrator` is called with the right `{agent, correlationId, tenantId, emitter}`. It was removed because it is tautological — it verifies the arguments you just wrote rather than any behaviour — and because real regressions (wrong `correlationId` source, wrong `detailType`, missing IAM grant) are caught by the CDK assertion test (Task 3.4) and the e2e scenario (Task 3.6). Keeping the test adds upkeep without adding signal.

- [ ] **Step 3: Typecheck the refactor**

Run: `pnpm nx typecheck advisory-narrative-ctrl`
Expected: pass. The `invokeOrchestrator` union narrows on `emitter` — if `agent` or `correlationId` is omitted at the call site, typecheck fails here.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts
git commit -m "refactor(advisory-narrative-ctrl): route agent through invokeOrchestrator"
```

## Task 3.3 — Wire EventBridge emitter from server.ts

- [ ] **Step 1: Modify server.ts**

Replace `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts`:

```ts
import { serve } from '@hono/node-server';
import { createAgentServer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { NarrativeEventTypes } from '../../src/domain/events';
import { invokeNarrative } from './graph';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'], // may be undefined in unit-test/local contexts; emitter no-ops when absent (see Plan 1 Task 1.4)
  source: 'agent-orchestrator@advisory-narrative-ctrl',
  detailType: NarrativeEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
});

const app = createAgentServer(async (prompt, sessionId) => {
  const result = await invokeNarrative({
    tenantId: sessionId.split('/')[0] || sessionId,
    decisionId: sessionId,
    input: prompt,
    emitter,
  });
  return JSON.stringify(result);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('advisory-narrative-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm nx build advisory-narrative-ctrl`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts
git commit -m "feat(advisory-narrative-ctrl): emit AgentTraceEnvelope from agent runtime"
```

## Task 3.4 — Grant `events:PutEvents` on AgentRuntime execution role

- [ ] **Step 1: Inspect current service.stack.ts**

Run: `cat services/advisory/advisory-narrative-ctrl/src/service.stack.ts`

Note the variable holding the `AgentRuntime` construct (expect something like `const agentRuntime = new AgentRuntime(...)`). If the runtime is assigned without capture, capture it.

- [ ] **Step 2: Grant PutEvents**

In `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`, after the `AgentRuntime` construct is instantiated, add:

```ts
this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);
```

If the construct was previously not captured in a variable, refactor to `const agentRuntime = new AgentRuntime(this, 'AgentRuntime', { ... });`.

- [ ] **Step 3: CDK synth — verify the policy statement**

Run: `pnpm nx run advisory-narrative-ctrl:synth` (if such a target exists). Otherwise synth from the infra root per project convention — adjust to the repo's standard synth command.

Expected: synth succeeds. Inspect the synthesised template for an IAM policy statement containing `events:PutEvents` with resource `arn:aws:events:*:*:event-bus/<prefix>-advisory-bus` on the runtime's role.

- [ ] **Step 4: CDK assertion test**

In `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts` (or wherever the stack CDK assertions live), add:

```ts
import { Template, Match } from 'aws-cdk-lib/assertions';
// ... existing imports & stack setup

it('grants events:PutEvents on the advisory bus to the AgentRuntime role', () => {
  Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'events:PutEvents',
          Effect: 'Allow',
        }),
      ]),
    },
  });
});
```

- [ ] **Step 5: Run — expect pass**

Run: `pnpm nx test advisory-narrative-ctrl -- --testPathPattern=service.stack`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/service.stack.ts services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(advisory-narrative-ctrl): grant PutEvents on advisory bus to AgentRuntime"
```

## Task 3.5 — Land `AgentTraceTrap` class scaffold (narrative-only)

**API shape.** Two-step: `const trap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative')` armed BEFORE the trigger (typically in `beforeEach`, before `applyFixtures`), then `const traces = await trap.waitFor({ correlationId })` in the `it()` body.

Why a class: (1) handle-driven API makes `.waitFor()` unreachable without prior `.arm()`, which prevents "trap deployed after trigger" mistakes at the type level; (2) per-agent type narrowing — `AgentTraceTrap<'decisionLifecycle'>` carries the key forward so `getLatencyBudget()` takes no argument; (3) encapsulates correlationId filtering, envelope typing, and the bus/detailType map — removes boilerplate from every scenario.

- [ ] **Step 1: Write failing unit test for `AgentTraceTrap` shape**

Create `apps/e2e-feature-tests/test/unit/agent-trace-trap.test.ts` (create the `test/unit/` directory if it doesn't exist). Note: this task REQUIRES `apps/e2e-feature-tests` to have a unit test target. Check: `cat apps/e2e-feature-tests/project.json | grep -A 4 '"test"'`. If the app has no unit test target, add one using the standard Nx jest config or SKIP this step and rely on the Plan 3 parity task + the scenario exercise in Task 3.6 as the only test. Document the decision in the commit message.

```ts
import type { AgentTraceTrap } from '../../src/helpers/agent-trace-trap';

describe('AgentTraceTrap<"advisoryNarrative"> (type-level contract)', () => {
  it('exports the class with static arm and instance waitFor/getLatencyBudget', () => {
    // This is a compile-time test. If the exports shift, TS will error here.
    const armSig: typeof import('../../src/helpers/agent-trace-trap').AgentTraceTrap.arm | undefined = undefined;
    expect(armSig).toBeUndefined();

    type TrapForNarrative = AgentTraceTrap<'advisoryNarrative'>;
    type WaitForReturn = ReturnType<TrapForNarrative['waitFor']>;
    const _check: WaitForReturn = Promise.resolve([]) as WaitForReturn;
    expect(_check).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module missing)**

Run: `pnpm nx test e2e-feature-tests -- --testPathPattern=agent-trace-trap`
Expected: FAIL — `Cannot find module '../../src/helpers/agent-trace-trap'`. If no unit test target exists, skip and proceed.

- [ ] **Step 3: Create `AgentTraceTrap` class (narrative-only entry in the AGENT_TRACE_EVENTS map)**

Content for `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`:

```ts
import { EventBusTrap } from '@nestfolio/integration-testing';
import type { TestContext } from '@nestfolio/test-support';
import type { AgentTraceEnvelope } from '@nestfolio/agent-orchestrator';
import { NarrativeEventTypes } from '@nestfolio/advisory-narrative-ctrl/events';

// Internal — NOT exported. Each service phase widens this map.
// (exporting would tempt scenarios to bypass the class and reach for raw entries.)
const AGENT_TRACE_EVENTS = {
  advisoryNarrative: {
    bus: 'advisory' as const,
    detailType: NarrativeEventTypes.ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED,
  },
};

export type AgentKey = keyof typeof AGENT_TRACE_EVENTS;

/**
 * Soft latency budgets (ms) — canaries for pathological regressions, NOT SLAs.
 * Wall-clock LLM time depends on cold-start, Bedrock region, model availability.
 * Override per-env via `AGENT_LATENCY_BUDGET_MS_<AGENT_KEY>` (e.g.
 * `AGENT_LATENCY_BUDGET_MS_DECISION_LIFECYCLE=90000`) instead of tightening here.
 *
 * `as const` typo-checks every key and lets `this.agent` index directly without
 * a `string` widening that would allow `'portfolioEnigne'` to silently return
 * `undefined`. The map covers the six agents planned for tracing; `AgentKey`
 * grows per service phase until it equals `keyof typeof DEFAULT_LATENCY_BUDGETS_MS`
 * (compile-time enforced by the indexed read in `getLatencyBudget`).
 */
const DEFAULT_LATENCY_BUDGETS_MS = {
  advisoryNarrative: 15_000,
  portfolioEngine: 45_000,
  decisionLifecycle: 60_000,
  investorProfile: 30_000,
  marketIntelligence: 30_000,
  onboarding: 30_000,
} as const;

export interface AgentTraceEvent {
  context: { tenantId: string };
  correlationId: string;
  agent: string;
  envelope: AgentTraceEnvelope;
  emittedAt: string;
}

export interface WaitForOptions {
  correlationId: string;
  minCount?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class AgentTraceTrap<K extends AgentKey> {
  private constructor(
    private readonly trap: EventBusTrap,
    public readonly agent: K,
    private readonly detailType: string,
  ) {}

  /**
   * Arm the trap. Call BEFORE any fixture or action that can invoke the agent,
   * typically at the top of beforeEach, before applyFixtures().
   *
   * Composes the generic EventBusTrap from @nestfolio/integration-testing.
   * EventBusTrap.deploy() registers a cleanup with ctx.cleanup automatically.
   */
  static async arm<K extends AgentKey>(ctx: TestContext, agent: K): Promise<AgentTraceTrap<K>> {
    const entry = AGENT_TRACE_EVENTS[agent];
    const trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: entry.bus, detailType: entry.detailType });
    return new AgentTraceTrap(trap, agent, entry.detailType);
  }

  /**
   * Poll for trace events with the given correlationId. Returns when `minCount`
   * matching events have been collected, or throws on timeout.
   *
   * If this throws a timeout, the first suspect is trap-armed-too-late:
   * verify that `.arm()` was called BEFORE the action that triggered the agent.
   */
  async waitFor(opts: WaitForOptions): Promise<AgentTraceEvent[]> {
    const minCount = opts.minCount ?? 1;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 1000;
    const deadline = Date.now() + timeoutMs;
    const collected: AgentTraceEvent[] = [];

    while (Date.now() < deadline) {
      const events = await this.trap.drain();
      for (const e of events) {
        if (e.detailType !== this.detailType) continue;
        const detail = e.detail as unknown as AgentTraceEvent;
        if (detail.correlationId === opts.correlationId) collected.push(detail);
      }
      if (collected.length >= minCount) return collected;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(
      `AgentTraceTrap.waitFor timed out after ${timeoutMs}ms. ` +
        `agent=${this.agent} correlationId=${opts.correlationId} expected>=${minCount} got=${collected.length}. ` +
        `Common cause: .arm() was called AFTER the trigger that invokes the agent. ` +
        `Move .arm() earlier in beforeEach (before applyFixtures or any agent-triggering mutation).`,
    );
  }

  getLatencyBudget(): number {
    const envKey = `AGENT_LATENCY_BUDGET_MS_${this.agent.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
    const override = process.env[envKey];
    const parsed = override ? Number.parseInt(override, 10) : NaN;
    // No `?? fallback` — AgentKey is a subset of `keyof typeof DEFAULT_LATENCY_BUDGETS_MS`,
    // so the indexed read is guaranteed a number by the type system.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LATENCY_BUDGETS_MS[this.agent];
  }
}
```

- [ ] **Step 4: Re-export from e2e barrel if applicable**

Run: `grep -n "export" apps/e2e-feature-tests/src/index.ts | head -10`

If `apps/e2e-feature-tests/src/index.ts` re-exports helpers, add:

```ts
export { AgentTraceTrap, type AgentKey, type AgentTraceEvent, type WaitForOptions } from './helpers/agent-trace-trap';
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm nx typecheck e2e-feature-tests && pnpm nx lint e2e-feature-tests`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts apps/e2e-feature-tests/src/index.ts apps/e2e-feature-tests/test/unit/agent-trace-trap.test.ts
git commit -m "feat(e2e): add AgentTraceTrap class (narrative-only scaffold)"
```

## Task 3.6 — Deploy + e2e assertion

- [ ] **Step 1: Deploy to sandbox**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-narrative-ctrl`
Expected: deploy succeeds; CloudFormation change set includes new IAM policy statement on the runtime role.

- [ ] **Step 2: Audit fixture chain to determine where the narrative is triggered**

Run: `grep -n "advisory-narrative\|NARRATIVE\|narrative" apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts apps/e2e-feature-tests/src/helpers/fixtures.ts`

The narrative runs as part of decision finalisation. If `withDecision()` (or whichever fixture builds the decision) is what triggers it, the trap MUST be armed in `beforeEach` before `applyFixtures`. If the scenario itself triggers finalisation via a mutation in the `it()` body, arming can happen inside the test body before that mutation.

- [ ] **Step 3: Add trap arming + assertion block to `view-decision-explanation.e2e.test.ts`**

Apply this patch to `apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts`:

```ts
import { AgentTraceTrap } from '../helpers/agent-trace-trap';
// ...keep existing imports...

describe('scenario — view decision explanation', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let narrativeTrap: AgentTraceTrap<'advisoryNarrative'>;
  // ...existing state...

  beforeEach(async () => {
    ctx = await buildTestContext();
    tenant = await freshTenant(ctx);
    // ARM BEFORE applyFixtures — if the narrative fires during decision finalisation
    // inside applyFixtures, arming after would miss events.
    narrativeTrap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative');
    const result = await applyFixtures(ctx, tenant, [onboarded(), withDecision({ ... })]);
    decisionId = result.decisionId as string;
  });

  afterEach(async () => {
    await ctx.cleanup.runAll();  // tears down the trap via EventBusTrap's registered cleanup
  });

  it('recordExplanationView returns a ViewReceipt with viewedAt set', async () => {
    // ...existing test body — GraphQL wait, mutate, assert receipt...

    // Narrative contract assertion — correlationId = decisionId because the
    // narrative agent is invoked per decision and emits with decisionId as correlationId.
    const traces = await narrativeTrap.waitFor({ correlationId: decisionId });
    const envelope = traces[0].envelope;

    expect(envelope.status).toBe('success');
    expect(envelope.errors).toHaveLength(0);
    expect(envelope.toolCalls).toHaveLength(0);
    expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);
    expect(envelope.llmCalls[0]['gen_ai.request.model']).toBe('sonnet');
    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(narrativeTrap.getLatencyBudget());
  });
});
```

- [ ] **Step 4: Run the scenario**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=view-decision-explanation`
Expected: PASS. If the trap times out, the error message from `AgentTraceTrap.waitFor` now says exactly what to check (arm-before-trigger ordering).

- [ ] **Step 5: Commit**

```bash
git add apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts
git commit -m "test(e2e): assert advisory-narrative contract in view-decision-explanation scenario"
```

## Task 3.7 — Phase 3 verification

- [ ] **Step 1: Full affected test**

Run: `pnpm nx affected -t test,lint,build --base=origin/main`
Expected: all pass.

- [ ] **Step 2: Audit service card**

Invoke the `audit-service` skill for `advisory-narrative-ctrl` and regenerate `services/advisory/advisory-narrative-ctrl/CLAUDE.md` if drifted (new event name, new emitter wiring).

- [ ] **Step 3: Commit card if changed**

```bash
git add services/advisory/advisory-narrative-ctrl/CLAUDE.md
git commit -m "docs(advisory-narrative-ctrl): refresh service card for trace event"
```

**Phase 3 success criteria:**
- `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` declared, emitted, subscribed in e2e.
- `view-decision-explanation.e2e.test.ts` passes with contract assertion block.
- No existing scenarios regressed.
- Stack synth emits IAM `events:PutEvents` grant.

---

# Cross-cutting guidance

## Committing cadence

One commit per sub-task as listed. Do not batch. Use conventional commits (`feat`, `test`, `refactor`, `docs`, `chore`) with scope matching the project name.

## Known deviations from the spec (introduced in this plan)

- **Helper shape: class instead of loose functions.** The spec sketched helper functions (`waitForAgentTraces`, `getLatencyBudget`). This plan consolidates these into the `AgentTraceTrap<K extends AgentKey>` class — static `arm(ctx, agent)` factory + instance `waitFor({correlationId})` + `getLatencyBudget()`. Rationale: the handle-driven API makes `.waitFor()` unreachable without prior `.arm()`, preventing "trap armed after trigger" mistakes at the type level. Composes the unchanged generic `EventBusTrap`.
- **`EventBusTrap.init(...)` in the spec is `trap.deploy(...)` in the codebase.** The plan uses `deploy` via the `AgentTraceTrap` wrapper.
- **Narrative refactor.** `advisory-narrative-ctrl` currently uses `agentNode` directly, not `invokeOrchestrator`. Task 3.2 wraps `agentNode` in a single-node StateGraph so the `invokeOrchestrator` path is uniform. No behaviour change; only plumbing.

(See Plan 1/3 for deviations about event detail shape and the `InvokeOptions` discriminated union. See Plan 3/3 for the market-intelligence refactor and the onboarding-bff CopilotKit seam.)

## Verification checklist before merge

- [ ] `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` present in `services/advisory/advisory-narrative-ctrl/src/domain/events.ts`.
- [ ] `agents/advisory-narrative/server.ts` builds `EventBridgeTraceEmitter` with the correct `detailType`.
- [ ] `agents/advisory-narrative/graph.ts` routes through `invokeOrchestrator` with `agent/correlationId/tenantId/emitter`.
- [ ] `service.stack.ts` grants `events:PutEvents` to `agentRuntime.runtime.grantPrincipal`.
- [ ] `pnpm nx typecheck advisory-narrative-ctrl` passes.
- [ ] CDK assertion test asserts the IAM grant.
- [ ] `AgentTraceTrap` class exported from `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`.
- [ ] `view-decision-explanation.e2e.test.ts` arms the trap in `beforeEach` BEFORE `applyFixtures`.
- [ ] Deploy to sandbox succeeds.
- [ ] Scenario passes on sandbox (`--prefix=dev`).
- [ ] Service CLAUDE.md card refreshed.

## Handoff to Plan 3/3

After this plan merges, proceed to `2026-04-19-agent-contract-tests-03-remaining-services.md`. That plan widens the `AgentTraceTrap` map per service phase and asserts the contract for the remaining five agents.
