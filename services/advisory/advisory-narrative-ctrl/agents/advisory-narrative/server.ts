import { serve } from '@hono/node-server';
import { createAgentServer } from '@nestfolio/agent-orchestrator';
import { invokeNarrative } from './graph';

const app = createAgentServer(async (payload) => invokeNarrative(payload));

serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
// eslint-disable-next-line no-console
console.log('advisory-narrative-ctrl agent runtime listening on 0.0.0.0:8080');
