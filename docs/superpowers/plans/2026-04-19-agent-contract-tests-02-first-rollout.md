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
- `src/helpers/agent-trace-trap.ts` — `AgentTraceTrap` class (narrative-only scaffold; `AgentKey`, `WaitForOptions` types; reuses `AgentTraceEventDetail` exported by `@nestfolio/agent-orchestrator`)
- `test/unit/agent-trace-trap.test.ts` — type-level contract test (optional — skip if app has no unit test target; see Task 3.5 Step 1)

### Modified files in `apps/e2e-feature-tests`
- `src/advisory/view-decision-explanation.e2e.test.ts` — narrative contract block
- `src/index.ts` — re-export helper if barrel exists

### Modified files in the service
- `services/advisory/advisory-narrative-ctrl/src/domain/events.ts` — add `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` entry
- `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts` — wrap `agentNode` in single-node StateGraph → route through `invokeOrchestrator`
- `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts` — parse JSON body for real decisionId/tenantId, build emitter, pass to `invokeOrchestrator`
- `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` — grant `events:PutEvents` to `agentRuntime.runtime.grantPrincipal`
- `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts` — CDK assertion for IAM grant scoped to AgentRuntime role
- `services/advisory/advisory-narrative-ctrl/test/unit/graph.test.ts` — extend mock factory with `invokeOrchestrator` proxy so existing tests survive the refactor

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
- Modify: `services/advisory/advisory-narrative-ctrl/test/unit/graph.test.ts` (extend mock factory with `invokeOrchestrator` proxy)
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts` (parse JSON body for real decisionId/tenantId; build emitter, pass to invokeOrchestrator)
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts` (grant `events:PutEvents` to AgentRuntime execution role)
- Modify: `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts` (CDK assertion scoped to AgentRuntime role)
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
import { invokeOrchestrator, type TraceEmitter } from '@nestfolio/agent-orchestrator';

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

  // Per Plan 1 Task 1.3 / Task 1.4: when `emitter` is omitted, invokeOrchestrator skips
  // emission silently — no NoopTraceEmitter fallback needed.
  const result = await invokeOrchestrator(compiledGraph, { input: enrichedInput }, {
    agent: 'advisory-narrative',
    correlationId: params.decisionId,
    tenantId: params.tenantId,
    emitter: params.emitter,
  });

  // Behavior note: the pre-refactor `invokeNarrative` never threw — `narrativeFallback`
  // always converted errors into a fallback value. The orchestrator preserves this for the
  // happy path (the fallback still runs inside the node) but now also returns a
  // `ServiceUnavailableResponse` if the graph itself throws before the node runs. Throwing
  // here surfaces that new failure mode explicitly instead of silently returning `{}`.
  if ('serviceUnavailable' in result) throw new Error(`Narrative unavailable: ${result.reason}`);
  const output = (result as { output?: Record<string, unknown> }).output ?? {};

  await session.writeAgentOutput(output);
  return output;
}
```

> **No graph-side DI unit test.** The earlier plan revision proposed a `jest.mock('@nestfolio/agent-orchestrator', ...)` test asserting that `invokeOrchestrator` is called with the right `{agent, correlationId, tenantId, emitter}`. It was removed because it is tautological — it verifies the arguments you just wrote rather than any behaviour — and because real regressions (wrong `correlationId` source, wrong `detailType`, missing IAM grant) are caught by the CDK assertion test (Task 3.4) and the e2e scenario (Task 3.6). Keeping the test adds upkeep without adding signal.

- [ ] **Step 2a: Update `test/unit/graph.test.ts` mock factory**

The existing test at `services/advisory/advisory-narrative-ctrl/test/unit/graph.test.ts` mocks `@nestfolio/agent-orchestrator` with a factory that only covers the pre-refactor imports. The refactor adds `invokeOrchestrator` (and the `TraceEmitter` type, which does not need runtime mocking). Without this step, `invokeOrchestrator` resolves to `undefined` at test time and every test in the file fails.

Apply this edit to the `jest.mock('@nestfolio/agent-orchestrator', ...)` call in that file — add the `invokeOrchestrator` entry to the factory:

```ts
jest.mock('@nestfolio/agent-orchestrator', () => ({
  createAgentNode: jest.fn().mockReturnValue(mockAgentNode),
  withValidation: jest.fn().mockImplementation((node) => node),
  withRetry: jest.fn().mockImplementation((node) => node),
  withFallback: jest.fn().mockImplementation((node) => node),
  createKBClient: jest.fn().mockReturnValue({ retrieve: mockKBRetrieve }),
  createMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
  createNoOpMemoryClient: jest.fn().mockReturnValue({
    openDecisionSession: jest.fn().mockReturnValue(mockMemorySession),
  }),
  // NEW — proxy the compiled graph's invoke so existing assertions on mockAgentNode still fire.
  invokeOrchestrator: jest.fn().mockImplementation(async (graph, input) => graph.invoke(input)),
}));
```

Run: `pnpm nx test advisory-narrative-ctrl -- --testPathPattern=graph`
Expected: all three existing tests (`enriches input with KB context`, `reads upstream memory context`, `writes output to memory`) still pass. They assert on `mockAgentNode` / `mockMemorySession` behaviour — neither is affected by the StateGraph wrapper as long as `invokeOrchestrator` calls through to `graph.invoke`.

`@langchain/langgraph` does NOT need mocking — `StateGraph` is pure in-process state-machine code, no I/O. Confirm by running the test; if `StateGraph.compile()` fails in jest (unlikely), fall back to mocking the module with a trivial `{ Annotation: { Root: () => ({}) }, StateGraph: class { addNode() { return this; } addEdge() { return this; } compile() { return { invoke: async ({input}) => ({output: await mockAgentNode({input})}) }; } } }` stub.

- [ ] **Step 3: Typecheck the refactor**

Run: `pnpm nx typecheck advisory-narrative-ctrl`
Expected: pass. The `invokeOrchestrator` union narrows on `emitter` — if `agent` or `correlationId` is omitted at the call site, typecheck fails here.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts \
        services/advisory/advisory-narrative-ctrl/test/unit/graph.test.ts
git commit -m "refactor(advisory-narrative-ctrl): route agent through invokeOrchestrator"
```

## Task 3.3 — Wire EventBridge emitter from server.ts

**Why the body must be parsed.** `agent-service.ts:47-52` invokes the runtime via `invokeRemoteRuntime(url, {tenantId, decisionId, upstreamOutputs})` — the real `decisionId` lives in the JSON POST body, NOT in the AgentCore `sessionId` (which is an opaque session identifier set by AgentCore). The pre-existing `server.ts` wrote `decisionId: sessionId` — that was tolerated because `invokeNarrative` only used `decisionId` for the memory session key, and a mismatched key just meant "empty upstream context". Now that `decisionId` flows into the emitted envelope's `correlationId` and the e2e scenario filters traces by the real `decisionId`, the mismatch becomes a correctness bug. Parse the body.

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
  // Ingress handler (agent-service.ts) sends a JSON body {tenantId, decisionId, upstreamOutputs}.
  // Parse it here so correlationId threads the real decisionId, not the AgentCore sessionId.
  // Fall back to sessionId-derived values if the body is non-JSON (direct CLI invocation, etc.).
  let parsed: { tenantId?: string; decisionId?: string } = {};
  try {
    parsed = JSON.parse(prompt) as { tenantId?: string; decisionId?: string };
  } catch {
    /* non-JSON prompt — fall through to sessionId fallback */
  }
  const tenantId = parsed.tenantId ?? sessionId.split('/')[0] ?? sessionId;
  const decisionId = parsed.decisionId ?? sessionId;

  const result = await invokeNarrative({
    tenantId,
    decisionId,
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

Run: `pnpm nx build advisory-narrative-ctrl` (covers the stack's TypeScript compilation). Full `cdk synth` for this service runs from the infra root via `tools/register-paths.js` — the plan does not mandate running it here; Step 4's assertion test provides the verification.

Expected: build succeeds. The assertion test in Step 4 then verifies the synthesised template has `events:PutEvents` scoped to the AgentRuntime role.

- [ ] **Step 4: CDK assertion test**

The policy attached by `grantPutEventsTo(agentRuntime.runtime.grantPrincipal)` binds to the AgentRuntime's execution role. Scope the assertion to that role so it fails when the grant is missing and passes when additive statements are added. **Why the tight scoping matters:** `advisory-narrative-ctrl` already has an egress CDC publisher Lambda with `events:PutEvents` on its own role — an untargeted assertion (`hasResourceProperties('AWS::IAM::Policy', ...)` alone) passes on the egress policy even if the runtime grant is absent. False-positive risk neutralised by matching `Roles` to an `AgentRuntime*` logical id.

In `services/advisory/advisory-narrative-ctrl/test/unit/service.stack.test.ts`, add (use the existing `template` from `beforeAll`):

```ts
// imports (Match is already imported in the existing file)
// ... existing imports & stack setup

it('grants events:PutEvents to the AgentRuntime execution role', () => {
  // Find IAM policies attached to a role whose logical id contains "AgentRuntime".
  // We then assert that at least one of those policies includes the events:PutEvents action.
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: {
      Roles: Match.arrayWith([
        Match.objectLike({ Ref: Match.stringLikeRegexp('.*AgentRuntime.*') }),
      ]),
    },
  });
  expect(Object.keys(policies).length).toBeGreaterThan(0);

  const statements = Object.values(policies).flatMap(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => p.Properties.PolicyDocument.Statement ?? [],
  );
  const actions = statements.flatMap((s: { Action: string | string[] }) =>
    Array.isArray(s.Action) ? s.Action : [s.Action],
  );
  expect(actions).toContain('events:PutEvents');
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

Why a class: (1) handle-driven API — `private constructor` + static `arm()` factory — makes `.waitFor()` syntactically unreachable without a prior `.arm()` call. This is a *type/shape* invariant, not a temporal one: it cannot see when `arm()` runs versus when the trigger fires, so `trigger(); await arm(); await waitFor()` still compiles. The error-message hint in `waitFor` diagnoses that case at runtime. (2) per-agent type narrowing — `AgentTraceTrap<'decisionLifecycle'>` carries the key forward so `getLatencyBudget()` takes no argument; (3) encapsulates correlationId filtering, envelope typing, and the bus/detailType map — removes boilerplate from every scenario.

- [ ] **Step 1: Write failing unit test for `AgentTraceTrap` shape**

Check for a unit test target: `cat apps/e2e-feature-tests/project.json | grep -A 4 '"test"'`. If `apps/e2e-feature-tests` has no standalone unit test target, SKIP this step and rely on the e2e scenario in Task 3.6 plus `pnpm nx typecheck e2e-feature-tests` as the only validation — document the skip in the Task 3.5 Step 6 commit message.

If a unit test target exists, create `apps/e2e-feature-tests/test/unit/agent-trace-trap.test.ts` (create the `test/unit/` directory if it doesn't exist):

```ts
import { AgentTraceTrap } from '../../src/helpers/agent-trace-trap';

describe('AgentTraceTrap<"advisoryNarrative">', () => {
  it('exposes the static arm factory and instance getLatencyBudget', () => {
    expect(typeof AgentTraceTrap.arm).toBe('function');
    // Budget lookup works without a live trap since it only reads env + the default map.
    // Synthesise an instance-shaped object that exposes getLatencyBudget bound to the same
    // implementation — the point is to lock the method's presence and its numeric return.
    const budget = AgentTraceTrap.prototype.getLatencyBudget.call({ agent: 'advisoryNarrative' });
    expect(typeof budget).toBe('number');
    expect(budget).toBeGreaterThan(0);
  });
});
```

Why this shape: `typeof AgentTraceTrap.arm === 'function'` locks the factory name against accidental rename; the `prototype.getLatencyBudget.call(...)` line covers the per-agent narrowing *and* the default-budget indexing without needing to construct a real trap (which would hit AWS). The type-level `AgentTraceTrap<K>` narrowing is enforced by `pnpm nx typecheck` — a separate dedicated type-level test file adds upkeep without adding signal.

- [ ] **Step 2: Run test to verify it fails (module missing)**

Run: `pnpm nx test e2e-feature-tests -- --testPathPattern=agent-trace-trap`
Expected: FAIL — `Cannot find module '../../src/helpers/agent-trace-trap'`. If no unit test target exists, skip and proceed.

- [ ] **Step 3: Create `AgentTraceTrap` class (narrative-only entry in the AGENT_TRACE_EVENTS map)**

Content for `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`:

```ts
import { EventBusTrap } from '@nestfolio/integration-testing';
import type { TestContext } from '@nestfolio/test-support';
import type { AgentTraceEventDetail } from '@nestfolio/agent-orchestrator';
import { NarrativeEventTypes } from '@nestfolio/advisory-narrative-ctrl/events';

// Internal — NOT exported. Each service phase widens this map.
// (exporting would tempt scenarios to bypass the class and reach for raw entries.)
//
// Casing convention: map keys are camelCase (drives `AgentKey`), while the `agent` string
// emitted inside each envelope is kebab-case (`'advisory-narrative'`) to match the spec §3
// agent-name convention and the service's `agents/<agent-name>/` folder layout. The trap
// filters by `detailType` alone, so the casing split is cosmetic — but subsequent phases
// MUST keep the map keys camelCase and the service-side `agent:` strings kebab-case.
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

// Event shape re-uses `AgentTraceEventDetail` exported by Plan 1 — keep the canonical
// type in the orchestrator library, not duplicated here. `waitFor` returns that type
// directly; the service emits it via `EventBridgeTraceEmitter`.

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
  async waitFor(opts: WaitForOptions): Promise<AgentTraceEventDetail[]> {
    const minCount = opts.minCount ?? 1;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 1000;
    const deadline = Date.now() + timeoutMs;
    const collected: AgentTraceEventDetail[] = [];

    while (Date.now() < deadline) {
      const events = await this.trap.drain();
      for (const e of events) {
        if (e.detailType !== this.detailType) continue;
        const detail = e.detail as unknown as AgentTraceEventDetail;
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
export { AgentTraceTrap, type AgentKey, type WaitForOptions } from './helpers/agent-trace-trap';
// `AgentTraceEventDetail` is re-exported from `@nestfolio/agent-orchestrator`; consumers should import it from there.
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

> **DEFERRAL (2026-04-20):** Steps 3–5 are deferred to Plan 3/3 Phase 7.5 after execution of this plan surfaced a sandbox pipeline-trigger gap. Keep Steps 1–2 (deploy + log verification). Skip Steps 3–5 and do NOT add a narrative contract block to `view-decision-explanation.e2e.test.ts` or any other scenario as part of Plan 2.
>
> **Why deferred:**
> - `view-decision-explanation.e2e.test.ts` uses the synthetic `withDecision` fixture which publishes `DECISION_PACKET_CREATED` directly to advisory-bff; it does not invoke the narrative agent. `recordExplanationView` is a pure BFF write of a `UserInteraction` item.
> - `first-decision.e2e.test.ts` uses `withLiveDecision`, but `aws stepfunctions list-executions` on `dev-decision-workflow-ctrl-decisionstatemachine` returns `[]` — the Step Function has never executed in sandbox. `GENERATE_NARRATIVE` is only published from that SF (`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:86`), so the narrative agent is never invoked on any existing scenario.
> - The narrative emitter, `invokeOrchestrator` wrap, and CDK `events:PutEvents` grant are all verified by Plan 2's unit test suite (`pnpm nx test advisory-narrative-ctrl` — 35/35 green) and by a successful sandbox deploy. Only the live-path delivery assertion is deferred.
>
> **Tracked in Plan 3:** see Phase 3.5 (close the pipeline gap) + Phase 7.5 (add the deferred narrative contract block to `first-decision.e2e.test.ts` once Phase 3.5 is green).

- [ ] **Step 1: Deploy to sandbox**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-narrative-ctrl`
Expected: deploy succeeds; CloudFormation change set includes new IAM policy statement on the runtime role.

- [ ] **Step 2: Audit fixture chain to determine where the narrative is triggered**

Run: `grep -n "advisory-narrative\|NARRATIVE\|narrative" apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts apps/e2e-feature-tests/src/helpers/fixtures.ts`

The narrative runs as part of decision finalisation. If `withDecision()` (or whichever fixture builds the decision) is what triggers it, the trap MUST be armed in `beforeEach` before `applyFixtures`. If the scenario itself triggers finalisation via a mutation in the `it()` body, arming can happen inside the test body before that mutation.

- [ ] **Step 3: Add trap arming + assertion block to `view-decision-explanation.e2e.test.ts`**

The existing scenario (verified: `createTestContext`, not `buildTestContext`; `describe` label "scenario 8 — investor views decision explanation") triggers the narrative during `applyFixtures` via `withDecision` — the `recordExplanationView` mutation is a *viewer* action that runs AFTER the narrative has already emitted. Arm BEFORE `applyFixtures`.

Apply this patch to `apps/e2e-feature-tests/src/advisory/view-decision-explanation.e2e.test.ts`:

```ts
import { AgentTraceTrap } from '../helpers/agent-trace-trap';
// ...keep existing imports (createTestContext, freshTenant, applyFixtures, onboarded,
//     withDecision, bffClient, waitForGraphQL, types)...

describe('scenario 8 — investor views decision explanation', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let decisionId: string;
  let narrativeTrap: AgentTraceTrap<'advisoryNarrative'>;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // ARM BEFORE applyFixtures — the narrative fires during decision finalisation
    // inside withDecision(). Arming after would miss events.
    narrativeTrap = await AgentTraceTrap.arm(ctx, 'advisoryNarrative');
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      withDecision({ trigger: 'INITIAL_ALLOCATION' }),
    ]);
    decisionId = result.decisionId as string;
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll(); // tears down the trap via EventBusTrap's registered cleanup
  }, 60_000);

  it('recordExplanationView returns a ViewReceipt with viewedAt set', async () => {
    // ...existing test body — waitForGraphQL + recordExplanationView mutate + receipt asserts...

    // Narrative contract assertion — correlationId = decisionId because the narrative agent
    // is invoked per decision and server.ts (Task 3.3) parses decisionId from the JSON body.
    // `traces[0]` is safe here: narrative emits exactly once per decision (single-node, no
    // revision cycles). Plan 3 agents that may emit multiple times for the same decisionId
    // (decision-lifecycle under operating-mode escalation, reconciliation-correction)
    // assert on `traces[traces.length - 1]` instead.
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

## Task 3.8 — Update design spec §9 to describe `AgentTraceTrap` class

Plan 1 Task 2.2 corrected the spec's `init`→`deploy` and the `tenantId` wrapping, but left the §9 `waitForAgentTraces(ctx, opts)` *function* signature in place. Now that this plan ships the `AgentTraceTrap<K>` class, §9 needs to match the shipped API or it will mislead anyone reading the spec after merge.

- [ ] **Step 1: Replace the `waitForAgentTraces` helper sketch in §9 with an `AgentTraceTrap` sketch**

In `docs/superpowers/specs/2026-04-18-agent-contract-test-design.md`, locate §9 ("E2E harness — `waitForAgentTraces`"). Rename the section to "E2E harness — `AgentTraceTrap`" and replace the function-shaped helper with the class-shaped helper this plan ships. Keep the `AGENT_TRACE_EVENTS` map and the `AgentKey` type definition; they remain accurate. Replace the `WaitForAgentTracesOptions` interface and the `waitForAgentTraces(ctx, opts)` function with the class-shaped API:

```ts
// apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts
import type { TestContext } from '@nestfolio/test-support';
import type { AgentTraceEventDetail } from '@nestfolio/agent-orchestrator';
import { EventBusTrap } from '@nestfolio/integration-testing';
// ...service event-type imports unchanged...

const AGENT_TRACE_EVENTS = {
  // ...same per-agent entries (advisoryNarrative, portfolioEngine, ...) as before...
} as const;

export type AgentKey = keyof typeof AGENT_TRACE_EVENTS;

export interface WaitForOptions {
  correlationId: string;
  minCount?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;  // poll cadence for the EventBusTrap drain loop; defaults to 1000ms
}

export class AgentTraceTrap<K extends AgentKey> {
  // private constructor + static `arm(ctx, agent)` factory + instance
  // `waitFor({correlationId})` + `getLatencyBudget()`. The handle-driven shape
  // makes `waitFor` syntactically unreachable without a prior `arm()` call.
  static async arm<K extends AgentKey>(ctx: TestContext, agent: K): Promise<AgentTraceTrap<K>>;
  waitFor(opts: WaitForOptions): Promise<AgentTraceEventDetail[]>;
  getLatencyBudget(): number;
}
```

Update §2's ASCII flow diagram lines that reference `waitForAgentTraces(ctx, ...)` so they read:

```
3. const trap = await AgentTraceTrap.arm(ctx, 'decisionLifecycle')   // arm BEFORE the trigger
4. ...trigger fixtures + mutations...
5. const traces = await trap.waitFor({ correlationId, minCount })
```

- [ ] **Step 2: Confirm spec §9 references the canonical `AgentTraceEventDetail` type**

The spec's existing `AgentTraceEvent` shape inside §9 should be removed (it duplicated `AgentTraceEventDetail` from §3). The class returns `AgentTraceEventDetail[]` directly.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-18-agent-contract-test-design.md
git commit -m "docs(specs): replace waitForAgentTraces sketch with AgentTraceTrap class in §9"
```

---

# Cross-cutting guidance

## Committing cadence

One commit per sub-task as listed. Do not batch. Use conventional commits (`feat`, `test`, `refactor`, `docs`, `chore`) with scope matching the project name.

## Known deviations from the spec (introduced in this plan)

- **Helper shape: class instead of loose functions.** The spec sketched helper functions (`waitForAgentTraces`, `getLatencyBudget`). This plan consolidates these into the `AgentTraceTrap<K extends AgentKey>` class — static `arm(ctx, agent)` factory + instance `waitFor({correlationId})` + `getLatencyBudget()`. Rationale: the handle-driven API makes `.waitFor()` syntactically unreachable without prior `.arm()`, encouraging correct ordering. This is a shape/type invariant, not a temporal one — the class cannot detect `trigger(); arm(); waitFor()`; the diagnostic hint in `waitFor`'s timeout message covers that case at runtime. Composes the unchanged generic `EventBusTrap`.
- **`EventBusTrap.init(...)` in the spec is `trap.deploy(...)` in the codebase.** The plan uses `deploy` via the `AgentTraceTrap` wrapper.
- **Narrative refactor.** `advisory-narrative-ctrl` currently uses `agentNode` directly, not `invokeOrchestrator`. Task 3.2 wraps `agentNode` in a single-node StateGraph so the `invokeOrchestrator` path is uniform. Minor behaviour change: the refactored `invokeNarrative` can now throw `Narrative unavailable: ...` if `invokeOrchestrator` returns a `ServiceUnavailableResponse` (the pre-refactor code always returned a fallback value). This surface is unreachable on the happy path because `narrativeFallback` still wraps the inner `agentNode`; it only triggers when the graph itself throws before the node runs.
- **`server.ts` body parsing.** Pre-existing code wrote `decisionId: sessionId` — a latent bug because the ingress handler sends the real `decisionId` in the JSON POST body (`agent-service.ts:47-52` via `invokeRemoteRuntime`), not as the AgentCore sessionId. Task 3.3 parses the body so the emitted envelope's `correlationId` is the real `decisionId` the e2e test filters on. Fallback to sessionId-derived values preserves behaviour for direct CLI invocations.

(See Plan 1/3 for deviations about event detail shape and the `InvokeOptions` discriminated union. See Plan 3/3 for the market-intelligence refactor and the onboarding-bff CopilotKit seam.)

## Verification checklist before merge

- [ ] `ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED` present in `services/advisory/advisory-narrative-ctrl/src/domain/events.ts`.
- [ ] `agents/advisory-narrative/server.ts` parses the JSON body (`tenantId`, `decisionId`) and builds `EventBridgeTraceEmitter` with the correct `detailType`.
- [ ] `agents/advisory-narrative/graph.ts` routes through `invokeOrchestrator` with `agent/correlationId/tenantId/emitter` (no `NoopTraceEmitter` fallback — emitter is optional).
- [ ] `test/unit/graph.test.ts` mock factory includes `invokeOrchestrator` so the existing three tests still pass.
- [ ] `service.stack.ts` grants `events:PutEvents` to `agentRuntime.runtime.grantPrincipal`.
- [ ] `pnpm nx typecheck advisory-narrative-ctrl` passes.
- [ ] CDK assertion test scopes to the AgentRuntime role (not any-policy) so the egress CDC publisher's pre-existing `events:PutEvents` grant cannot mask a missing runtime grant.
- [ ] `AgentTraceTrap` class exported from `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`.
- [ ] `view-decision-explanation.e2e.test.ts` arms the trap in `beforeEach` BEFORE `applyFixtures` (uses `createTestContext`, not `buildTestContext`).
- [ ] Deploy to sandbox succeeds.
- [ ] Scenario passes on sandbox (`--prefix=dev`).
- [ ] Service CLAUDE.md card refreshed.

## Handoff to Plan 3/3

After this plan merges, proceed to `2026-04-19-agent-contract-tests-03-remaining-services.md`. That plan widens the `AgentTraceTrap` map per service phase and asserts the contract for the remaining five agents.
