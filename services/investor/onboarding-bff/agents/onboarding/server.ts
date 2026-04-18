import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CopilotRuntime, LangGraphAgent } from '@copilotkit/runtime';
import { buildOnboardingGraph } from './graph';
import { OnboardingRepository } from '../../src/repositories/onboarding.repository';

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
    const graph = buildOnboardingGraph({ repo });

    const runtime = new CopilotRuntime();
    const adapter = new LangGraphAgent({ graph });
    return runtime.process(c.req.raw, adapter);
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
