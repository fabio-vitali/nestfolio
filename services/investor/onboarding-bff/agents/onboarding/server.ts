import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  CopilotRuntime,
  EmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import { LangGraphAgent } from '@copilotkit/runtime/langgraph';
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

    // CopilotKit 1.54.0 removed the `runtime.process(req, adapter)` shortcut.
    // The new shape: register agents on the runtime constructor and let
    // `copilotRuntimeNodeHttpEndpoint` build the HTTP handler that adapts
    // a Fetch Request → Fetch Response. EmptyAdapter is the documented
    // service-adapter for runs where the agent (LangGraph) owns the LLM call.
    const runtime = new CopilotRuntime({
      agents: { onboarding: new LangGraphAgent({ graph }) as never },
    });
    const handler = copilotRuntimeNodeHttpEndpoint({
      runtime,
      serviceAdapter: new EmptyAdapter(),
      endpoint: '/invocations',
    });

    let status: 'success' | 'error' = 'success';
    try {
      const response = await handler(c.req.raw);
      return response as Response;
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
  console.log(`Onboarding agent runtime listening on 0.0.0.0:${port}`);
  // Use @hono/node-server (same bootstrap as advisory agents). The previous
  // createServer(app.fetch) path passed Node's IncomingMessage to Hono, which
  // expects Fetch Request semantics — `c.req.header()` crashed on every
  // request including AgentCore's /ping health probe.
  import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  });
}
