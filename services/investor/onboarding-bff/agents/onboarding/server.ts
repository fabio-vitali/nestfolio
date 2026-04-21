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

export function createApp() {
  const app = new Hono();

  app.use('/*', cors({
    origin: '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/session', async (c) => {
    // TODO: Extract tenantId + userId from auth context
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

    // Rehydrate state from committed DDB records
    const { rehydrateState } = await import('../../src/agent/session');
    const state = rehydrateState(session as any);
    return c.json({ activeSession: true, state });
  });

  app.post('/copilotkit', async (c) => {
    const tableName = process.env['TABLE_NAME'] ?? '';
    const repo = new OnboardingRepository(tableName);

    // tenantId: matches the /session endpoint's convention above.
    // correlationId source: session-scoped id. CopilotKit request body
    // typically carries threadId; we also honour an explicit x-session-id
    // header, falling back to x-user-id which /session already uses.
    // Emission is gated on BOTH being present — event-processor parsers
    // reject envelopes without detail.context.tenantId.
    const tenantId = c.req.header('x-tenant-id') ?? '';
    const sessionId =
      c.req.header('x-session-id') ??
      c.req.header('x-user-id') ??
      '';

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
