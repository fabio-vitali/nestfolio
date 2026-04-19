# AgentCore Runtime Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire production traffic from the five advisory ingress Lambdas into the AgentCore Runtime containers via the Bedrock data-plane API, replacing today's unsigned-fetch placeholder. Invert SSM polarity so the runtime ARN is the default; keep mock injection working via `SsmOverrideFixture` + `MockApiFixture` for integration tests.

**Architecture:** Split the transport into two leaves and a dispatcher in `libs/agent-orchestrator/`. `invokeAgentCoreRuntime` uses `@aws-sdk/client-bedrock-agentcore` `InvokeAgentRuntimeCommand` (SigV4 via the SDK). `invokeMockRuntime` is a plain `fetch()` POST. `dispatchAgentInvocation` branches on whether the SSM-resolved target is an `arn:` or `https://` string. Each `service.stack.ts` defaults SSM to the AgentCore runtime ARN and grants `bedrock-agentcore:InvokeAgentRuntime` to its ingress handler. The in-process `agentNode` fallback in each `agent-service.ts` is removed: production always invokes the container; tests always invoke the mock URL the fixture installed.

**Tech Stack:** TypeScript, Node 20, AWS CDK with `@aws-cdk/aws-bedrock-agentcore-alpha`, `@aws-sdk/client-bedrock-agentcore`, Hono (in container), Nx, Jest, esbuild.

**Scope:** Five services — `advisory-narrative-ctrl`, `advisory-ctrl`, `investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`. All migrate in this PR (no deprecation policy in this codebase).

**Non-goals:**
- `onboarding-bff` — uses CopilotRuntime + LangGraphAgent in its own container, called directly from the frontend. Not affected by this plan.
- Streaming-response variant of `invokeAgentCoreRuntime` — request/response only for now (the five advisory agents are batch). The dispatcher API stays open to a future `invokeAgentCoreRuntimeStreaming` leaf without re-shaping the existing function.
- Plan 2's `AgentTraceEvent` emitter wiring (`docs/superpowers/plans/2026-04-19-agent-contract-tests-02-first-rollout.md`) — resumes after this lands. Do not edit that plan.

---

## File Structure

**New files in `libs/agent-orchestrator/`:**
- `src/invoke-agentcore.ts` — `invokeAgentCoreRuntime(arn, payload)`. SDK call, session-id header, stream-to-string response decode.
- `src/invoke-mock.ts` — `invokeMockRuntime(url, payload)`. Plain `fetch()` POST.
- `src/dispatch-runtime.ts` — `dispatchAgentInvocation(target, payload)`. Branches on input shape.
- `src/resolve-runtime-target.ts` — replaces `resolve-runtime-url.ts`. Returns the SSM string verbatim; throws on missing or `"DISABLED"`.
- `src/types.ts` — add `AgentInvocation` type (the structured envelope) and re-export.
- `test/invoke-agentcore.test.ts`
- `test/invoke-mock.test.ts`
- `test/dispatch-runtime.test.ts`
- `test/resolve-runtime-target.test.ts`
- `test/agent-server.test.ts`

**Files to modify in `libs/agent-orchestrator/`:**
- `src/agent-server.ts` — accept structured envelope; return agent result JSON directly (drop `{response, status}` wrapping).
- `src/index.ts` — replace `resolveAgentRuntimeUrl`/`invokeRemoteRuntime` exports with the new dispatcher + `AgentInvocation` type.
- `package.json` — add `@aws-sdk/client-bedrock-agentcore` runtime dep.

**Files to delete in `libs/agent-orchestrator/`:**
- `src/resolve-runtime-url.ts` — superseded by `resolve-runtime-target.ts`.

**Per-service modifications (×5):** for each of `advisory-narrative-ctrl`, `advisory-ctrl`, `investor-profile-ctrl`, `market-intelligence-ctrl`, `portfolio-engine-ctrl`:

- `src/agent-service.ts` — remove fallback, call dispatcher only.
- `src/service.stack.ts` — change SSM `stringValue` from `'DISABLED'` to the AgentCore runtime ARN (read off the construct); grant `bedrock-agentcore:InvokeAgentRuntime` on the runtime ARN to the ingress handler.
- `agents/<name>/server.ts` — accept structured envelope; pass through to graph; return result JSON directly.
- `agents/<name>/graph.ts` — `invoke<Name>` accepts `{tenantId, decisionId, upstreamOutputs}`.
- `test/mocks/mock-agent-runtime.ts` — accept structured envelope; return result JSON directly (no `{response, status}` wrapping).
- `test/integration/<service>.integration.test.ts` — change `restoreTo` from `'DISABLED'` to the runtime ARN read at fixture setup time via SSM `GetParameter`.
- Unit tests under `test/unit/` that today exercise the `agentNode` fallback path — switch to mocking the dispatcher.

---

## Phase 0: Verification & Dependencies

### Task 1: Verify `@aws-sdk/client-bedrock-agentcore` package and `InvokeAgentRuntimeCommand` shape

**Files:**
- Read-only investigation. No edits.

- [ ] **Step 1: Check the package exists on npm**

```bash
npm view @aws-sdk/client-bedrock-agentcore versions --json | tail -20
```

Expected: a list of versions ending in a recent semver (e.g. `3.700.x` or higher). If the registry returns 404, this entire plan changes — stop and surface the result before continuing.

- [ ] **Step 2: Inspect the command's input shape**

```bash
mkdir -p /tmp/agentcore-probe && cd /tmp/agentcore-probe && npm init -y >/dev/null && npm install @aws-sdk/client-bedrock-agentcore --silent
node -e "const m = require('@aws-sdk/client-bedrock-agentcore'); console.log(Object.keys(m).filter(k => k.includes('Invoke')));"
```

Expected: includes `InvokeAgentRuntimeCommand`. If not, search for the equivalent and update the plan's Phase 1 code samples accordingly.

- [ ] **Step 3: Confirm input field names**

```bash
node -e "const {InvokeAgentRuntimeCommand} = require('@aws-sdk/client-bedrock-agentcore'); const c = new InvokeAgentRuntimeCommand({}); console.log(JSON.stringify(c.input));"
grep -RIn 'agentRuntimeArn\|runtimeSessionId\|payload' /tmp/agentcore-probe/node_modules/@aws-sdk/client-bedrock-agentcore/dist-types/commands/InvokeAgentRuntimeCommand.d.ts | head -40
```

Expected: input contains `agentRuntimeArn: string`, `runtimeSessionId?: string`, `payload?: Uint8Array | Blob | ...` (Smithy blob types). Output contains a streaming `response` field. **Lock the exact field names from the .d.ts into a scratch note** — Phase 1's code samples assume these; if the SDK uses different names (e.g. `agentRuntimeIdentifier` instead of `agentRuntimeArn`) update Phase 1, Task 6 before continuing.

- [ ] **Step 4: Cleanup probe**

```bash
rm -rf /tmp/agentcore-probe
```

### Task 2: Verify `agentcore.Runtime` exposes the runtime ARN

**Files:**
- Read-only.

- [ ] **Step 1: Find the ARN getter on the alpha construct**

```bash
grep -RIn 'agentRuntimeArn\|runtimeArn\|attrAgentRuntimeArn' /Users/fabiovitali/WebstormProjects/nestfolio/node_modules/@aws-cdk/aws-bedrock-agentcore-alpha/lib/runtime.d.ts 2>&1 | head -20
```

Expected: a public readonly property — most likely `agentRuntimeArn` or a CFN attribute proxy. Note the property name in your scratch note.

- [ ] **Step 2: If no public getter, fall back to `Fn.getAtt` on the underlying L1**

If Step 1 returned nothing, search for the L1 construct:

```bash
grep -RIn 'CfnRuntime\|new agentcore.CfnRuntime' /Users/fabiovitali/WebstormProjects/nestfolio/node_modules/@aws-cdk/aws-bedrock-agentcore-alpha/lib/runtime.js 2>&1 | head -20
```

If only an L1 attr is available (e.g. `runtime.node.defaultChild` → `CfnRuntime` with `attrAgentRuntimeArn`), Phase 2 Task 15's code sample must use `(this.runtime.node.defaultChild as agentcore.CfnRuntime).attrAgentRuntimeArn`. Update accordingly.

### Task 3: Verify retry/fallback already wraps the agent inside each container

**Files:**
- Read-only.

- [ ] **Step 1: Inspect each container graph**

```bash
for f in services/advisory/{advisory-narrative-ctrl,advisory-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl}/agents/*/graph.ts; do
  echo "=== $f ==="
  grep -n 'withRetry\|withFallback\|withValidation\|createAgentNode' "$f"
done
```

Expected: each `graph.ts` already wraps `createAgentNode(...)` with `withRetry` and `withFallback` (verified for `advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:16-25`). If any service is missing the wrap, add a sub-task to Phase 3 for that service before deleting the in-process fallback.

### Task 4: Add `@aws-sdk/client-bedrock-agentcore` runtime dependency

**Files:**
- Modify: `libs/agent-orchestrator/package.json`

- [ ] **Step 1: Add the dep**

```bash
pnpm add @aws-sdk/client-bedrock-agentcore --filter @nestfolio/agent-orchestrator
```

- [ ] **Step 2: Confirm it lands in `dependencies` (not `devDependencies`)**

```bash
grep -A 3 '"dependencies"' libs/agent-orchestrator/package.json | head -10
```

Expected: `"@aws-sdk/client-bedrock-agentcore": "^3.x.x"` under `dependencies`. If pnpm placed it under `devDependencies`, move it manually — it must be bundled into the ingress Lambda.

- [ ] **Step 3: Commit**

```bash
git add libs/agent-orchestrator/package.json pnpm-lock.yaml
git commit -m "feat(agent-orchestrator): add @aws-sdk/client-bedrock-agentcore dep"
```

---

## Phase 1: agent-orchestrator lib refactor

### Task 5: Add `AgentInvocation` envelope type

**Files:**
- Modify: `libs/agent-orchestrator/src/types.ts`

- [ ] **Step 1: Append the type**

Open `libs/agent-orchestrator/src/types.ts` and append:

```ts
/**
 * Structured envelope every caller sends to an agent runtime — whether
 * the runtime is AgentCore (real) or an HTTPS mock URL (integration tests).
 *
 * `upstreamOutputs` is an opaque per-agent shape; each agent's graph.ts
 * decides how to consume it.
 */
export interface AgentInvocation {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly upstreamOutputs: Record<string, unknown>;
}
```

- [ ] **Step 2: Re-export from index.ts**

In `libs/agent-orchestrator/src/index.ts`, add `AgentInvocation` to the existing `export { ... } from './types';` block.

- [ ] **Step 3: Build to confirm types compile**

```bash
pnpm nx build agent-orchestrator
```

Expected: BUILD SUCCESS.

- [ ] **Step 4: Commit**

```bash
git add libs/agent-orchestrator/src/types.ts libs/agent-orchestrator/src/index.ts
git commit -m "feat(agent-orchestrator): add AgentInvocation envelope type"
```

### Task 6: Implement `invoke-agentcore.ts` (TDD)

**Files:**
- Create: `libs/agent-orchestrator/src/invoke-agentcore.ts`
- Create: `libs/agent-orchestrator/test/invoke-agentcore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-orchestrator/test/invoke-agentcore.test.ts`:

```ts
import { mockClient } from 'aws-sdk-client-mock';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { Readable } from 'stream';
import { sdkStreamMixin } from '@smithy/util-stream';
import { invokeAgentCoreRuntime } from '../src/invoke-agentcore';

describe('invokeAgentCoreRuntime', () => {
  const sdk = mockClient(BedrockAgentCoreClient);

  beforeEach(() => sdk.reset());

  it('invokes InvokeAgentRuntimeCommand with the structured envelope as a UTF-8 payload', async () => {
    const stream = sdkStreamMixin(Readable.from([Buffer.from(JSON.stringify({ ok: true }))]));
    sdk.on(InvokeAgentRuntimeCommand).resolves({ response: stream } as never);

    const result = await invokeAgentCoreRuntime<{ ok: boolean }>(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/foo',
      { tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 } },
    );

    expect(result).toEqual({ ok: true });
    const call = sdk.commandCalls(InvokeAgentRuntimeCommand)[0];
    expect(call.args[0].input.agentRuntimeArn).toBe(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/foo',
    );
    expect(call.args[0].input.runtimeSessionId).toBe('t1/d1');
    const sent = JSON.parse(new TextDecoder().decode(call.args[0].input.payload as Uint8Array));
    expect(sent).toEqual({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 } });
  });

  it('throws when the runtime returns no response stream', async () => {
    sdk.on(InvokeAgentRuntimeCommand).resolves({} as never);
    await expect(
      invokeAgentCoreRuntime('arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/foo', {
        tenantId: 't1', decisionId: 'd1', upstreamOutputs: {},
      }),
    ).rejects.toThrow('AgentCore runtime returned no response body');
  });
});
```

- [ ] **Step 2: Add test deps if missing**

```bash
pnpm add -D aws-sdk-client-mock @smithy/util-stream --filter @nestfolio/agent-orchestrator
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm nx test agent-orchestrator --testPathPattern=invoke-agentcore
```

Expected: FAIL — `Cannot find module '../src/invoke-agentcore'`.

- [ ] **Step 4: Write the implementation**

Create `libs/agent-orchestrator/src/invoke-agentcore.ts`:

```ts
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { AgentInvocation } from './types';

let cachedClient: BedrockAgentCoreClient | undefined;

function getClient(): BedrockAgentCoreClient {
  if (!cachedClient) {
    cachedClient = new BedrockAgentCoreClient({});
  }
  return cachedClient;
}

async function streamToString(body: unknown): Promise<string> {
  if (!body) throw new Error('AgentCore runtime returned no response body');
  // SDK stream types expose transformToString() via the smithy stream mixin.
  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === 'function') {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }
  // Fallback for raw Node streams.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Invoke an AgentCore Runtime via the Bedrock data-plane API.
 *
 * `runtimeSessionId` is set to `${tenantId}/${decisionId}` so memory scopes
 * per-decision and downstream trace traps can correlate without parsing the body.
 *
 * Streaming responses are intentionally unsupported here — the five advisory
 * agents are batch. A future streaming variant should live in a sibling file
 * (`invoke-agentcore-streaming.ts`) so this function stays request/response.
 */
export async function invokeAgentCoreRuntime<T>(
  agentRuntimeArn: string,
  payload: AgentInvocation,
): Promise<T> {
  const client = getClient();
  const runtimeSessionId = `${payload.tenantId}/${payload.decisionId}`;
  const body = new TextEncoder().encode(JSON.stringify(payload));

  const result = await client.send(new InvokeAgentRuntimeCommand({
    agentRuntimeArn,
    runtimeSessionId,
    payload: body,
  }));

  const text = await streamToString(result.response);
  return JSON.parse(text) as T;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm nx test agent-orchestrator --testPathPattern=invoke-agentcore
```

Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/src/invoke-agentcore.ts libs/agent-orchestrator/test/invoke-agentcore.test.ts libs/agent-orchestrator/package.json
git commit -m "feat(agent-orchestrator): add invokeAgentCoreRuntime SDK transport"
```

### Task 7: Implement `invoke-mock.ts` (TDD)

**Files:**
- Create: `libs/agent-orchestrator/src/invoke-mock.ts`
- Create: `libs/agent-orchestrator/test/invoke-mock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-orchestrator/test/invoke-mock.test.ts`:

```ts
import { invokeMockRuntime } from '../src/invoke-mock';

describe('invokeMockRuntime', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs the structured envelope as JSON and returns the parsed response', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await invokeMockRuntime<{ ok: boolean }>(
      'https://mock.example.com/invocations',
      { tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 } },
    );

    expect(result).toEqual({ ok: true });
    expect(captured?.url).toBe('https://mock.example.com/invocations');
    expect(captured?.init?.method).toBe('POST');
    expect(JSON.parse(captured?.init?.body as string)).toEqual({
      tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 },
    });
  });

  it('throws when the mock returns a non-2xx status', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as typeof fetch;
    await expect(
      invokeMockRuntime('https://mock.example.com', {
        tenantId: 't1', decisionId: 'd1', upstreamOutputs: {},
      }),
    ).rejects.toThrow('Mock agent runtime returned 500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test agent-orchestrator --testPathPattern=invoke-mock
```

Expected: FAIL — `Cannot find module '../src/invoke-mock'`.

- [ ] **Step 3: Write the implementation**

Create `libs/agent-orchestrator/src/invoke-mock.ts`:

```ts
import type { AgentInvocation } from './types';

/**
 * Invoke an HTTPS mock agent runtime (Lambda Function URL) via plain fetch.
 *
 * Used by integration tests after `SsmOverrideFixture` redirects the SSM
 * runtime-target parameter to a `MockApiFixture`-deployed URL. Production
 * never hits this branch because production SSM holds an `arn:` value.
 */
export async function invokeMockRuntime<T>(url: string, payload: AgentInvocation): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Mock agent runtime returned ${res.status}: ${await res.text()}`);
  }
  return await res.json() as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test agent-orchestrator --testPathPattern=invoke-mock
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/invoke-mock.ts libs/agent-orchestrator/test/invoke-mock.test.ts
git commit -m "feat(agent-orchestrator): add invokeMockRuntime fetch transport"
```

### Task 8: Implement `dispatch-runtime.ts` (TDD)

**Files:**
- Create: `libs/agent-orchestrator/src/dispatch-runtime.ts`
- Create: `libs/agent-orchestrator/test/dispatch-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-orchestrator/test/dispatch-runtime.test.ts`:

```ts
import { dispatchAgentInvocation } from '../src/dispatch-runtime';

jest.mock('../src/invoke-agentcore', () => ({
  invokeAgentCoreRuntime: jest.fn(),
}));
jest.mock('../src/invoke-mock', () => ({
  invokeMockRuntime: jest.fn(),
}));

import { invokeAgentCoreRuntime } from '../src/invoke-agentcore';
import { invokeMockRuntime } from '../src/invoke-mock';

describe('dispatchAgentInvocation', () => {
  const payload = { tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} };

  beforeEach(() => {
    (invokeAgentCoreRuntime as jest.Mock).mockReset();
    (invokeMockRuntime as jest.Mock).mockReset();
  });

  it('routes arn: targets to invokeAgentCoreRuntime', async () => {
    (invokeAgentCoreRuntime as jest.Mock).mockResolvedValue({ via: 'agentcore' });
    const result = await dispatchAgentInvocation(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/foo',
      payload,
    );
    expect(result).toEqual({ via: 'agentcore' });
    expect(invokeAgentCoreRuntime).toHaveBeenCalledTimes(1);
    expect(invokeMockRuntime).not.toHaveBeenCalled();
  });

  it('routes https:// targets to invokeMockRuntime', async () => {
    (invokeMockRuntime as jest.Mock).mockResolvedValue({ via: 'mock' });
    const result = await dispatchAgentInvocation('https://mock.example.com', payload);
    expect(result).toEqual({ via: 'mock' });
    expect(invokeMockRuntime).toHaveBeenCalledTimes(1);
    expect(invokeAgentCoreRuntime).not.toHaveBeenCalled();
  });

  it('throws on unrecognized targets', async () => {
    await expect(dispatchAgentInvocation('DISABLED', payload)).rejects.toThrow(
      'Unrecognized agent runtime target: DISABLED',
    );
    await expect(dispatchAgentInvocation('http://insecure.example.com', payload))
      .rejects.toThrow('Unrecognized agent runtime target: http://insecure.example.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test agent-orchestrator --testPathPattern=dispatch-runtime
```

Expected: FAIL — `Cannot find module '../src/dispatch-runtime'`.

- [ ] **Step 3: Write the implementation**

Create `libs/agent-orchestrator/src/dispatch-runtime.ts`:

```ts
import type { AgentInvocation } from './types';
import { invokeAgentCoreRuntime } from './invoke-agentcore';
import { invokeMockRuntime } from './invoke-mock';

/**
 * Dispatch an agent invocation to the right transport based on the SSM-resolved
 * target string.
 *
 *   arn:...      → AgentCore data-plane SDK call (production / sandbox)
 *   https://...  → plain fetch to a MockApiFixture-deployed Function URL (tests)
 *   anything else (incl. "DISABLED") → throws. The SSM polarity inversion makes
 *                                       absent configuration a hard failure, not
 *                                       a silent in-process fallback.
 */
export async function dispatchAgentInvocation<T>(
  target: string,
  payload: AgentInvocation,
): Promise<T> {
  if (target.startsWith('arn:')) {
    return invokeAgentCoreRuntime<T>(target, payload);
  }
  if (target.startsWith('https://')) {
    return invokeMockRuntime<T>(target, payload);
  }
  throw new Error(`Unrecognized agent runtime target: ${target}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test agent-orchestrator --testPathPattern=dispatch-runtime
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/dispatch-runtime.ts libs/agent-orchestrator/test/dispatch-runtime.test.ts
git commit -m "feat(agent-orchestrator): add dispatchAgentInvocation router"
```

### Task 9: Replace `resolve-runtime-url.ts` with `resolve-runtime-target.ts` (TDD)

**Files:**
- Delete: `libs/agent-orchestrator/src/resolve-runtime-url.ts`
- Create: `libs/agent-orchestrator/src/resolve-runtime-target.ts`
- Create: `libs/agent-orchestrator/test/resolve-runtime-target.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-orchestrator/test/resolve-runtime-target.test.ts`:

```ts
import { resolveAgentRuntimeTarget } from '../src/resolve-runtime-target';

describe('resolveAgentRuntimeTarget', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('throws when AGENT_RUNTIME_URL_PARAM is not set', async () => {
    delete process.env.AGENT_RUNTIME_URL_PARAM;
    await expect(resolveAgentRuntimeTarget()).rejects.toThrow(
      'AGENT_RUNTIME_URL_PARAM env var is required',
    );
  });

  it('returns the SSM value verbatim when the extension responds', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/foo/bar';
    process.env.AWS_SESSION_TOKEN = 'tok';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ Parameter: { Value: 'arn:aws:bedrock-agentcore:us-east-1:1:runtime/x' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const target = await resolveAgentRuntimeTarget();
    expect(target).toBe('arn:aws:bedrock-agentcore:us-east-1:1:runtime/x');
  });

  it('throws when SSM holds the DISABLED sentinel', async () => {
    process.env.AGENT_RUNTIME_URL_PARAM = '/foo/bar';
    process.env.AWS_SESSION_TOKEN = 'tok';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ Parameter: { Value: 'DISABLED' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await expect(resolveAgentRuntimeTarget()).rejects.toThrow(
      'agent runtime target is DISABLED',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test agent-orchestrator --testPathPattern=resolve-runtime-target
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `libs/agent-orchestrator/src/resolve-runtime-target.ts`:

```ts
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'agent-orchestrator' });

/**
 * Resolve the agent runtime target string from SSM via the Parameters and
 * Secrets Lambda Extension. Returns the raw value — the dispatcher decides
 * whether it's an AgentCore ARN or a mock HTTPS URL.
 *
 * No application-level cache — the Parameters and Secrets Extension already
 * caches with a configurable TTL. Adding a second cache layer would prevent
 * SsmOverrideFixture from redirecting warm Lambda instances to mocks.
 *
 * Throws if the env var is missing, if SSM lookup fails, or if the resolved
 * value is the literal "DISABLED" sentinel — there is no in-process fallback
 * any more, so misconfiguration must surface as an error, not silently degrade.
 */
export async function resolveAgentRuntimeTarget(): Promise<string> {
  const paramName = process.env.AGENT_RUNTIME_URL_PARAM;
  if (!paramName) {
    throw new Error('AGENT_RUNTIME_URL_PARAM env var is required');
  }

  const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
  const token = process.env.AWS_SESSION_TOKEN!;

  const res = await fetch(
    `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
  );
  if (!res.ok) {
    throw new Error(`SSM lookup for ${paramName} returned ${res.status}`);
  }
  const data = await res.json() as { Parameter?: { Value?: string } };
  const value = data.Parameter?.Value?.trim() ?? '';
  if (value === '' || value === 'DISABLED') {
    logger.error('resolveAgentRuntimeTarget: agent runtime target is DISABLED', { paramName });
    throw new Error(`agent runtime target is DISABLED for ${paramName}`);
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test agent-orchestrator --testPathPattern=resolve-runtime-target
```

Expected: 3 PASS.

- [ ] **Step 5: Delete the old file**

```bash
rm libs/agent-orchestrator/src/resolve-runtime-url.ts
```

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/src/resolve-runtime-target.ts libs/agent-orchestrator/test/resolve-runtime-target.test.ts libs/agent-orchestrator/src/resolve-runtime-url.ts
git commit -m "feat(agent-orchestrator): replace resolve-runtime-url with target resolver (no fallback)"
```

### Task 10: Update `agent-server.ts` to accept the structured envelope (TDD)

**Files:**
- Modify: `libs/agent-orchestrator/src/agent-server.ts`
- Create: `libs/agent-orchestrator/test/agent-server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-orchestrator/test/agent-server.test.ts`:

```ts
import { createAgentServer } from '../src/agent-server';

describe('createAgentServer', () => {
  it('passes the structured envelope and session-id header to the handler and returns its JSON', async () => {
    const handler = jest.fn().mockResolvedValue({ summary: 'ok', confidence: 0.9 });
    const app = createAgentServer(handler);

    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-amzn-bedrock-agentcore-runtime-session-id': 't1/d1',
      },
      body: JSON.stringify({
        tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 },
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: 'ok', confidence: 0.9 });
    expect(handler).toHaveBeenCalledWith(
      { tenantId: 't1', decisionId: 'd1', upstreamOutputs: { score: 7 } },
      't1/d1',
    );
  });

  it('returns 500 with {error} on handler throw', async () => {
    const app = createAgentServer(async () => { throw new Error('boom'); });
    const res = await app.request('/invocations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 't1', decisionId: 'd1', upstreamOutputs: {} }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  it('answers GET /ping with healthy', async () => {
    const app = createAgentServer(async () => ({}));
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'healthy' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test agent-orchestrator --testPathPattern=agent-server
```

Expected: FAIL — handler signature mismatch and response shape mismatch.

- [ ] **Step 3: Replace the implementation**

Overwrite `libs/agent-orchestrator/src/agent-server.ts`:

```ts
import { Hono } from 'hono';
import type { AgentInvocation } from './types';

export type AgentHandler = (
  payload: AgentInvocation,
  sessionId: string,
) => Promise<unknown>;

/**
 * Build the Hono app served inside an AgentCore container.
 *
 * Contract:
 * - POST /invocations expects a JSON body shaped as `AgentInvocation`.
 * - The handler returns the agent's structured result; the server JSON-encodes
 *   it directly with no envelope wrapping. The mock runtime returns the same
 *   shape so callers can't tell the two transports apart.
 * - Errors → 500 with `{ error: message }`.
 */
export function createAgentServer(handler: AgentHandler) {
  const app = new Hono();

  app.get('/ping', (c) => c.json({ status: 'healthy' }));

  app.post('/invocations', async (c) => {
    const payload = await c.req.json() as AgentInvocation;
    const sessionId =
      c.req.header('x-amzn-bedrock-agentcore-runtime-session-id') ?? '';
    try {
      const response = await handler(payload, sessionId);
      return c.json(response as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test agent-orchestrator --testPathPattern=agent-server
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/agent-orchestrator/src/agent-server.ts libs/agent-orchestrator/test/agent-server.test.ts
git commit -m "feat(agent-orchestrator): agent-server accepts structured envelope, returns result JSON"
```

### Task 11: Update `libs/agent-orchestrator/src/index.ts` exports

**Files:**
- Modify: `libs/agent-orchestrator/src/index.ts`

- [ ] **Step 1: Replace the bottom-of-file exports**

In `libs/agent-orchestrator/src/index.ts`, find this line:

```ts
export { resolveAgentRuntimeUrl, invokeRemoteRuntime } from './resolve-runtime-url';
```

Replace with:

```ts
export { resolveAgentRuntimeTarget } from './resolve-runtime-target';
export { dispatchAgentInvocation } from './dispatch-runtime';
export { invokeAgentCoreRuntime } from './invoke-agentcore';
export { invokeMockRuntime } from './invoke-mock';
```

- [ ] **Step 2: Build the lib**

```bash
pnpm nx build agent-orchestrator
```

Expected: BUILD SUCCESS.

- [ ] **Step 3: Run full lib test suite**

```bash
pnpm nx test agent-orchestrator
```

Expected: ALL PASS (new + pre-existing tests).

- [ ] **Step 4: Commit**

```bash
git add libs/agent-orchestrator/src/index.ts
git commit -m "feat(agent-orchestrator): export dispatcher + new transports, drop resolveAgentRuntimeUrl"
```

### Task 12: Confirm no other workspace code imports the removed symbols

**Files:**
- Read-only.

- [ ] **Step 1: Grep**

```bash
grep -RIn 'resolveAgentRuntimeUrl\|invokeRemoteRuntime' --include='*.ts' .
```

Expected: matches **only** in the five `services/advisory/*/src/agent-service.ts` files (which Phase 2 + 3 will update). If any other consumer turns up, add a sub-task in this plan to update it before Phase 2.

---

## Phase 2: Canonical service migration — `advisory-narrative-ctrl`

This phase migrates one service end-to-end. Phase 3 repeats the same pattern for the four siblings, using this one as the template.

### Task 13: Update container graph signature

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`

- [ ] **Step 1: Change the `invokeNarrative` signature**

In `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`, replace lines 46–78 (`export async function invokeNarrative ... }`) with:

```ts
import type { AgentInvocation } from '@nestfolio/agent-orchestrator';

export async function invokeNarrative(
  payload: AgentInvocation,
): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(payload.tenantId, payload.decisionId);
  const kb = buildKBClient();

  // 1. Read upstream decision context from memory
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream decision context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 2. Retrieve relevant communication templates from KB
  let kbContext = '';
  if (kb) {
    const seed = JSON.stringify(payload.upstreamOutputs);
    const kbResults = await kb.retrieve(seed, 3);
    if (kbResults.length > 0) {
      kbContext = `\n\nKnowledge base context:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 3. Invoke agent with enriched input. The LLM-facing prompt is built from
  //    the structured envelope; we serialize upstreamOutputs verbatim so the
  //    agent has full context.
  const enrichedInput =
    `Decision ${payload.decisionId} context: ${JSON.stringify(payload.upstreamOutputs)}` +
    upstreamContext + kbContext;
  const result = await agentNode({ input: enrichedInput });

  // 4. Write output to memory
  await session.writeAgentOutput(result);

  return result;
}
```

- [ ] **Step 2: Verify graph build**

```bash
pnpm nx build advisory-narrative-ctrl
```

Expected: BUILD SUCCESS (the per-service build target compiles `agents/` too via the AgentRuntime esbuild step at deploy; here we just validate TS).

### Task 14: Update container `server.ts`

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts`

- [ ] **Step 1: Replace the file**

Overwrite `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/server.ts`:

```ts
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeNarrative } from './graph';

const app = createAgentServer(async (payload) => invokeNarrative(payload));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('advisory-narrative-ctrl agent runtime listening on 0.0.0.0:8080');
```

The `sessionId` argument is unused here — the structured payload already carries `tenantId` + `decisionId`. Keep the parameter name in the lib signature so future agents (e.g. conversational ones) can use it.

### Task 15: Migrate `agent-service.ts` to the dispatcher

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/agent-service.ts`

- [ ] **Step 1: Replace the file**

Overwrite `services/advisory/advisory-narrative-ctrl/src/agent-service.ts`:

```ts
import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { buildCdcItem, type RequestContext } from '@nestfolio/event-processor';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export const createAgentService = (deps: AgentServiceDeps) => {
  return {
    runPipeline: async (event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const invocationId = randomUUID();
      const startedAt = new Date().toISOString();
      const subject = (event.subject ?? event) as Record<string, unknown>;
      const ctx = (event.context ?? subject) as RequestContext;
      const decisionId = subject.decisionId as string;
      const tenantId = ctx.tenantId;

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('AgentInvocation',
          { pk: `DECISION#${decisionId}`, sk: `INV#${invocationId}` },
          ctx,
          { invocationId, decisionId, agentName: 'explainability', status: 'IN_PROGRESS', startedAt },
        ),
      }));

      const target = await resolveAgentRuntimeTarget();
      const result = await dispatchAgentInvocation<Record<string, unknown>>(target, {
        tenantId,
        decisionId,
        upstreamOutputs: (subject.context ?? subject.upstreamOutputs ?? {}) as Record<string, unknown>,
      });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('ReasoningOutput',
          { pk: `DECISION#${decisionId}`, sk: `REASONING#${invocationId}` },
          ctx,
          { invocationId, decisionId, ...result, createdAt: completedAt },
        ),
      }));

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('AgentInvocation',
          { pk: `DECISION#${decisionId}`, sk: `INV#${invocationId}` },
          ctx,
          { invocationId, decisionId, agentName: 'explainability', status: 'COMPLETED', startedAt, completedAt, durationMs },
        ),
      }));

      return { decisionId, ...result, metadata: { durationMs, modelTier: 'sonnet' } };
    },
  };
};
```

Note: the imports of `createAgentNode`, `withRetry`, `withFallback`, `explainabilityConfig` are gone — they remain wired inside the container's `graph.ts` (verified Task 3).

### Task 16: Update unit tests for `agent-service.ts`

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/test/unit/agent-service.test.ts` (or `services/advisory/advisory-narrative-ctrl/test/agent-service.test.ts` — confirm location with `find services/advisory/advisory-narrative-ctrl/test -name 'agent-service.test.*'`).

- [ ] **Step 1: Read the existing test to understand its mocking shape**

```bash
find services/advisory/advisory-narrative-ctrl/test -name 'agent-service.test.*'
```

- [ ] **Step 2: Replace the in-process `agentNode`/`createAgentNode` mocks with dispatcher mocks**

In the test file, replace any `jest.mock('@nestfolio/agent-orchestrator', ...)` block with:

```ts
jest.mock('@nestfolio/agent-orchestrator', () => ({
  resolveAgentRuntimeTarget: jest.fn().mockResolvedValue(
    'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/test',
  ),
  dispatchAgentInvocation: jest.fn().mockResolvedValue({
    summary: 'unit-test summary',
    rationale: 'unit-test rationale',
    keyFactors: [],
    tone: 'neutral',
    wordCount: 0,
    confidence: 0.5,
  }),
}));
```

Then update assertions: instead of asserting `createAgentNode` was called, assert `dispatchAgentInvocation` was called with the structured envelope:

```ts
import { dispatchAgentInvocation } from '@nestfolio/agent-orchestrator';
// ...
expect(dispatchAgentInvocation).toHaveBeenCalledWith(
  expect.stringMatching(/^arn:/),
  expect.objectContaining({
    tenantId: expect.any(String),
    decisionId: expect.any(String),
    upstreamOutputs: expect.any(Object),
  }),
);
```

- [ ] **Step 3: Run unit tests**

```bash
pnpm nx test advisory-narrative-ctrl
```

Expected: PASS. If pre-existing tests for `withRetry`/`withFallback` integration through `agent-service` exist, delete them — that surface moves to the container's own tests.

### Task 17: Update integration test mock

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/test/mocks/mock-agent-runtime.ts`

- [ ] **Step 1: Replace the file**

Overwrite `services/advisory/advisory-narrative-ctrl/test/mocks/mock-agent-runtime.ts`:

```ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for advisory-narrative-ctrl integration tests.
 *
 * Mirrors the real container's contract:
 * - Body is `{ tenantId, decisionId, upstreamOutputs }`.
 * - Response is the agent result JSON directly (no `{response, status}` envelope).
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const _payload = event.body ? JSON.parse(event.body) : {}; // parse to validate shape
  void _payload;
  return json(200, {
    summary: 'Mock: Your portfolio has been rebalanced to align with your growth objectives.',
    rationale: 'Mock rationale: Market conditions support increased equity exposure.',
    keyFactors: ['Moderate risk tolerance', 'Long-term growth goal', 'Low volatility environment'],
    tone: 'confident',
    wordCount: 18,
    confidence: 0.88,
  });
}
```

- [ ] **Step 2: Rebuild the zip artifact**

```bash
pnpm nx run advisory-narrative-ctrl:build-mock
```

Expected: `services/advisory/advisory-narrative-ctrl/test/mocks/mock-agent-runtime.zip` rebuilt. The `.zip` is gitignored — only the `.ts` source needs to be committed.

### Task 18: Update `service.stack.ts` SSM polarity + IAM grant

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`

- [ ] **Step 1: Replace the SSM block and add the IAM grant**

In `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`:

(a) After the `new AgentRuntime(this, 'AgentRuntime', { ... })` call (currently line 90, ends at line 101), capture the construct in a const so the runtime ARN is reachable. Change:

```ts
new AgentRuntime(this, 'AgentRuntime', {
  // ...existing props...
});
```

to:

```ts
const agentRuntime = new AgentRuntime(this, 'AgentRuntime', {
  // ...existing props...
});
```

(b) Replace the existing `StringParameter` block (lines 17–21) — which currently sits ABOVE the AgentRuntime construct — and move it BELOW the AgentRuntime construct so the runtime exists before its ARN is referenced. Insert after the `agentRuntime` const:

```ts
// SSM-published runtime target. Defaults to the real AgentCore runtime ARN;
// integration tests redirect via SsmOverrideFixture to a Function URL.
const runtimeArn = agentRuntime.runtime.agentRuntimeArn; // Phase 0 verified this getter
const agentRuntimeUrlParam = new StringParameter(this, 'AgentRuntimeUrlParam', {
  parameterName: `/nestfolio/${props.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`,
  stringValue: runtimeArn,
});
```

If Phase 0 Task 2 found there is no public `agentRuntimeArn` getter, replace `agentRuntime.runtime.agentRuntimeArn` with:

```ts
const runtimeArn = (agentRuntime.runtime.node.defaultChild as agentcore.CfnRuntime).attrAgentRuntimeArn;
```

and add `import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';` at the top of the file (it isn't currently imported in this stack file, only by the construct itself).

(c) Below the SSM param creation, add the IAM grant for the ingress handler:

```ts
ingress.handler.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['bedrock-agentcore:InvokeAgentRuntime'],
  resources: [runtimeArn],
}));
```

(d) Confirm the existing two lines remain (they were already correct):

```ts
ingress.handler.addEnvironment('AGENT_RUNTIME_URL_PARAM', agentRuntimeUrlParam.parameterName);
agentRuntimeUrlParam.grantRead(ingress.handler);
```

These currently appear at lines 41–42 BEFORE the AgentRuntime construct — relocate them AFTER the new SSM param block since `agentRuntimeUrlParam` is no longer in scope at that point.

- [ ] **Step 2: Synth the stack**

```bash
pnpm nx synth advisory-narrative-ctrl
```

Expected: SYNTH SUCCESS. Inspect the output to confirm: (i) the SSM parameter has a CFN `Ref` / `Fn::GetAtt` to the runtime resource as its `Value`, not the literal `"DISABLED"`; (ii) the ingress role has an `IAM::Policy` statement allowing `bedrock-agentcore:InvokeAgentRuntime` on the runtime ARN.

### Task 19: Update integration test `restoreTo` to the runtime ARN

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`

- [ ] **Step 1: Replace the SsmOverrideFixture block**

In `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`, find lines 34–39:

```ts
const ssmOverride = new SsmOverrideFixture(ctx);
await ssmOverride.override({
  paramName: `/nestfolio/${ctx.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`,
  testValue: mockUrl,
  restoreTo: 'DISABLED',
});
```

Replace with a SSM read for the canonical value:

```ts
const paramName = `/nestfolio/${ctx.prefix}-advisory-narrative-ctrl/agent/runtimeUrl`;
const ssm = new SSMClient({ region: ctx.region });
const canonical = await ssm.send(new GetParameterCommand({ Name: paramName }));
const restoreTo = canonical.Parameter!.Value!;
if (!restoreTo.startsWith('arn:')) {
  throw new Error(
    `Expected canonical SSM value to be an AgentCore runtime ARN, got: ${restoreTo}. ` +
    `Stack may not be deployed, or a prior test run left a mock URL behind. ` +
    `Re-deploy advisory-narrative-ctrl before re-running integration tests.`,
  );
}

const ssmOverride = new SsmOverrideFixture(ctx);
await ssmOverride.override({ paramName, testValue: mockUrl, restoreTo });
```

Add the imports at the top of the file:

```ts
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
```

(the existing `SsmOverrideFixture` import already pulls in the SSM client transitively at runtime, but the test file needs its own direct import for the read).

- [ ] **Step 2: Lint**

```bash
pnpm nx lint advisory-narrative-ctrl
```

### Task 20: End-to-end build + commit Phase 2

- [ ] **Step 1: Full per-service test pass**

```bash
pnpm nx run advisory-narrative-ctrl:test
pnpm nx run advisory-narrative-ctrl:build
pnpm nx run advisory-narrative-ctrl:build-mock
```

Expected: ALL PASS.

- [ ] **Step 2: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl
git commit -m "feat(advisory-narrative-ctrl): migrate to AgentCore data-plane transport

- agent-service.ts uses dispatchAgentInvocation, no more in-process fallback
- service.stack.ts SSM defaults to runtime ARN, ingress granted InvokeAgentRuntime
- container server.ts + graph.ts accept structured AgentInvocation envelope
- mock runtime + integration test updated to new restoreTo + payload shape"
```

---

## Phase 3: Propagate to the four sibling services

For each service, repeat the Phase 2 task pattern. The only per-service variation is: the agent name string, the `MODEL_ID` env vars, and any agent-specific KB/Memory wiring. The transport changes are identical.

### Task 21: `advisory-ctrl`

**Files:**
- Modify: `services/advisory/advisory-ctrl/src/agent-service.ts`
- Modify: `services/advisory/advisory-ctrl/src/service.stack.ts`
- Modify: `services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts`
- Modify: `services/advisory/advisory-ctrl/agents/decision-lifecycle/graph.ts`
- Modify: `services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts`
- Modify: `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts`
- Modify: `services/advisory/advisory-ctrl/test/**` (any unit tests that referenced the in-process fallback)

- [ ] **Step 1: Apply Phase 2 Tasks 13–19 to advisory-ctrl**

Container directory is `agents/decision-lifecycle/`. The graph's exported function name will differ (likely `invokeDecisionLifecycle` or similar) — confirm by reading the file and apply the same envelope-accepting refactor.

- [ ] **Step 2: Tests + build**

```bash
pnpm nx run advisory-ctrl:test
pnpm nx run advisory-ctrl:build
pnpm nx run advisory-ctrl:build-mock
pnpm nx synth advisory-ctrl
```

Expected: ALL PASS / SYNTH SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-ctrl
git commit -m "feat(advisory-ctrl): migrate to AgentCore data-plane transport"
```

### Task 22: `investor-profile-ctrl`

**Files:**
- Modify: `services/advisory/investor-profile-ctrl/src/agent-service.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts`
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/server.ts`
- Modify: `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/mocks/mock-agent-runtime.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/**` (unit tests that referenced fallback)

- [ ] **Step 1: Apply Phase 2 Tasks 13–19**

- [ ] **Step 2: Tests + build**

```bash
pnpm nx run investor-profile-ctrl:test
pnpm nx run investor-profile-ctrl:build
pnpm nx run investor-profile-ctrl:build-mock
pnpm nx synth investor-profile-ctrl
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/investor-profile-ctrl
git commit -m "feat(investor-profile-ctrl): migrate to AgentCore data-plane transport"
```

### Task 23: `market-intelligence-ctrl`

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/src/agent-service.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/server.ts`
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/mocks/mock-agent-runtime.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/**` (unit tests that referenced fallback)

- [ ] **Step 1: Apply Phase 2 Tasks 13–19**

- [ ] **Step 2: Tests + build**

```bash
pnpm nx run market-intelligence-ctrl:test
pnpm nx run market-intelligence-ctrl:build
pnpm nx run market-intelligence-ctrl:build-mock
pnpm nx synth market-intelligence-ctrl
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/market-intelligence-ctrl
git commit -m "feat(market-intelligence-ctrl): migrate to AgentCore data-plane transport"
```

### Task 24: `portfolio-engine-ctrl`

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/agent-service.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/server.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/mocks/mock-agent-runtime.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/**` (unit tests that referenced fallback)

- [ ] **Step 1: Apply Phase 2 Tasks 13–19**

- [ ] **Step 2: Tests + build**

```bash
pnpm nx run portfolio-engine-ctrl:test
pnpm nx run portfolio-engine-ctrl:build
pnpm nx run portfolio-engine-ctrl:build-mock
pnpm nx synth portfolio-engine-ctrl
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl
git commit -m "feat(portfolio-engine-ctrl): migrate to AgentCore data-plane transport"
```

### Task 25: Workspace-wide affected check

- [ ] **Step 1: Run affected test + lint**

```bash
pnpm nx affected -t test --base=main
pnpm nx affected -t lint --base=main
```

Expected: ALL PASS. If a non-advisory project surfaces (e.g. a downstream consumer of `@nestfolio/agent-orchestrator`), investigate before continuing — Phase 1 Task 12 should have caught this; if not, fix and add a follow-up sub-task here.

---

## Phase 4: Deploy & verify against sandbox

### Task 26: Synth all five stacks together

- [ ] **Step 1: Run synth for all five**

```bash
for svc in advisory-narrative-ctrl advisory-ctrl investor-profile-ctrl market-intelligence-ctrl portfolio-engine-ctrl; do
  pnpm nx synth "$svc" || { echo "FAIL: $svc"; exit 1; }
done
```

Expected: SYNTH SUCCESS for all five.

### Task 27: Deploy to sandbox

- [ ] **Step 1: Deploy targeted services**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev \
  --services=advisory-narrative-ctrl,advisory-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl
```

Expected: 5/5 deployments succeed. AgentCore runtimes will rebuild + push their containers (~5–10 min per service).

- [ ] **Step 2: Verify SSM polarity flipped**

```bash
for svc in advisory-narrative-ctrl advisory-ctrl investor-profile-ctrl market-intelligence-ctrl portfolio-engine-ctrl; do
  echo "=== $svc ==="
  aws ssm get-parameter --name "/nestfolio/dev-$svc/agent/runtimeUrl" --query 'Parameter.Value' --output text
done
```

Expected: each value is an `arn:aws:bedrock-agentcore:us-east-1:771924376645:runtime/...` string. None should be `DISABLED`.

- [ ] **Step 3: Verify all five runtimes are READY**

```bash
aws bedrock-agentcore-control list-agent-runtimes --query 'agentRuntimes[?contains(agentRuntimeName, `dev`)].[agentRuntimeName,status]' --output table
```

Expected: all five show `READY`.

### Task 28: Run integration tests against sandbox

- [ ] **Step 1: Run the five integration suites**

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run-many -t test-integration -p advisory-narrative-ctrl,advisory-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl
```

Expected: ALL PASS. Each suite deploys a `MockApiFixture` Function URL and overrides SSM via `SsmOverrideFixture`. The `restoreTo` value will be read from SSM (the runtime ARN) before each suite runs.

- [ ] **Step 2: Confirm SSM was restored after the suites finished**

```bash
for svc in advisory-narrative-ctrl advisory-ctrl investor-profile-ctrl market-intelligence-ctrl portfolio-engine-ctrl; do
  echo "=== $svc ==="
  aws ssm get-parameter --name "/nestfolio/dev-$svc/agent/runtimeUrl" --query 'Parameter.Value' --output text
done
```

Expected: each value is back to its `arn:` ARN. **If any value is still an `https://` URL, a fixture leaked — investigate before continuing.** (`SsmOverrideFixture` will also throw on next run if it detects corruption, but catch it here too.)

### Task 29: Smoke test against the real runtime (no mock)

- [ ] **Step 1: Drive a single decision through the live AgentCore container**

```bash
# Pick advisory-narrative-ctrl as the canary. Send GENERATE_NARRATIVE directly.
DECISION_ID="smoke-$(date +%s)"
TENANT_ID="smoke-tenant"
aws events put-events --entries '[{
  "Source": "smoke-test",
  "DetailType": "GENERATE_NARRATIVE",
  "EventBusName": "dev-advisory-bus",
  "Detail": "{\"tenantId\":\"'$TENANT_ID'\",\"decisionId\":\"'$DECISION_ID'\"}"
}]'
```

- [ ] **Step 2: Verify the AgentCore container received the call**

```bash
sleep 60
aws logs filter-log-events \
  --log-group-name '/aws/bedrock-agentcore/runtimes/dev-advisory_narrative_agents' \
  --start-time $(( ($(date +%s) - 300) * 1000 )) \
  --filter-pattern "$DECISION_ID" \
  --max-items 20 \
  --query 'events[].message' --output text
```

Expected: log lines from the Hono server showing the structured envelope was received and `invokeNarrative` ran. If empty, the ingress Lambda failed before dispatch — check ingress logs at `/aws/lambda/dev-advisory-narrative-ctrl-ingress` for `bedrock-agentcore:InvokeAgentRuntime` errors (likely IAM).

- [ ] **Step 3: Verify a `ReasoningOutput` row landed in DDB**

```bash
aws dynamodb query \
  --table-name dev-advisory-narrative-ctrl-table \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk":{"S":"DECISION#'"$DECISION_ID"'"}}' \
  --query 'Items[?contains(sk.S, `REASONING#`)]' --output json
```

Expected: at least one item with `__typename = ReasoningOutput`. Confirms end-to-end success: ingress → AgentCore → response → DDB write.

### Task 30: Run affected e2e scenarios

- [ ] **Step 1: Identify affected e2e scenarios**

```bash
pnpm nx affected -t test-e2e-features --base=main --dry-run
```

If `e2e-feature-tests` is affected, run it:

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features
```

Expected: scenarios that depend on advisory agent invocations (per project memory: "6 e2e scenarios depend on server.ts receiving real invocations") now exercise the live AgentCore path. If any scenario fails with a transport error, capture the failure and stop here — do not paper over with re-runs.

### Task 31: Final commit + PR

- [ ] **Step 1: Confirm no stray edits**

```bash
git status
```

Expected: clean tree.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin HEAD
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat: AgentCore Runtime data-plane transport" --body "$(cat <<'EOF'
## Summary
- Adds `dispatchAgentInvocation` + `invokeAgentCoreRuntime` (SDK) + `invokeMockRuntime` (fetch) in `@nestfolio/agent-orchestrator`
- Inverts SSM polarity for the five advisory services: runtime ARN by default, `DISABLED` no longer a valid sentinel
- Removes the in-process `agentNode` fallback from each `agent-service.ts` — production always invokes AgentCore
- Aligns `agent-server.ts` + caller payload shapes around `AgentInvocation = {tenantId, decisionId, upstreamOutputs}`
- Grants `bedrock-agentcore:InvokeAgentRuntime` to each ingress Lambda

## Test plan
- [ ] `pnpm nx test agent-orchestrator` — new + existing lib tests
- [ ] `pnpm nx run-many -t test -p advisory-narrative-ctrl,advisory-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl`
- [ ] `pnpm nx run-many -t test-integration -p ...` against deployed sandbox
- [ ] Smoke test: AgentCore log group shows received invocation, DDB shows `ReasoningOutput`
- [ ] Affected e2e suite green
EOF
)"
```

---

## Out of scope / future-proofing

- **Streaming response variant.** When `onboarding-bff` or another conversational backend caller eventually needs streaming, add `libs/agent-orchestrator/src/invoke-agentcore-streaming.ts` (returns `AsyncIterable<chunk>`) and grow the dispatcher signature with a second axis (e.g. `dispatchAgentInvocationStreaming`). The current `invokeAgentCoreRuntime` stays request/response. `onboarding-bff` itself does not use this lib today (it's a CopilotRuntime + LangGraphAgent container called directly from the frontend) so this plan does not change it.
- **Plan 2's `AgentTraceEvent` emitter wiring** (`docs/superpowers/plans/2026-04-19-agent-contract-tests-02-first-rollout.md` Task 3.6+). Resumes after this lands. The `runtimeSessionId = ${tenantId}/${decisionId}` choice is what will let `AgentTraceTrap` correlate without parsing the JSON body.
- **Memory API integration changes.** Already wired in each `service.stack.ts` (Memory permissions, `MEMORY_ID` env var). Not affected by transport changes.
- **Per-tenant runtime isolation, runtime auto-scaling tuning, response caching.** Not in scope.
