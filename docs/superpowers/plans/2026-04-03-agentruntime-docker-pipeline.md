# AgentRuntime Docker Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the remaining 6 AgentRuntime services with minimal agents, validating the full Docker build → ECR → AgentCore pipeline.

**Architecture:** Each agent bundles its TypeScript entry point + workspace dependencies into a single JS file via esbuild. A shared `createAgentServer()` factory in agent-orchestrator implements the AgentCore HTTP contract (POST /invocations, GET /ping). ARM64 Docker images copy the bundle and serve on port 8080.

**Tech Stack:** esbuild (0.25.0), Hono, @hono/node-server, @langchain/langgraph, @langchain/aws (ChatBedrockConverse), Bedrock AgentCore Runtime (ARM64)

**Spec:** `docs/superpowers/specs/2026-04-03-agentruntime-docker-pipeline-design.md`

---

## File Structure

```
libs/agent-orchestrator/
  src/agent-server.ts              ← NEW: createAgentServer() factory
  src/index.ts                     ← MODIFY: add export
  package.json                     ← MODIFY: rename + main field
  test/agent-server.test.ts        ← NEW: contract tests

services/advisory/advisory-narrative-ctrl/
  agents/server.ts                 ← NEW: replaces index.ts
  agents/graph.ts                  ← NEW: minimal LangGraph
  agents/Dockerfile                ← REPLACE: ARM64 + bundle
  project.json                     ← MODIFY: add build-agent target
  test/graph.test.ts               ← NEW: graph smoke test

services/advisory/market-intelligence-ctrl/
  agents/server.ts                 ← NEW: replaces index.ts
  agents/graph.ts                  ← NEW: minimal LangGraph
  agents/Dockerfile                ← REPLACE: ARM64 + bundle
  project.json                     ← MODIFY: add build-agent target
  test/graph.test.ts               ← NEW: graph smoke test

services/advisory/portfolio-engine-ctrl/
  agents/server.ts                 ← NEW: replaces index.ts
  agents/graph.ts                  ← NEW: minimal LangGraph
  agents/Dockerfile                ← REPLACE: ARM64 + bundle
  project.json                     ← MODIFY: add build-agent target
  test/graph.test.ts               ← NEW: graph smoke test

services/advisory/investor-profile-ctrl/
  agents/server.ts                 ← NEW: replaces index.ts
  agents/graph.ts                  ← NEW: minimal LangGraph
  agents/Dockerfile                ← REPLACE: ARM64 + bundle
  project.json                     ← MODIFY: add build-agent target
  test/graph.test.ts               ← NEW: graph smoke test

services/advisory/advisory-ctrl/
  agents/decision-lifecycle/server.ts    ← NEW: entire dir is new
  agents/decision-lifecycle/graph.ts     ← NEW
  agents/decision-lifecycle/Dockerfile   ← NEW
  project.json                           ← MODIFY: add build-agent target
  test/graph.test.ts                     ← NEW: graph smoke test

services/investor/onboarding-bff/
  Dockerfile                       ← MODIFY: ARM64 + bundle path
  project.json                     ← MODIFY: add build-agent target

infrastructure/scripts/deploy.sh   ← MODIFY: add build-agent pre-step
```

---

### Task 1: Install @hono/node-server and fix agent-orchestrator package

**Files:**
- Modify: `package.json` (root — add @hono/node-server)
- Modify: `libs/agent-orchestrator/package.json` (rename + main field)

- [ ] **Step 1: Install @hono/node-server**

```bash
pnpm add -w @hono/node-server
```

Expected: package.json updated, lockfile updated.

- [ ] **Step 2: Fix agent-orchestrator package.json**

The package is named `@nestfolio/agent-core` but imported as `@nestfolio/agent-orchestrator` via tsconfig path alias. For esbuild to resolve it through node_modules, the name must match AND have a `main` field pointing to source.

Edit `libs/agent-orchestrator/package.json` to:

```json
{
  "name": "@nestfolio/agent-orchestrator",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts"
}
```

- [ ] **Step 3: Reinstall to update workspace links**

```bash
pnpm install
```

Expected: pnpm creates workspace link at `node_modules/@nestfolio/agent-orchestrator` → `../../libs/agent-orchestrator`

- [ ] **Step 4: Verify resolution**

```bash
ls -la node_modules/@nestfolio/agent-orchestrator
```

Expected: symlink pointing to `../../libs/agent-orchestrator`

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml libs/agent-orchestrator/package.json
git commit -m "chore: add @hono/node-server, fix agent-orchestrator package name for esbuild resolution"
```

---

### Task 2: Create shared agent server factory (TDD)

**Files:**
- Create: `libs/agent-orchestrator/src/agent-server.ts`
- Modify: `libs/agent-orchestrator/src/index.ts`
- Create: `libs/agent-orchestrator/test/agent-server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/agent-orchestrator/test/agent-server.test.ts`:

```typescript
import { createAgentServer } from '../src/agent-server';

describe('createAgentServer', () => {
  const mockHandler = jest.fn();

  beforeEach(() => {
    mockHandler.mockReset();
  });

  it('GET /ping returns healthy status', async () => {
    const app = createAgentServer(mockHandler);
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'healthy' });
  });

  it('POST /invocations calls handler with prompt and session ID', async () => {
    mockHandler.mockResolvedValue('agent response text');
    const app = createAgentServer(mockHandler);

    const res = await app.request('/invocations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': 'session-abc',
      },
      body: JSON.stringify({ prompt: 'What is risk?' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ response: 'agent response text', status: 'success' });
    expect(mockHandler).toHaveBeenCalledWith('What is risk?', 'session-abc');
  });

  it('POST /invocations handles missing prompt gracefully', async () => {
    mockHandler.mockResolvedValue('empty prompt response');
    const app = createAgentServer(mockHandler);

    const res = await app.request('/invocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('success');
    expect(mockHandler).toHaveBeenCalledWith('', '');
  });

  it('POST /invocations returns 500 on handler error', async () => {
    mockHandler.mockRejectedValue(new Error('Model unavailable'));
    const app = createAgentServer(mockHandler);

    const res = await app.request('/invocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.error).toContain('Model unavailable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test agent-orchestrator -- --testPathPattern=agent-server
```

Expected: FAIL — `Cannot find module '../src/agent-server'`

- [ ] **Step 3: Implement createAgentServer**

Create `libs/agent-orchestrator/src/agent-server.ts`:

```typescript
import { Hono } from 'hono';

export type AgentHandler = (prompt: string, sessionId: string) => Promise<string>;

export function createAgentServer(handler: AgentHandler) {
  const app = new Hono();

  app.get('/ping', (c) => c.json({ status: 'healthy' }));

  app.post('/invocations', async (c) => {
    const body = await c.req.json();
    const prompt = body.prompt ?? '';
    const sessionId = c.req.header('x-amzn-bedrock-agentcore-runtime-session-id') ?? '';

    try {
      const response = await handler(prompt, sessionId);
      return c.json({ response, status: 'success' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, status: 'error' }, 500);
    }
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test agent-orchestrator -- --testPathPattern=agent-server
```

Expected: 4 tests PASS

- [ ] **Step 5: Export from index.ts**

Add to the end of `libs/agent-orchestrator/src/index.ts`:

```typescript
export { createAgentServer, type AgentHandler } from './agent-server';
```

- [ ] **Step 6: Commit**

```bash
git add libs/agent-orchestrator/src/agent-server.ts libs/agent-orchestrator/src/index.ts libs/agent-orchestrator/test/agent-server.test.ts
git commit -m "feat: add createAgentServer factory for AgentCore Runtime HTTP contract"
```

---

### Task 3: advisory-narrative-ctrl agent

**Files:**
- Create: `services/advisory/advisory-narrative-ctrl/agents/server.ts`
- Create: `services/advisory/advisory-narrative-ctrl/agents/graph.ts`
- Replace: `services/advisory/advisory-narrative-ctrl/agents/Dockerfile`
- Delete: `services/advisory/advisory-narrative-ctrl/agents/index.ts`
- Create: `services/advisory/advisory-narrative-ctrl/test/graph.test.ts`
- Modify: `services/advisory/advisory-narrative-ctrl/project.json`

- [ ] **Step 1: Write the graph smoke test**

Create `services/advisory/advisory-narrative-ctrl/test/graph.test.ts`:

```typescript
import { AIMessage } from '@langchain/core/messages';

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked narrative explanation.' })),
  })),
}));

import { buildGraph } from '../agents/graph';

describe('advisory-narrative-ctrl agent graph', () => {
  it('compiles and returns a response for a prompt', async () => {
    const graph = buildGraph();
    const result = await graph.invoke({
      messages: [{ role: 'user', content: 'Explain this portfolio rebalance.' }],
    });
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Mocked narrative explanation.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test advisory-narrative-ctrl -- --testPathPattern=graph
```

Expected: FAIL — `Cannot find module '../agents/graph'`

- [ ] **Step 3: Implement graph.ts**

Create `services/advisory/advisory-narrative-ctrl/agents/graph.ts`:

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';

const SYSTEM_PROMPT = `You are the Nestfolio Narrative Agent. Your role is to generate clear, 
investor-friendly explanations of advisory decisions, portfolio changes, and risk assessments. 
Keep explanations concise, factual, and free of jargon.`;

export function buildGraph() {
  const model = new ChatBedrockConverse({
    model: process.env['MODEL_SONNET_ID'] ?? 'us.anthropic.claude-sonnet-4-6-20250514',
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', async (state) => {
      const response = await model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.messages,
      ]);
      return { messages: [response] };
    })
    .addEdge('__start__', 'agent')
    .compile();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test advisory-narrative-ctrl -- --testPathPattern=graph
```

Expected: PASS

- [ ] **Step 5: Create server.ts**

Create `services/advisory/advisory-narrative-ctrl/agents/server.ts`:

```typescript
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { buildGraph } from './graph';

const graph = buildGraph();

const app = createAgentServer(async (prompt, _sessionId) => {
  const result = await graph.invoke({
    messages: [{ role: 'user', content: prompt }],
  });
  const lastMsg = result.messages[result.messages.length - 1];
  return typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('advisory-narrative-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 6: Delete placeholder index.ts and replace Dockerfile**

Delete `services/advisory/advisory-narrative-ctrl/agents/index.ts`.

Replace `services/advisory/advisory-narrative-ctrl/agents/Dockerfile` with:

```dockerfile
FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.js ./bundle.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.js"]
```

- [ ] **Step 7: Add build-agent target to project.json**

Add to the `targets` object in `services/advisory/advisory-narrative-ctrl/project.json`:

```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/advisory/advisory-narrative-ctrl/agents/server.ts --bundle --platform=node --outfile=services/advisory/advisory-narrative-ctrl/agents/dist/bundle.js --format=cjs --target=node20"
  }
}
```

- [ ] **Step 8: Build and verify bundle**

```bash
pnpm nx run advisory-narrative-ctrl:build-agent
ls -la services/advisory/advisory-narrative-ctrl/agents/dist/bundle.js
```

Expected: bundle.js exists. If esbuild fails, check error output — common issues are missing modules or ESM/CJS conflicts.

- [ ] **Step 9: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/agents/ services/advisory/advisory-narrative-ctrl/project.json services/advisory/advisory-narrative-ctrl/test/graph.test.ts
git commit -m "feat(advisory-narrative-ctrl): add minimal agent runtime with LangGraph"
```

---

### Task 4: market-intelligence-ctrl agent

**Files:**
- Create: `services/advisory/market-intelligence-ctrl/agents/server.ts`
- Create: `services/advisory/market-intelligence-ctrl/agents/graph.ts`
- Replace: `services/advisory/market-intelligence-ctrl/agents/Dockerfile`
- Delete: `services/advisory/market-intelligence-ctrl/agents/index.ts`
- Create: `services/advisory/market-intelligence-ctrl/test/graph.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/project.json`

- [ ] **Step 1: Write the graph smoke test**

Create `services/advisory/market-intelligence-ctrl/test/graph.test.ts`:

```typescript
import { AIMessage } from '@langchain/core/messages';

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked market analysis.' })),
  })),
}));

import { buildGraph } from '../agents/graph';

describe('market-intelligence-ctrl agent graph', () => {
  it('compiles and returns a response for a prompt', async () => {
    const graph = buildGraph();
    const result = await graph.invoke({
      messages: [{ role: 'user', content: 'Analyze current market conditions.' }],
    });
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Mocked market analysis.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test market-intelligence-ctrl -- --testPathPattern=graph
```

Expected: FAIL — `Cannot find module '../agents/graph'`

- [ ] **Step 3: Implement graph.ts**

Create `services/advisory/market-intelligence-ctrl/agents/graph.ts`:

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';

const SYSTEM_PROMPT = `You are the Nestfolio Market Intelligence Agent. Your role is to analyze 
market conditions, detect signals from macro indicators, news sentiment, and sector data, 
and produce structured market assessments for the advisory decision pipeline.`;

export function buildGraph() {
  const model = new ChatBedrockConverse({
    model: process.env['MODEL_SONNET_ID'] ?? 'us.anthropic.claude-sonnet-4-6-20250514',
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', async (state) => {
      const response = await model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.messages,
      ]);
      return { messages: [response] };
    })
    .addEdge('__start__', 'agent')
    .compile();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test market-intelligence-ctrl -- --testPathPattern=graph
```

Expected: PASS

- [ ] **Step 5: Create server.ts**

Create `services/advisory/market-intelligence-ctrl/agents/server.ts`:

```typescript
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { buildGraph } from './graph';

const graph = buildGraph();

const app = createAgentServer(async (prompt, _sessionId) => {
  const result = await graph.invoke({
    messages: [{ role: 'user', content: prompt }],
  });
  const lastMsg = result.messages[result.messages.length - 1];
  return typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('market-intelligence-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 6: Delete placeholder index.ts and replace Dockerfile**

Delete `services/advisory/market-intelligence-ctrl/agents/index.ts`.

Replace `services/advisory/market-intelligence-ctrl/agents/Dockerfile` with:

```dockerfile
FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.js ./bundle.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.js"]
```

- [ ] **Step 7: Add build-agent target to project.json**

Add to the `targets` object in `services/advisory/market-intelligence-ctrl/project.json`:

```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/advisory/market-intelligence-ctrl/agents/server.ts --bundle --platform=node --outfile=services/advisory/market-intelligence-ctrl/agents/dist/bundle.js --format=cjs --target=node20"
  }
}
```

- [ ] **Step 8: Build and verify bundle**

```bash
pnpm nx run market-intelligence-ctrl:build-agent
ls -la services/advisory/market-intelligence-ctrl/agents/dist/bundle.js
```

Expected: bundle.js exists.

- [ ] **Step 9: Commit**

```bash
git add services/advisory/market-intelligence-ctrl/agents/ services/advisory/market-intelligence-ctrl/project.json services/advisory/market-intelligence-ctrl/test/graph.test.ts
git commit -m "feat(market-intelligence-ctrl): add minimal agent runtime with LangGraph"
```

---

### Task 5: portfolio-engine-ctrl agent

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/agents/server.ts`
- Create: `services/advisory/portfolio-engine-ctrl/agents/graph.ts`
- Replace: `services/advisory/portfolio-engine-ctrl/agents/Dockerfile`
- Delete: `services/advisory/portfolio-engine-ctrl/agents/index.ts`
- Create: `services/advisory/portfolio-engine-ctrl/test/graph.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/project.json`

- [ ] **Step 1: Write the graph smoke test**

Create `services/advisory/portfolio-engine-ctrl/test/graph.test.ts`:

```typescript
import { AIMessage } from '@langchain/core/messages';

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked portfolio construction.' })),
  })),
}));

import { buildGraph } from '../agents/graph';

describe('portfolio-engine-ctrl agent graph', () => {
  it('compiles and returns a response for a prompt', async () => {
    const graph = buildGraph();
    const result = await graph.invoke({
      messages: [{ role: 'user', content: 'Construct a portfolio for moderate risk.' }],
    });
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Mocked portfolio construction.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test portfolio-engine-ctrl -- --testPathPattern=graph
```

Expected: FAIL — `Cannot find module '../agents/graph'`

- [ ] **Step 3: Implement graph.ts**

Create `services/advisory/portfolio-engine-ctrl/agents/graph.ts`:

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';

const SYSTEM_PROMPT = `You are the Nestfolio Portfolio Engine Agent. Your role is to construct 
optimal portfolio allocations and rebalancing plans based on investor goals, risk tolerance, 
market conditions, and the approved instrument universe. Output structured allocation proposals.`;

export function buildGraph() {
  const model = new ChatBedrockConverse({
    model: process.env['MODEL_SONNET_ID'] ?? 'us.anthropic.claude-sonnet-4-6-20250514',
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', async (state) => {
      const response = await model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.messages,
      ]);
      return { messages: [response] };
    })
    .addEdge('__start__', 'agent')
    .compile();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test portfolio-engine-ctrl -- --testPathPattern=graph
```

Expected: PASS

- [ ] **Step 5: Create server.ts**

Create `services/advisory/portfolio-engine-ctrl/agents/server.ts`:

```typescript
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { buildGraph } from './graph';

const graph = buildGraph();

const app = createAgentServer(async (prompt, _sessionId) => {
  const result = await graph.invoke({
    messages: [{ role: 'user', content: prompt }],
  });
  const lastMsg = result.messages[result.messages.length - 1];
  return typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('portfolio-engine-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 6: Delete placeholder index.ts and replace Dockerfile**

Delete `services/advisory/portfolio-engine-ctrl/agents/index.ts`.

Replace `services/advisory/portfolio-engine-ctrl/agents/Dockerfile` with:

```dockerfile
FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.js ./bundle.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.js"]
```

- [ ] **Step 7: Add build-agent target to project.json**

Add to the `targets` object in `services/advisory/portfolio-engine-ctrl/project.json`:

```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/advisory/portfolio-engine-ctrl/agents/server.ts --bundle --platform=node --outfile=services/advisory/portfolio-engine-ctrl/agents/dist/bundle.js --format=cjs --target=node20"
  }
}
```

- [ ] **Step 8: Build and verify bundle**

```bash
pnpm nx run portfolio-engine-ctrl:build-agent
ls -la services/advisory/portfolio-engine-ctrl/agents/dist/bundle.js
```

Expected: bundle.js exists.

- [ ] **Step 9: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/agents/ services/advisory/portfolio-engine-ctrl/project.json services/advisory/portfolio-engine-ctrl/test/graph.test.ts
git commit -m "feat(portfolio-engine-ctrl): add minimal agent runtime with LangGraph"
```

---

### Task 6: investor-profile-ctrl agent

**Files:**
- Create: `services/advisory/investor-profile-ctrl/agents/server.ts`
- Create: `services/advisory/investor-profile-ctrl/agents/graph.ts`
- Replace: `services/advisory/investor-profile-ctrl/agents/Dockerfile`
- Delete: `services/advisory/investor-profile-ctrl/agents/index.ts`
- Create: `services/advisory/investor-profile-ctrl/test/graph.test.ts`
- Modify: `services/advisory/investor-profile-ctrl/project.json`

- [ ] **Step 1: Write the graph smoke test**

Create `services/advisory/investor-profile-ctrl/test/graph.test.ts`:

```typescript
import { AIMessage } from '@langchain/core/messages';

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked investor profile analysis.' })),
  })),
}));

import { buildGraph } from '../agents/graph';

describe('investor-profile-ctrl agent graph', () => {
  it('compiles and returns a response for a prompt', async () => {
    const graph = buildGraph();
    const result = await graph.invoke({
      messages: [{ role: 'user', content: 'Analyze investor risk tolerance and goals.' }],
    });
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Mocked investor profile analysis.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test investor-profile-ctrl -- --testPathPattern=graph
```

Expected: FAIL — `Cannot find module '../agents/graph'`

- [ ] **Step 3: Implement graph.ts**

Create `services/advisory/investor-profile-ctrl/agents/graph.ts`:

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';

const SYSTEM_PROMPT = `You are the Nestfolio Investor Profile Agent. Your role is to interpret 
investor goals, assess risk tolerance, and evaluate suitability against regulatory frameworks. 
Produce structured goal interpretations and risk evaluations.`;

export function buildGraph() {
  const model = new ChatBedrockConverse({
    model: process.env['MODEL_HAIKU_ID'] ?? 'us.anthropic.claude-haiku-4-5-20251001',
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', async (state) => {
      const response = await model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.messages,
      ]);
      return { messages: [response] };
    })
    .addEdge('__start__', 'agent')
    .compile();
}
```

Note: This agent defaults to Haiku (fast, cheap) for investor profile analysis. The full implementation will use Opus for risk assessment + Haiku for goal interpretation in parallel.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm nx test investor-profile-ctrl -- --testPathPattern=graph
```

Expected: PASS

- [ ] **Step 5: Create server.ts**

Create `services/advisory/investor-profile-ctrl/agents/server.ts`:

```typescript
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { buildGraph } from './graph';

const graph = buildGraph();

const app = createAgentServer(async (prompt, _sessionId) => {
  const result = await graph.invoke({
    messages: [{ role: 'user', content: prompt }],
  });
  const lastMsg = result.messages[result.messages.length - 1];
  return typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('investor-profile-ctrl agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 6: Delete placeholder index.ts and replace Dockerfile**

Delete `services/advisory/investor-profile-ctrl/agents/index.ts`.

Replace `services/advisory/investor-profile-ctrl/agents/Dockerfile` with:

```dockerfile
FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.js ./bundle.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.js"]
```

- [ ] **Step 7: Add build-agent target to project.json**

Add to the `targets` object in `services/advisory/investor-profile-ctrl/project.json`:

```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/advisory/investor-profile-ctrl/agents/server.ts --bundle --platform=node --outfile=services/advisory/investor-profile-ctrl/agents/dist/bundle.js --format=cjs --target=node20"
  }
}
```

- [ ] **Step 8: Build and verify bundle**

```bash
pnpm nx run investor-profile-ctrl:build-agent
ls -la services/advisory/investor-profile-ctrl/agents/dist/bundle.js
```

Expected: bundle.js exists.

- [ ] **Step 9: Commit**

```bash
git add services/advisory/investor-profile-ctrl/agents/ services/advisory/investor-profile-ctrl/project.json services/advisory/investor-profile-ctrl/test/graph.test.ts
git commit -m "feat(investor-profile-ctrl): add minimal agent runtime with LangGraph"
```

---

### Task 7: advisory-ctrl agent (decision-lifecycle)

**Files:**
- Create: `services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts`
- Create: `services/advisory/advisory-ctrl/agents/decision-lifecycle/graph.ts`
- Create: `services/advisory/advisory-ctrl/agents/decision-lifecycle/Dockerfile`
- Create: `services/advisory/advisory-ctrl/test/graph.test.ts`
- Modify: `services/advisory/advisory-ctrl/project.json`

Note: This service uses a nested agent dir `agents/decision-lifecycle/` (stack refs `join(__dirname, '..', 'agents', 'decision-lifecycle')`). It also has 4 Lambda tools wired via MCP Gateway, but the minimal agent doesn't use tools — it just calls the model.

- [ ] **Step 1: Create the agents/decision-lifecycle directory**

```bash
mkdir -p services/advisory/advisory-ctrl/agents/decision-lifecycle
```

- [ ] **Step 2: Write the graph smoke test**

Create `services/advisory/advisory-ctrl/test/graph.test.ts`:

```typescript
import { AIMessage } from '@langchain/core/messages';

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked decision lifecycle response.' })),
  })),
}));

import { buildGraph } from '../agents/decision-lifecycle/graph';

describe('advisory-ctrl decision-lifecycle agent graph', () => {
  it('compiles and returns a response for a prompt', async () => {
    const graph = buildGraph();
    const result = await graph.invoke({
      messages: [{ role: 'user', content: 'Evaluate portfolio drift for tenant-123.' }],
    });
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Mocked decision lifecycle response.');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm nx test advisory-ctrl -- --testPathPattern=graph
```

Expected: FAIL — `Cannot find module '../agents/decision-lifecycle/graph'`

- [ ] **Step 4: Implement graph.ts**

Create `services/advisory/advisory-ctrl/agents/decision-lifecycle/graph.ts`:

```typescript
import { ChatBedrockConverse } from '@langchain/aws';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';

const SYSTEM_PROMPT = `You are the Nestfolio Decision Lifecycle Agent. You orchestrate the advisory 
decision pipeline: interpreting investor goals, evaluating market conditions, constructing portfolios, 
and producing decision packets for compliance review. You coordinate multiple sub-agents and tools 
to produce comprehensive, auditable investment recommendations.`;

export function buildGraph() {
  const model = new ChatBedrockConverse({
    model: process.env['MODEL_SONNET_ID'] ?? 'us.anthropic.claude-sonnet-4-6-20250514',
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', async (state) => {
      const response = await model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.messages,
      ]);
      return { messages: [response] };
    })
    .addEdge('__start__', 'agent')
    .compile();
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm nx test advisory-ctrl -- --testPathPattern=graph
```

Expected: PASS

- [ ] **Step 6: Create server.ts**

Create `services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts`:

```typescript
import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { buildGraph } from './graph';

const graph = buildGraph();

const app = createAgentServer(async (prompt, _sessionId) => {
  const result = await graph.invoke({
    messages: [{ role: 'user', content: prompt }],
  });
  const lastMsg = result.messages[result.messages.length - 1];
  return typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
});

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
console.log('advisory-ctrl decision-lifecycle agent runtime listening on 0.0.0.0:8080');
```

- [ ] **Step 7: Create Dockerfile**

Create `services/advisory/advisory-ctrl/agents/decision-lifecycle/Dockerfile`:

```dockerfile
FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.js ./bundle.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.js"]
```

- [ ] **Step 8: Add build-agent target to project.json**

Add to the `targets` object in `services/advisory/advisory-ctrl/project.json`:

```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/advisory/advisory-ctrl/agents/decision-lifecycle/server.ts --bundle --platform=node --outfile=services/advisory/advisory-ctrl/agents/decision-lifecycle/dist/bundle.js --format=cjs --target=node20"
  }
}
```

- [ ] **Step 9: Build and verify bundle**

```bash
pnpm nx run advisory-ctrl:build-agent
ls -la services/advisory/advisory-ctrl/agents/decision-lifecycle/dist/bundle.js
```

Expected: bundle.js exists.

- [ ] **Step 10: Commit**

```bash
git add services/advisory/advisory-ctrl/agents/ services/advisory/advisory-ctrl/project.json services/advisory/advisory-ctrl/test/graph.test.ts
git commit -m "feat(advisory-ctrl): add minimal decision-lifecycle agent runtime"
```

---

### Task 8: onboarding-bff Dockerfile + build target

**Files:**
- Modify: `services/investor/onboarding-bff/Dockerfile`
- Modify: `services/investor/onboarding-bff/project.json`

The onboarding-bff already has full agent code in `src/agent/` and a runtime server in `src/runtime/server.ts`. We need to:
1. Fix the Dockerfile for ARM64 and bundle-based build
2. Add a build-agent target that bundles the runtime server

- [ ] **Step 1: Replace the Dockerfile**

Replace `services/investor/onboarding-bff/Dockerfile` with:

```dockerfile
FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.js ./bundle.js
ENV AGENT_RUNTIME=true
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.js"]
```

- [ ] **Step 2: Add build-agent target to project.json**

Add to the `targets` object in `services/investor/onboarding-bff/project.json`:

```json
"build-agent": {
  "executor": "nx:run-commands",
  "options": {
    "command": "npx esbuild services/investor/onboarding-bff/src/runtime/server.ts --bundle --platform=node --outfile=services/investor/onboarding-bff/dist/bundle.js --format=cjs --target=node20"
  }
}
```

Note: Output is `dist/bundle.js` (at service root), not `agents/dist/`, because the stack's `agentCodePath` is the service root (`join(__dirname, '..')`).

- [ ] **Step 3: Build and verify bundle**

```bash
pnpm nx run onboarding-bff:build-agent
ls -la services/investor/onboarding-bff/dist/bundle.js
```

Expected: bundle.js exists. If CopilotKit or its deps cause esbuild issues, check the error. Common fix: add `--external:some-problematic-package` if a package uses Node.js binary addons.

- [ ] **Step 4: Commit**

```bash
git add services/investor/onboarding-bff/Dockerfile services/investor/onboarding-bff/project.json
git commit -m "fix(onboarding-bff): ARM64 Dockerfile + esbuild bundle target"
```

---

### Task 9: Add model ID environment variables to stacks

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`
- Modify: `services/advisory/market-intelligence-ctrl/src/service.stack.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`
- Modify: `services/advisory/investor-profile-ctrl/src/service.stack.ts`
- Modify: `services/advisory/advisory-ctrl/src/service.stack.ts`

The AgentRuntime construct accepts `environmentVariables` which are passed to the container. Currently none of the stacks pass model IDs to the runtime — agents need them at runtime to call Bedrock.

- [ ] **Step 1: advisory-narrative-ctrl stack**

In `services/advisory/advisory-narrative-ctrl/src/service.stack.ts`, add `environmentVariables` to the AgentRuntime constructor (around line 73):

Change:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_narrative_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'explainability (Sonnet, 8192 tokens) agent with feedback loop KB',
      state,
      modelIds: [modelSonnetId],
      toolTargets: [],
    });
```

To:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_narrative_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'explainability (Sonnet, 8192 tokens) agent with feedback loop KB',
      state,
      modelIds: [modelSonnetId],
      toolTargets: [],
      environmentVariables: {
        MODEL_SONNET_ID: modelSonnetId,
        TABLE_NAME: state.getTable().tableName,
      },
    });
```

- [ ] **Step 2: market-intelligence-ctrl stack**

In `services/advisory/market-intelligence-ctrl/src/service.stack.ts`, add `environmentVariables` to the AgentRuntime constructor (around line 108):

Change:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'market_intelligence_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'market-research (Sonnet) single agent with tool access',
      state,
      modelIds: [modelSonnetId],
      toolTargets: [],
    });
```

To:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'market_intelligence_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'market-research (Sonnet) single agent with tool access',
      state,
      modelIds: [modelSonnetId],
      toolTargets: [],
      environmentVariables: {
        MODEL_SONNET_ID: modelSonnetId,
        TABLE_NAME: state.getTable().tableName,
      },
    });
```

- [ ] **Step 3: portfolio-engine-ctrl stack**

In `services/advisory/portfolio-engine-ctrl/src/service.stack.ts`, add `environmentVariables` to the AgentRuntime constructor (around line 93):

Change:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'portfolio_engine_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'portfolio-construction (Opus) + rebalance-planner (Sonnet) parallel orchestration',
      state,
      modelIds: [modelOpusId, modelSonnetId],
      toolTargets: [],
    });
```

To:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'portfolio_engine_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'portfolio-construction (Opus) + rebalance-planner (Sonnet) parallel orchestration',
      state,
      modelIds: [modelOpusId, modelSonnetId],
      toolTargets: [],
      environmentVariables: {
        MODEL_OPUS_ID: modelOpusId,
        MODEL_SONNET_ID: modelSonnetId,
        TABLE_NAME: state.getTable().tableName,
      },
    });
```

- [ ] **Step 4: investor-profile-ctrl stack**

In `services/advisory/investor-profile-ctrl/src/service.stack.ts`, add `environmentVariables` to the AgentRuntime constructor (around line 85):

Change:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'investor_profile_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'user-goals (Haiku) + risk-assessment (Opus) parallel orchestration',
      state,
      modelIds: [modelOpusId, modelHaikuId],
      toolTargets: [],
    });
```

To:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'investor_profile_agents',
      agentCodePath: join(__dirname, '..', 'agents'),
      description: 'user-goals (Haiku) + risk-assessment (Opus) parallel orchestration',
      state,
      modelIds: [modelOpusId, modelHaikuId],
      toolTargets: [],
      environmentVariables: {
        MODEL_OPUS_ID: modelOpusId,
        MODEL_HAIKU_ID: modelHaikuId,
        TABLE_NAME: state.getTable().tableName,
      },
    });
```

- [ ] **Step 5: advisory-ctrl stack**

In `services/advisory/advisory-ctrl/src/service.stack.ts`, add `environmentVariables` to the AgentRuntime constructor (around line 94):

Change:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_ctrl_decision_lifecycle',
      agentCodePath: join(__dirname, '..', 'agents', 'decision-lifecycle'),
      description: 'Multi-agent decision lifecycle orchestrated via LangGraph.js',
      state,
      modelIds: [modelOpusId, modelSonnetId, modelHaikuId],
```

To:
```typescript
    new AgentRuntime(this, 'AgentRuntime', {
      runtimeName: 'advisory_ctrl_decision_lifecycle',
      agentCodePath: join(__dirname, '..', 'agents', 'decision-lifecycle'),
      description: 'Multi-agent decision lifecycle orchestrated via LangGraph.js',
      state,
      modelIds: [modelOpusId, modelSonnetId, modelHaikuId],
      environmentVariables: {
        MODEL_OPUS_ID: modelOpusId,
        MODEL_SONNET_ID: modelSonnetId,
        MODEL_HAIKU_ID: modelHaikuId,
        TABLE_NAME: state.getTable().tableName,
      },
```

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/src/service.stack.ts \
  services/advisory/market-intelligence-ctrl/src/service.stack.ts \
  services/advisory/portfolio-engine-ctrl/src/service.stack.ts \
  services/advisory/investor-profile-ctrl/src/service.stack.ts \
  services/advisory/advisory-ctrl/src/service.stack.ts
git commit -m "feat: pass model IDs and TABLE_NAME as env vars to AgentRuntime containers"
```

---

### Task 10: Add has-agent-runtime tag and deploy script integration

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/project.json`
- Modify: `services/advisory/market-intelligence-ctrl/project.json`
- Modify: `services/advisory/portfolio-engine-ctrl/project.json`
- Modify: `services/advisory/investor-profile-ctrl/project.json`
- Modify: `services/advisory/advisory-ctrl/project.json`
- Modify: `services/investor/onboarding-bff/project.json`
- Modify: `infrastructure/scripts/deploy.sh`

- [ ] **Step 1: Add has-agent-runtime tag to all 6 project.json files**

For each of the 6 services, add `"has-agent-runtime"` to the `tags` array in their `project.json`.

Example for advisory-narrative-ctrl — change:
```json
"tags": ["scope:advisory", "type:ctrl"]
```
To:
```json
"tags": ["scope:advisory", "type:ctrl", "has-agent-runtime"]
```

Do the same for:
- `services/advisory/market-intelligence-ctrl/project.json`: add `"has-agent-runtime"` to tags
- `services/advisory/portfolio-engine-ctrl/project.json`: add `"has-agent-runtime"` to tags
- `services/advisory/investor-profile-ctrl/project.json`: add `"has-agent-runtime"` to tags
- `services/advisory/advisory-ctrl/project.json`: add `"has-agent-runtime"` to tags
- `services/investor/onboarding-bff/project.json`: add `"has-agent-runtime"` to tags

- [ ] **Step 2: Add build-agent step to deploy.sh**

In `infrastructure/scripts/deploy.sh`, add the build step after the resolver call (after line 61, before the helper functions):

```bash
# ── Build agent bundles ────────────────────────────────────────────────────
echo "Building agent bundles..."
if [ "$DRY_RUN" = "true" ]; then
  echo "  [DRY RUN] Would run: pnpm nx run-many -t build-agent --projects=tag:has-agent-runtime"
else
  pnpm nx run-many -t build-agent --projects=tag:has-agent-runtime --parallel=5 || {
    echo "ERROR: Agent bundle build failed." >&2
    exit 1
  }
fi
```

- [ ] **Step 3: Verify build-agent runs for all 6 services**

```bash
pnpm nx run-many -t build-agent --projects=tag:has-agent-runtime --parallel=5
```

Expected: 6 services build successfully. Check that each `dist/bundle.js` (or `agents/dist/bundle.js`) exists.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/project.json \
  services/advisory/market-intelligence-ctrl/project.json \
  services/advisory/portfolio-engine-ctrl/project.json \
  services/advisory/investor-profile-ctrl/project.json \
  services/advisory/advisory-ctrl/project.json \
  services/investor/onboarding-bff/project.json \
  infrastructure/scripts/deploy.sh
git commit -m "feat: add build-agent targets with has-agent-runtime tag, integrate into deploy.sh"
```

---

### Task 11: Run all tests and CDK synth verification

**Files:** None (verification only)

- [ ] **Step 1: Run all new tests**

```bash
pnpm nx run-many -t test --projects=agent-orchestrator,advisory-narrative-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,investor-profile-ctrl,advisory-ctrl -- --testPathPattern="(agent-server|graph)"
```

Expected: All tests PASS.

- [ ] **Step 2: CDK synth for all 6 stacks**

```bash
for svc in advisory-narrative-ctrl market-intelligence-ctrl portfolio-engine-ctrl investor-profile-ctrl advisory-ctrl onboarding-bff; do
  echo "=== Synthesizing $svc ==="
  pnpm nx run $svc:deploy -- --dry-run -c prefix=dev 2>&1 | tail -3
  echo ""
done
```

Note: The deploy target with `--dry-run` or just CDK synth should verify templates generate without errors. If your deploy target doesn't support dry-run natively, use:

```bash
npx cdk synth --app 'npx ts-node -r ./tools/register-paths.js services/advisory/advisory-narrative-ctrl/src/main.ts' -c prefix=dev --quiet
```

Expected: All 6 stacks synthesize without errors.

- [ ] **Step 3: Verify Docker build (one service)**

```bash
cd services/advisory/advisory-narrative-ctrl/agents && docker build --platform linux/arm64 -t test-agent . && cd -
```

Expected: Docker image builds successfully. If on Apple Silicon, `--platform linux/arm64` is native. On x86, it requires Docker buildx with QEMU.

- [ ] **Step 4: Verify agent container starts**

```bash
docker run --rm -d --name test-agent -p 8080:8080 test-agent
sleep 2
curl -s http://localhost:8080/ping
docker stop test-agent
```

Expected: `{"status":"healthy"}` — confirms the bundle runs, Hono serves, and the AgentCore contract endpoint works. The `/invocations` endpoint will fail without AWS credentials, which is expected.

---

### Task 12: Deploy all 6 AgentRuntime services

**Files:** None (deployment only)

- [ ] **Step 1: Deploy via deploy.sh**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-narrative-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,investor-profile-ctrl,advisory-ctrl,onboarding-bff
```

If deploy.sh doesn't work with the service filter for these specific services, deploy individually:

```bash
for svc in advisory-narrative-ctrl market-intelligence-ctrl portfolio-engine-ctrl investor-profile-ctrl advisory-ctrl onboarding-bff; do
  echo "=== Deploying $svc ==="
  pnpm nx run $svc:deploy -- --require-approval never --prefix=dev -c tier=sandbox -c observability=true -c logRetention=7 -c protectedResources=false -c region=us-east-1
done
```

- [ ] **Step 2: Verify all 33 services are deployed**

```bash
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query 'StackSummaries[?starts_with(StackName, `dev-`)].StackName' --output table --region us-east-1
```

Expected: 33 stacks with `dev-` prefix, all in CREATE_COMPLETE or UPDATE_COMPLETE status.

- [ ] **Step 3: Verify AgentCore runtimes are active**

```bash
aws bedrock-agentcore list-runtimes --region us-east-1 --query 'runtimeSummaries[].{name:runtimeName,status:status}' --output table
```

Expected: 6 runtimes listed with ACTIVE status.

- [ ] **Step 4: Final commit**

```bash
git add -A
git status
# Only commit if there are changes (e.g., lockfile updates from deploy)
git commit -m "chore: deploy all 6 AgentRuntime services to dev"
```
