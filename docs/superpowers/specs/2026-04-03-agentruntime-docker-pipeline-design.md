# AgentRuntime Docker Pipeline + Minimal Agents

**Date:** 2026-04-03
**Status:** Approved
**Scope:** 6 services (onboarding-bff, advisory-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl, investor-profile-ctrl)

## Problem

27/33 services deployed. The remaining 6 all use the AgentRuntime CDK construct (Bedrock AgentCore Runtime), but lack:
- Working Dockerfiles (4 have Lambda-based placeholders, 1 expects pre-built `dist/`, 1 is entirely missing)
- Agent code (advisory-ctrl missing entirely, 4 advisory services have stub `index.ts`)
- A build pipeline that handles pnpm workspace dependencies in Docker context

## Decisions

### Docker Build Strategy: esbuild Pre-Bundle

Each agent's TypeScript entry point is bundled with all workspace dependencies into a single JS file using esbuild, via an Nx `build-agent` target. The Dockerfile copies only the bundle.

**Why:** Docker context is limited to the `agentCodePath` directory (the `agents/` dir). Workspace packages like `@nestfolio/agent-orchestrator` are unreachable. Bundling eliminates the dependency problem entirely and is consistent with how Lambda functions are already built (esbuild via `NodejsFunction`).

**Rejected alternatives:**
- Monorepo-root Docker context: bloats context, requires stack code changes
- Pre-build + copy (`tsc` before deploy): fragile, manual step, doesn't bundle workspace deps

### AgentCore Container Protocol: Standard HTTP

The 5 advisory agents use the standard AgentCore HTTP protocol:
- `GET /ping` — health check
- `POST /invocations` — agent interaction

**Container requirements** (from AWS docs):
- Host on `0.0.0.0:8080`
- ARM64 platform (`--platform=linux/arm64`)
- Session ID via `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header

**Why:** Advisory agents are backend-only (invoked by AgentCore, not users). No need for AGUI/CopilotKit/WebSocket. onboarding-bff keeps its existing AGUI/CopilotKit protocol since it's frontend-facing.

### Agent Complexity: Minimal Deployable

Each agent implements a single-turn Bedrock model call (prompt in, response out). No multi-agent graphs, no memory integration, no KB retrieval yet.

**Why:** Goal is deploying all 33 services and validating the infrastructure pipeline (Docker build, ECR push, AgentCore provisioning, IAM grants, MCP Gateway). Agent logic is iterated separately once infrastructure is proven.

## Architecture

### Shared Factory: `createAgentServer()`

New export in `libs/agent-orchestrator/`:

```typescript
// libs/agent-orchestrator/src/agent-server.ts
import { Hono } from 'hono';
import { createServer } from 'node:http';

type AgentHandler = (prompt: string, sessionId: string) => Promise<string>;

export function createAgentServer(handler: AgentHandler) {
  const app = new Hono();

  app.get('/ping', (c) => c.json({ status: 'healthy' }));

  app.post('/invocations', async (c) => {
    const body = await c.req.json();
    const prompt = body.prompt ?? '';
    const sessionId = c.req.header('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id') ?? '';

    const response = await handler(prompt, sessionId);
    return c.json({ response, status: 'success' });
  });

  return app;
}

/** Start the agent server on 0.0.0.0:8080 (AgentCore contract). */
export function startAgentServer(handler: AgentHandler) {
  const app = createAgentServer(handler);
  const port = parseInt(process.env['PORT'] ?? '8080', 10);
  createServer(app.fetch as any).listen(port, '0.0.0.0', () => {
    console.log(`Agent runtime listening on 0.0.0.0:${port}`);
  });
}
```

### Nx `build-agent` Target

Per-service target in `project.json`. Entry point and output path vary by service:

```json
{
  "build-agent": {
    "executor": "@nx/esbuild:esbuild",
    "options": {
      "entryPoints": ["agents/server.ts"],
      "outputPath": "agents/dist",
      "bundle": true,
      "platform": "node",
      "format": ["cjs"],
      "tsConfig": "tsconfig.json"
    }
  }
}
```

**Per-service overrides:**
- advisory-ctrl: `entryPoints: ["agents/decision-lifecycle/server.ts"]`, `outputPath: "agents/decision-lifecycle/dist"`
- onboarding-bff: `entryPoints: ["src/runtime/server.ts"]`, `outputPath: "dist"` (Dockerfile at service root)
- All others: defaults above (agents/server.ts → agents/dist/)

Output is colocated with each service's Dockerfile for CDK `fromAsset`.

### Dockerfile Template

```dockerfile
FROM --platform=linux/arm64 node:20-slim
WORKDIR /app
COPY dist/bundle.js ./bundle.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bundle.js"]
```

### Deploy Script Integration

`infrastructure/scripts/deploy.sh` gains a pre-deploy step:

```bash
# Build agent bundles for AgentRuntime services
pnpm nx run-many -t build-agent --projects=tag:has-agent-runtime
```

## Per-Service Plan

### onboarding-bff (Investor domain)

- **Existing code:** Full agent in `src/agent/`, runtime server in `src/runtime/server.ts`
- **Changes:** Fix Dockerfile for ARM64, add `build-agent` target bundling `src/runtime/server.ts`, update Dockerfile to use bundle
- **Protocol:** AGUI/CopilotKit (unchanged — frontend-facing)

### advisory-ctrl (Advisory domain)

- **Agent dir:** `agents/decision-lifecycle/` (currently missing — create)
- **Files:** `server.ts`, `graph.ts`, `Dockerfile`
- **Models:** Sonnet (default for minimal impl; Opus/Haiku available via env)
- **Tools:** 4 Lambda tools via MCP Gateway (already wired in stack)
- **Minimal graph:** prompt → Bedrock Sonnet → response

### advisory-narrative-ctrl

- **Agent dir:** `agents/` (replace placeholder)
- **Files:** `server.ts`, `graph.ts`, `Dockerfile`
- **Models:** Sonnet
- **Minimal graph:** prompt → Bedrock Sonnet → response (explainability context)

### market-intelligence-ctrl

- **Agent dir:** `agents/` (replace placeholder)
- **Files:** `server.ts`, `graph.ts`, `Dockerfile`
- **Models:** Sonnet
- **Minimal graph:** prompt → Bedrock Sonnet → response (market analysis context)

### portfolio-engine-ctrl

- **Agent dir:** `agents/` (replace placeholder)
- **Files:** `server.ts`, `graph.ts`, `Dockerfile`
- **Models:** Sonnet (default; Opus available)
- **Minimal graph:** prompt → Bedrock Sonnet → response (portfolio construction context)

### investor-profile-ctrl

- **Agent dir:** `agents/` (replace placeholder)
- **Files:** `server.ts`, `graph.ts`, `Dockerfile`
- **Models:** Haiku (default; Opus available)
- **Minimal graph:** prompt → Bedrock Haiku → response (investor profile context)

## File Changes Summary

### New files
- `libs/agent-orchestrator/src/agent-server.ts` — shared createAgentServer factory
- `services/advisory/advisory-ctrl/agents/decision-lifecycle/{server.ts, graph.ts, Dockerfile}`
- `services/advisory/advisory-narrative-ctrl/agents/{server.ts, graph.ts}` (Dockerfile exists, replace)
- `services/advisory/market-intelligence-ctrl/agents/{server.ts, graph.ts}` (Dockerfile exists, replace)
- `services/advisory/portfolio-engine-ctrl/agents/{server.ts, graph.ts}` (Dockerfile exists, replace)
- `services/advisory/investor-profile-ctrl/agents/{server.ts, graph.ts}` (Dockerfile exists, replace)

### Modified files
- `libs/agent-orchestrator/src/index.ts` — export createAgentServer
- `services/investor/onboarding-bff/Dockerfile` — ARM64 + bundle
- `services/advisory/*/agents/Dockerfile` — replace Lambda placeholders with ARM64 node
- `services/advisory/*/agents/index.ts` — delete (replaced by server.ts + graph.ts)
- `infrastructure/scripts/deploy.sh` — add build-agent pre-step
- 6x `project.json` — add build-agent target

## Dependencies

- `hono` — already in workspace (used by onboarding-bff)
- `@langchain/core`, `@langchain/langgraph` — already in workspace
- `@langchain/aws` — for BedrockChat model (confirmed in workspace root package.json)
- No new external dependencies required

## Testing

Minimal for this phase:
- Each `graph.ts` gets a unit test verifying the graph compiles and returns a response (mocked model)
- `createAgentServer` gets a test verifying `/ping` returns 200 and `/invocations` calls the handler
- CDK synth verification for all 6 stacks (already exists)

## Future Work (separate plan)

Full agent implementations per service card:
- Multi-agent LangGraph graphs with parallel nodes
- Tier escalation (Haiku → Sonnet → Opus)
- Memory API integration
- Knowledge Base RAG retrieval
- Feedback loops and KB corpus updates
