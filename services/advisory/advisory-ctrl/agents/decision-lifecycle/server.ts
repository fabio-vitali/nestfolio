import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeDecisionLifecycle } from './graph';

const app = createAgentServer(async (payload) => invokeDecisionLifecycle(payload));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('advisory-ctrl decision-lifecycle agent runtime listening on 0.0.0.0:8080');
