# Onboarding Agent Contract Deferral Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the Plan 3/3 Phase 8 Task 8.5 + Phase 9.5 onboarding deferral without a new e2e scenario: align the onboarding runtime with Bedrock AgentCore's `POST /invocations` + `x-amzn-bedrock-agentcore-runtime-session-id` convention, export the runtime ARN via SSM, document a one-shot deploy-time log smoke, and update memory.

**Architecture:** Five tasks. Tasks 1–2 are TDD-driven code changes scoped to `services/investor/onboarding-bff`. Task 3 is service-level verification. Task 4 records the decision in memory. Task 5 is the live sandbox smoke that proves the AgentCore path works end-to-end. No new e2e test, no new helper, no new devDep.

**Tech Stack:** TypeScript, Hono, AWS CDK (`aws-cdk-lib`), `@aws-cdk/aws-bedrock-agentcore-alpha`, Jest, AWS CLI (`bedrock-agentcore`, `events`, `logs`, `ssm`).

**Spec correction:** The spec at §8.2 cross-references `memory/project_mock_resilience.md`, which is marked **SUPERSEDED** (2026-04-20) — the FakeLlm mechanism it recorded was abandoned in favor of the AgentCore data-plane dispatcher. This plan keeps the spec's intent but records the onboarding integration-test gap **inside the resolution block in `project_agent_contract_tests.md`** instead of the superseded file, and notes that the correct integration-test mechanism is SDK-level Bedrock mocks (`aws-sdk-client-mock`) or a LangChain `FakeListChatModel` injected through the graph builder, not the abandoned env-var FakeLlm.

---

## File structure

**Modified:**
- `services/investor/onboarding-bff/agents/onboarding/server.ts` — route + header + `/ping` alias.
- `services/investor/onboarding-bff/test/unit/runtime/server.test.ts` — tests for the new route + header + `/ping`; drop `/copilotkit` coverage.
- `services/investor/onboarding-bff/src/service.stack.ts` — `AgentRuntimeUrlParam` SSM export.
- `services/investor/onboarding-bff/test/unit/service.stack.test.ts` — one assertion for the new SSM parameter.
- `services/investor/onboarding-bff/CLAUDE.md` — service card refresh (auto-regenerated via `audit-service`).

**Memory:**
- `memory/project_agent_contract_tests.md` — move onboarding from `## Deferred` to a new `## Resolution: onboarding (2026-04-21)` block; inline the log-smoke procedure + result; inline the onboarding integration-test gap note.

**Not touched:**
- `apps/e2e-feature-tests/**` — no new scenario, helper, or devDep (per spec §4.2).
- `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` — `onboarding` map entry stays (type-level parity).
- `memory/project_mock_resilience.md` — SUPERSEDED, left untouched (see plan header).
- `services/investor/onboarding-bff/src/main.ts`, `src/repositories/**`, `src/agent/**`, `agents/onboarding/graph.ts` — graph/tool/repo logic unchanged.
- `GET /session` endpoint in `server.ts` — kept (out of scope; unrelated to AgentCore path).

---

### Task 1 — Align onboarding runtime server with AgentCore convention (TDD)

**Goal:** `POST /invocations` replaces `POST /copilotkit`; identity parsed from `x-amzn-bedrock-agentcore-runtime-session-id = ${tenantId}/${sessionId}`; `GET /ping` alias added.

**Files:**
- Modify: `services/investor/onboarding-bff/test/unit/runtime/server.test.ts`
- Modify: `services/investor/onboarding-bff/agents/onboarding/server.ts`

- [ ] **Step 1: Rewrite the server test file to drive the new contract (failing tests).**

Replace the entire file with:

```ts
import { createApp } from '../../../agents/onboarding/server';

const processMock = jest.fn().mockResolvedValue(new Response('ok'));

jest.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: jest.fn().mockImplementation(() => ({
    process: processMock,
  })),
  LangGraphAgent: jest.fn(),
}));

jest.mock('../../../agents/onboarding/graph', () => ({
  buildOnboardingGraph: jest.fn().mockReturnValue({}),
}));

jest.mock('../../../src/repositories/onboarding.repository', () => ({
  OnboardingRepository: jest.fn().mockImplementation(() => ({
    getActiveSession: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('../../../src/agent/session', () => ({
  rehydrateState: jest.fn().mockReturnValue({ phase: 'personal-info' }),
}));

const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

afterEach(() => {
  processMock.mockClear();
  warnSpy.mockClear();
});

describe('Onboarding AgentCore runtime server', () => {
  it('createApp returns a Hono app', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('responds 200 to GET /health', async () => {
    const app = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });

  it('responds 200 to GET /ping (AgentCore health convention)', async () => {
    const app = createApp();
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
  });

  it('exposes POST /invocations and delegates to CopilotRuntime.process', async () => {
    const app = createApp();
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'tenant-a/session-1',
      },
      body: JSON.stringify({ threadId: 'session-1', messages: [] }),
    });
    expect(res.status).toBe(200);
    expect(processMock).toHaveBeenCalledTimes(1);
  });

  it('POST /copilotkit no longer exists (routed off in favour of /invocations)', async () => {
    const app = createApp();
    const res = await app.request('/copilotkit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

describe('Runtime session-id parsing', () => {
  it('skips emission and warns when the session-id header is missing', async () => {
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onboarding trace emission skipped'),
      expect.objectContaining({ hasTenantId: false, hasSessionId: false }),
    );
  });

  it('skips emission and warns when the session-id header has no "/" separator', async () => {
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'malformed-no-slash',
      },
      body: JSON.stringify({}),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onboarding trace emission skipped'),
      expect.objectContaining({ hasTenantId: false, hasSessionId: false }),
    );
  });

  it('skips emission when either tenantId or sessionId half is empty', async () => {
    const app = createApp();
    await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 'tenant-a/',
      },
      body: JSON.stringify({}),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onboarding trace emission skipped'),
      expect.objectContaining({ hasTenantId: true, hasSessionId: false }),
    );
  });
});

describe('/session endpoint (unchanged)', () => {
  it('returns newSession when no headers', async () => {
    const app = createApp();
    const res = await app.request('/session');
    const json = await res.json();
    expect(json.newSession).toBe(true);
  });

  it('returns newSession when no active session', async () => {
    const { OnboardingRepository } = require('../../../src/repositories/onboarding.repository');
    OnboardingRepository.mockImplementation(() => ({
      getActiveSession: jest.fn().mockResolvedValue(null),
    }));
    const app = createApp();
    const res = await app.request('/session', {
      headers: { 'x-tenant-id': 't1', 'x-user-id': 'u1' },
    });
    const json = await res.json();
    expect(json.newSession).toBe(true);
  });

  it('returns completed when session status is completed', async () => {
    const { OnboardingRepository } = require('../../../src/repositories/onboarding.repository');
    OnboardingRepository.mockImplementation(() => ({
      getActiveSession: jest.fn().mockResolvedValue({ status: 'completed', currentPhase: 'completed' }),
    }));
    const app = createApp();
    const res = await app.request('/session', {
      headers: { 'x-tenant-id': 't1', 'x-user-id': 'u1' },
    });
    const json = await res.json();
    expect(json.completed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests — confirm they fail.**

Run: `pnpm nx test onboarding-bff --testPathPattern=runtime/server`
Expected: multiple failures — `POST /invocations` 404s (route does not exist), `POST /copilotkit` still returns 200, session-id-parsing assertions fail (`x-tenant-id`/`x-user-id` header path is still in use).

- [ ] **Step 3: Update `agents/onboarding/server.ts` to satisfy the tests.**

Replace the `createApp()` body with:

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CopilotRuntime, LangGraphAgent } from '@copilotkit/runtime';
import { buildOnboardingGraph } from './graph';
import { OnboardingRepository } from '../../src/repositories/onboarding.repository';
import { AgentTracer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { OnboardingBffEventTypes } from '../../src/domain/events';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@onboarding-bff',
  detailType: OnboardingBffEventTypes.ONBOARDING_AGENT_INVOCATION_TRACED,
});

function parseRuntimeSessionId(raw: string | undefined): { tenantId: string; sessionId: string } {
  if (!raw) return { tenantId: '', sessionId: '' };
  const slash = raw.indexOf('/');
  if (slash < 0) return { tenantId: '', sessionId: '' };
  return { tenantId: raw.slice(0, slash), sessionId: raw.slice(slash + 1) };
}

export function createApp() {
  const app = new Hono();

  app.use('/*', cors({
    origin: '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/ping', (c) => c.json({ status: 'ok' }));

  app.get('/session', async (c) => {
    const tenantId = c.req.header('x-tenant-id') ?? '';
    const userId = c.req.header('x-user-id') ?? '';

    if (!tenantId || !userId) {
      return c.json({ newSession: true });
    }

    const tableName = process.env['TABLE_NAME'] ?? '';
    const repo = new OnboardingRepository(tableName);
    const session = await repo.getActiveSession(tenantId, userId);

    if (!session) {
      return c.json({ newSession: true });
    }

    if (session.currentPhase === 'completed' || session.status === 'completed') {
      return c.json({ completed: true });
    }

    const { rehydrateState } = await import('../../src/agent/session');
    const state = rehydrateState(session as any);
    return c.json({ activeSession: true, state });
  });

  app.post('/invocations', async (c) => {
    const tableName = process.env['TABLE_NAME'] ?? '';
    const repo = new OnboardingRepository(tableName);

    // AgentCore forwards the runtime session id as the header below, formatted
    // as `${tenantId}/${sessionId}`. Matches libs/agent-orchestrator/
    // invoke-agentcore.ts:45 and agent-server.ts:27.
    const { tenantId, sessionId } = parseRuntimeSessionId(
      c.req.header('x-amzn-bedrock-agentcore-runtime-session-id'),
    );

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
      } else {
        // eslint-disable-next-line no-console
        console.warn('onboarding trace emission skipped (missing tenantId or sessionId)', {
          hasTenantId: Boolean(tenantId),
          hasSessionId: Boolean(sessionId),
        });
      }
    }
  });

  return app;
}

if (process.env['AGENT_RUNTIME'] === 'true') {
  const app = createApp();
  const port = parseInt(process.env['PORT'] ?? '8080', 10);
  // eslint-disable-next-line no-console
  console.log(`Onboarding agent runtime listening on port ${port}`);
  if (typeof Bun !== 'undefined' && Bun?.serve) {
    Bun.serve({ fetch: app.fetch, port });
  } else {
    import('node:http').then(({ createServer }) => {
      createServer(app.fetch as any).listen(port);
    });
  }
}
```

- [ ] **Step 4: Run the tests again — confirm green.**

Run: `pnpm nx test onboarding-bff --testPathPattern=runtime/server`
Expected: all cases in `Onboarding AgentCore runtime server`, `Runtime session-id parsing`, and `/session endpoint (unchanged)` pass.

- [ ] **Step 5: Commit.**

```bash
git add services/investor/onboarding-bff/agents/onboarding/server.ts \
        services/investor/onboarding-bff/test/unit/runtime/server.test.ts
git commit -m "$(cat <<'EOF'
fix(onboarding-bff): align runtime server with AgentCore convention

POST /copilotkit → POST /invocations. Identity is now parsed from the
x-amzn-bedrock-agentcore-runtime-session-id header (formatted as
${tenantId}/${sessionId}), matching libs/agent-orchestrator's
agent-server.ts and invoke-agentcore.ts. GET /ping added alongside
/health for AgentCore health probes. Removes the latent bug where the
deployed runtime would 404 any AgentCore invocation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 — Publish runtime ARN as SSM parameter (TDD)

**Goal:** `/nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl` holds the runtime ARN at deploy time; matches `advisory-narrative-ctrl` pattern.

**Files:**
- Modify: `services/investor/onboarding-bff/test/unit/service.stack.test.ts`
- Modify: `services/investor/onboarding-bff/src/service.stack.ts`

- [ ] **Step 1: Add a failing CDK-assertion test.**

Append the following `it` block to the existing `describe('OnboardingBffStack', ...)` in `test/unit/service.stack.test.ts`:

```ts
  it('publishes the AgentCore runtime ARN at /nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/nestfolio/test-onboarding-bff/agent/runtimeUrl',
      Type: 'String',
    });
  });
```

- [ ] **Step 2: Run it — confirm it fails.**

Run: `pnpm nx test onboarding-bff --testPathPattern=service.stack`
Expected: the new test fails (`Template has 0 resources with type SSM::Parameter matching ...` or similar). The existing `events:PutEvents` test still passes.

- [ ] **Step 3: Add the SSM export to `service.stack.ts`.**

Add the import at the top (join with the existing `aws-cdk-lib/aws-ssm` import if already present — it is):

```ts
// already present:
// import { StringParameter } from 'aws-cdk-lib/aws-ssm';
```

Immediately after the `this.eventBus.grantPutEventsTo(agentRuntime.runtime.grantPrincipal);` line (currently line 71), add:

```ts
    // SSM-published runtime target. Pattern mirrors
    // services/advisory/advisory-narrative-ctrl/src/service.stack.ts:99-107.
    // Defaults to the real AgentCore runtime ARN; future consumers
    // (proxy Lambda, BFF resolver, smoke scripts) discover it via SSM.
    new StringParameter(this, 'AgentRuntimeUrlParam', {
      parameterName: `/nestfolio/${props.prefix}-onboarding-bff/agent/runtimeUrl`,
      stringValue: agentRuntime.runtime.agentRuntimeArn,
    });
```

- [ ] **Step 4: Run the test — confirm green.**

Run: `pnpm nx test onboarding-bff --testPathPattern=service.stack`
Expected: both the existing `events:PutEvents` test and the new SSM-parameter test pass.

- [ ] **Step 5: Commit.**

```bash
git add services/investor/onboarding-bff/src/service.stack.ts \
        services/investor/onboarding-bff/test/unit/service.stack.test.ts
git commit -m "$(cat <<'EOF'
feat(onboarding-bff): export AgentCore runtime ARN via SSM

Publishes /nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl,
matching the pattern in advisory-narrative-ctrl. Enables future
consumers (proxy Lambda, BFF resolver, the log-smoke procedure in the
deferral-resolution spec) to discover the deployed runtime without
hardcoding ARNs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 — Service-level verification + card refresh

**Goal:** Full onboarding-bff project is green (unit/lint/typecheck/build). Service card refreshed.

**Files:**
- Modify (auto-regenerated): `services/investor/onboarding-bff/CLAUDE.md`

- [ ] **Step 1: Full unit test suite — green.**

Run: `pnpm nx test onboarding-bff`
Expected: all unit tests pass (runtime/server, service.stack, agent, tools, repositories, domain).

- [ ] **Step 2: Lint.**

Run: `pnpm nx lint onboarding-bff`
Expected: no errors. If the linter flags the new `parseRuntimeSessionId` helper or test imports, fix inline.

- [ ] **Step 3: Typecheck.**

Run: `pnpm nx typecheck onboarding-bff` (if that target exists; otherwise `pnpm nx run onboarding-bff:typecheck` or fall back to `pnpm nx build onboarding-bff`).
Expected: clean.

- [ ] **Step 4: Build.**

Run: `pnpm nx build onboarding-bff`
Expected: success — including the container bundle for `agents/onboarding/`.

- [ ] **Step 5: Refresh the service card via `audit-service`.**

Run the `audit-service` skill scoped to `onboarding-bff` (project card lives at `services/investor/onboarding-bff/CLAUDE.md`). If the skill reports changes, commit them:

```bash
git add services/investor/onboarding-bff/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(onboarding-bff): refresh service card after AgentCore alignment

Reflects /invocations route, /ping alias, SSM AgentRuntimeUrlParam
export. Run via audit-service skill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If the card is already accurate, skip the commit.

- [ ] **Step 6: Affected check across the workspace.**

Run: `pnpm nx affected -t test,lint,build --base=origin/main`
Expected: only onboarding-bff-scoped targets run; all green. If any other project is flagged as affected, inspect — the changes in this task should be service-local.

---

### Task 4 — Record resolution + integration-test gap in memory

**Goal:** `project_agent_contract_tests.md` moves onboarding out of `## Deferred` into a new `## Resolution: onboarding (2026-04-21)` block that inlines the layering decision, the log-smoke procedure, and the integration-test gap note.

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_agent_contract_tests.md`

- [ ] **Step 1: Read the current topic file.**

Open `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_agent_contract_tests.md`. Identify the `## Deferred` section and the onboarding entry within it.

- [ ] **Step 2: Replace the onboarding entry under `## Deferred` with a pointer, and add a new `## Resolution: onboarding (2026-04-21)` section.**

Inside `## Deferred`, replace the onboarding bullet with:

```markdown
- **Onboarding e2e assertion** — RESOLVED 2026-04-21 without a new e2e scenario. See `## Resolution: onboarding (2026-04-21)` below.
```

Then insert, directly after the `## Deferred` section (or at the bottom of the file if no later sections exist), a new section:

```markdown
## Resolution: onboarding (2026-04-21)

The Phase 8 Task 8.5 / Phase 9.5 deferral closed **without** a dedicated e2e scenario. The onboarding agent's surface is a live multi-turn conversation with no triggering event on the bus and no cross-domain outcome reachable in a deterministic turn budget; every other scenario in `apps/e2e-feature-tests/src/` is anchored to a user-visible feature outcome (see `docs/superpowers/specs/2026-04-21-onboarding-agent-contract-deferral-resolution-design.md` §2 for the structural argument). Forcing an e2e would produce the only mechanism-only scenario in the directory and add live Bedrock token cost per CI run for weak signal.

### Server changes shipped alongside

- `services/investor/onboarding-bff/agents/onboarding/server.ts` — routes `POST /invocations` (AgentCore convention); reads identity from `x-amzn-bedrock-agentcore-runtime-session-id` (`${tenantId}/${sessionId}`); `GET /ping` alias added.
- `services/investor/onboarding-bff/src/service.stack.ts` — publishes the runtime ARN via `/nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl` (matches `advisory-narrative-ctrl`).

### Live-pipeline smoke (one-shot, not in CI)

Run once after the server changes land on sandbox, and any time `agents/onboarding/server.ts` or the SSM export is modified.

```bash
# 1. Deploy onboarding-bff to sandbox.
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=onboarding-bff

# 2. Create a transient EB rule that funnels the expected trace to CloudWatch.
LOG_GROUP=/aws/events/smoke-onboarding-$(date +%s)
aws logs create-log-group --log-group-name "$LOG_GROUP" --region us-east-1
aws events put-rule \
  --event-bus-name dev-investor-bus \
  --name onboarding-smoke-rule \
  --event-pattern '{"detail-type":["ONBOARDING_AGENT_INVOCATION_TRACED"]}' \
  --region us-east-1
aws events put-targets \
  --event-bus-name dev-investor-bus \
  --rule onboarding-smoke-rule \
  --targets "Id=1,Arn=arn:aws:logs:us-east-1:771924376645:log-group:${LOG_GROUP}" \
  --region us-east-1

# 3. Invoke the runtime.
RUNTIME_ARN=$(aws ssm get-parameter \
  --name "/nestfolio/dev-onboarding-bff/agent/runtimeUrl" \
  --query 'Parameter.Value' --output text --region us-east-1)
SESSION="smoke-$(date +%s)"
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn "$RUNTIME_ARN" \
  --runtime-session-id "smoke-tenant/${SESSION}" \
  --payload file://services/investor/onboarding-bff/scripts/smoke/copilotkit-minimal-turn.json \
  /tmp/onboarding-smoke.out \
  --region us-east-1

# 4. Verify.
sleep 10
aws logs filter-log-events --log-group-name "$LOG_GROUP" \
  --filter-pattern "{ \$.detail.correlationId = \"${SESSION}\" }" \
  --region us-east-1

# 5. Cleanup.
aws events remove-targets --event-bus-name dev-investor-bus \
  --rule onboarding-smoke-rule --ids 1 --region us-east-1
aws events delete-rule --event-bus-name dev-investor-bus \
  --name onboarding-smoke-rule --region us-east-1
aws logs delete-log-group --log-group-name "$LOG_GROUP" --region us-east-1
```

Pass criteria: `invoke-agent-runtime` returns HTTP 200, non-empty body; `filter-log-events` returns exactly one event with `detail.detail-type = ONBOARDING_AGENT_INVOCATION_TRACED`, `detail.correlationId = ${SESSION}`, `detail.context.tenantId = smoke-tenant`, `detail.envelope.status = success`, and no `llm_error` in `detail.envelope.errors`.

Fixture `services/investor/onboarding-bff/scripts/smoke/copilotkit-minimal-turn.json` — captured once from a real `onboarding-mfe` request; regenerate when CopilotKit ships a major version bump.

### Integration-test gap (not filled here)

Behavioural coverage for the onboarding agent (UI widget rendering per phase, KB retrieval correctness, `commit-phase` on every transition, `compute-risk` correctness, floor for hallucination on known product facts) belongs in integration tests, not e2e. The current `services/investor/onboarding-bff/test/integration/onboarding-bff.integration.test.ts` only validates DDB schemas.

Recommended mechanism when that work lands: either SDK-level Bedrock mocks via `aws-sdk-client-mock`, or LangChain `FakeListChatModel` injected through the graph builder. **Do not** re-propose the env-var `FakeLlm` design recorded in `project_mock_resilience.md` — that topic is marked SUPERSEDED (2026-04-20); its URL-dispatcher replacement exercises the LLM path end-to-end and is unsuitable for walking deterministic widget/phase behaviour.

### Smoke result

<filled in during Task 5>
```

- [ ] **Step 3: Commit the memory update.**

```bash
git -C /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory \
  add project_agent_contract_tests.md
git -C /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory \
  commit -m "docs(memory): record onboarding deferral resolution + integration-test gap"
```

If the memory directory is not a git repo, skip the commit step — memory files persist to disk regardless.

---

### Task 5 — Sandbox deploy + log smoke

**Goal:** Run the procedure recorded in the topic file; capture the outcome.

**Prereq:** Tasks 1–4 merged to main, Leapp session active in account `771924376645`, region `us-east-1`.

**Files:**
- Create: `services/investor/onboarding-bff/scripts/smoke/copilotkit-minimal-turn.json`
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_agent_contract_tests.md`

- [ ] **Step 1: Capture a minimal CopilotKit turn body.**

This is a discovery step — the exact JSON shape depends on the `@copilotkit/runtime` version in use. Do not fabricate the body. Pick one of:

**Option A (preferred): capture from a live MFE request.** Start `onboarding-mfe` locally, open devtools Network, trigger the first turn of an onboarding conversation, and save the request body.

```bash
pnpm nx serve onboarding-mfe    # or the repo's local dev command; consult nx-workspace if unsure
# in another shell, after the MFE is serving:
mkdir -p services/investor/onboarding-bff/scripts/smoke
# Copy the request payload from browser devtools → Network tab → first POST against /api/copilotkit → "Copy as ... → Copy request body"
# Paste it into:
#   services/investor/onboarding-bff/scripts/smoke/copilotkit-minimal-turn.json
```

**Option B (fallback): derive from CopilotKit's own tests.** Grep `node_modules/@copilotkit/runtime` for a `GenerateCopilotResponse` mutation fixture and adapt it.

```bash
grep -rln 'GenerateCopilotResponse' node_modules/@copilotkit/runtime/dist 2>/dev/null | head
# Open the first hit; copy the request body used in their unit tests; save as the fixture.
```

**Validation:** after saving, run a dry invoke against the deployed runtime (Task 5 Step 3). If it returns 4xx with a schema error, the fixture is wrong — recapture via Option A.

Add `services/investor/onboarding-bff/scripts/smoke/README.md`:

```markdown
# Smoke Fixtures

`copilotkit-minimal-turn.json` — minimal CopilotKit request body accepted by
`@copilotkit/runtime`'s `CopilotRuntime.process()`. Captured on YYYY-MM-DD from
a live `apps/onboarding-mfe` request against the local dev proxy.

Regenerate when `@copilotkit/runtime` ships a major version bump or if the
smoke starts failing with a 4xx body-validation error.
```

Commit:

```bash
git add services/investor/onboarding-bff/scripts/smoke/copilotkit-minimal-turn.json \
        services/investor/onboarding-bff/scripts/smoke/README.md
git commit -m "chore(onboarding-bff): capture minimal CopilotKit body for deploy smoke"
```

- [ ] **Step 2: Deploy onboarding-bff to sandbox.**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=onboarding-bff`
Expected: deploy succeeds. Note the output for the `OnboardingBffStack/AgentRuntimeUrlParam` parameter — it should exist.

- [ ] **Step 3: Execute the smoke procedure from `project_agent_contract_tests.md` §Live-pipeline smoke.**

Run each command in order (steps 2–5 in that section). Capture every command's output.

- [ ] **Step 4: Confirm pass criteria.**

- `invoke-agent-runtime` returned HTTP 200 with non-empty `/tmp/onboarding-smoke.out`.
- `filter-log-events` returned ≥1 event matching `detail.correlationId = ${SESSION}`.
- The captured event detail has `detail-type = ONBOARDING_AGENT_INVOCATION_TRACED`, `envelope.status = success`, no `llm_error` in `envelope.errors`, `context.tenantId = smoke-tenant`.

If any criterion fails, do NOT mark Task 5 complete. Debug against the AgentRuntime's CloudWatch logs (log-group pattern typically `/aws/bedrock-agentcore/runtime/onboarding_agent`); common failure modes:
- 404 → `/invocations` not routing (Task 1 incomplete or undeployed).
- 200 but no event → header parse returning empty halves (check `x-amzn-bedrock-agentcore-runtime-session-id` forwarding).
- Event lands but `envelope.status = error` → graph or tool failure; capture the body for a follow-up fix.

- [ ] **Step 5: Record the smoke result in the topic file.**

Replace the `<filled in during Task 5>` placeholder in the `### Smoke result` subsection with the actual outcome, e.g.:

```markdown
### Smoke result

Run 2026-04-21, us-east-1, account 771924376645, prefix=dev.

- `invoke-agent-runtime` → HTTP 200, response body `/tmp/onboarding-smoke.out` had <N> bytes.
- EventBridge rule `onboarding-smoke-rule` captured **1** matching event within 10s.
- Event detail: `correlationId=<SESSION>`, `tenantId=smoke-tenant`, `envelope.status=success`, `llmCalls.length=<N>`, `errors=[]`.
- AgentCore path green; deferral closed.
```

Commit:

```bash
git -C /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory \
  add project_agent_contract_tests.md
git -C /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory \
  commit -m "docs(memory): record onboarding smoke result"
```

- [ ] **Step 6: Final verification — exit criteria check against spec §9.**

Confirm each item from the spec's exit criteria:

- [ ] `pnpm nx test onboarding-bff` green (Task 3 Step 1).
- [ ] `pnpm nx typecheck onboarding-bff` green (Task 3 Step 3 or equivalent build).
- [ ] `pnpm nx build onboarding-bff` green (Task 3 Step 4).
- [ ] `pnpm nx affected -t lint` green on changed paths (Task 3 Step 2 / Step 6).
- [ ] Sandbox deploy of onboarding-bff succeeded (Task 5 Step 2).
- [ ] Log smoke produced the expected event (Task 5 Step 4).
- [ ] `project_agent_contract_tests.md` has `## Resolution: onboarding (2026-04-21)` + smoke result + integration-test gap note; no onboarding entry remains as a raw deferral.

If every box is checked, the deferral is closed.

---

## Cross-cutting guidance

- **Commit cadence:** commit after each task, not batched at the end. Five commits expected (Tasks 1, 2, optionally 3, 4, 5 Step 1, 5 Step 5). Optional: squash Task 5's commits into one before PR if preferred.
- **Do not touch** `apps/e2e-feature-tests/**`, `memory/project_mock_resilience.md`, `agents/onboarding/graph.ts`, `src/agent/**`, or the frontend `apps/onboarding-mfe`. Changes there are out of scope per spec §4.2.
- **Tests stay in `test/` directory** — per `memory/feedback_test_convention.md`, never under `src/__tests__/`.
- **Verification before claiming done** — per `superpowers:verification-before-completion`: every "green" claim requires actual command output proving it.

## Series complete

Once Task 5 is green and committed, the agent-contract-tests series has zero open deferrals from Plan 3/3 related to onboarding. The Phase 6 operating-mode-authority deferral remains separately tracked and is untouched by this branch.
