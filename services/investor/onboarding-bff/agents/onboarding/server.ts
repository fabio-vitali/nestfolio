import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { EventEncoder } from '@ag-ui/encoder';
import type { RunAgentInput } from '@ag-ui/client';
import { decodeJwt } from 'jose';
import { buildOnboardingGraph } from './graph';
import { OnboardingAgent } from './agent';
import { OnboardingRepository } from '../../src/repositories/onboarding.repository';
import { AgentTracer, EventBridgeTraceEmitter } from '@nestfolio/agent-orchestrator';
import { OnboardingBffEventTypes } from '../../src/domain/events';

const emitter = new EventBridgeTraceEmitter({
  busName: process.env['EVENT_BUS_NAME'],
  source: 'agent-orchestrator@onboarding-bff',
  detailType: OnboardingBffEventTypes.ONBOARDING_AGENT_INVOCATION_TRACED,
});

function parseRuntimeSessionId(raw: string | undefined): { sessionId: string } {
  // The AgentCore runtime-session-id header carries `${tenantId}/${sessionId}`,
  // but the tenantId portion is BROWSER-supplied and untrusted. We use this
  // header only to extract the sessionId. tenantId + userId come from the
  // verified Cognito JWT claims (see resolveJwtIdentity).
  if (!raw) return { sessionId: '' };
  const slash = raw.indexOf('/');
  if (slash < 0) return { sessionId: '' };
  return { sessionId: raw.slice(slash + 1) };
}

interface JwtIdentity {
  tenantId: string;
  userId: string;
}

/**
 * Extract trusted identity from the Cognito access token.
 *
 * AgentCore's Custom JWT authorizer has already validated the token's
 * signature, audience, and expiry before forwarding the request — we only
 * need to decode the claims (no JWKS fetch, no re-verification). If a
 * defence-in-depth re-verification is later required, swap `decodeJwt` for
 * `jwtVerify` with a remote JWKS resolver.
 */
function resolveJwtIdentity(authHeader: string | undefined): JwtIdentity {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { tenantId: '', userId: '' };
  }
  const token = authHeader.slice(7).trim();
  if (!token) return { tenantId: '', userId: '' };
  try {
    const claims = decodeJwt(token);
    const tenantId = typeof claims['custom:tenant_id'] === 'string' ? (claims['custom:tenant_id'] as string) : '';
    const userId = typeof claims.sub === 'string' ? claims.sub : '';
    return { tenantId, userId };
  } catch {
    return { tenantId: '', userId: '' };
  }
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
    // Identity from the verified Cognito JWT — same source as /invocations.
    // Browser-supplied x-tenant-id / x-user-id headers are no longer trusted.
    const { tenantId, userId } = resolveJwtIdentity(c.req.header('Authorization'));

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

    // Identity is server-derived only:
    //   • tenantId, userId — Cognito JWT claims (custom:tenant_id, sub) from
    //     the Authorization Bearer header. AgentCore's Custom JWT authorizer
    //     has already validated the token before forwarding the request.
    //   • sessionId — the AgentCore runtime-session-id header
    //     (`${browserTenant}/${sessionId}`) — only the sessionId portion is
    //     used; the browser-supplied tenant prefix is discarded.
    // The LLM never sees these values; they are bound to the runtime
    // invocation via RunnableConfig.configurable and read by tools (e.g.
    // commit_phase) from there.
    const { tenantId, userId } = resolveJwtIdentity(c.req.header('Authorization'));
    const { sessionId } = parseRuntimeSessionId(
      c.req.header('x-amzn-bedrock-agentcore-runtime-session-id'),
    );

    if (!tenantId || !userId || !sessionId) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: 'ERROR',
        message: 'onboarding /invocations: identity missing — refusing',
        hasTenantId: Boolean(tenantId),
        hasUserId: Boolean(userId),
        hasSessionId: Boolean(sessionId),
      }));
      return c.json({ error: 'identity required' }, 401);
    }

    const tracer = new AgentTracer();
    // Build the graph WITHOUT a callback config; pass the tracer through to
    // the OnboardingAgent so it ends up in `streamEvents`'s config.callbacks.
    // Without that path, BaseCallbackHandler hooks (handleToolStart/End) don't
    // fire on tool invocations and the AgentTraceEnvelope ships empty toolCalls.
    const graph = buildOnboardingGraph({ repo });

    // Drives the in-process LangGraph and emits AG-UI events. We intentionally
    // do NOT use `@copilotkit/runtime/langgraph`'s `LangGraphAgent` — that
    // class is a remote-only client (constructor requires `deploymentUrl` +
    // `graphId`, ignores any locally-passed graph) and its first call would
    // be `client.assistants.search()` against LangSmith Cloud. See
    // `agents/onboarding/agent.ts` for the in-process bridge.
    const input = (await c.req.json()) as RunAgentInput;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      level: 'INFO',
      message: 'onboarding /invocations',
      threadId: input.threadId,
      runId: input.runId,
      messageCount: Array.isArray(input.messages) ? input.messages.length : -1,
      stateKeys: input.state && typeof input.state === 'object' ? Object.keys(input.state as object) : [],
      tenantId,
      sessionId,
    }));
    const agent = new OnboardingAgent({
      graph,
      threadId: input.threadId,
      callbacks: [tracer],
      identity: { tenantId, userId, sessionId },
    });
    const encoder = new EventEncoder({ accept: c.req.header('accept') });

    // AG-UI clients (e.g. @ag-ui/client.HttpAgent) read this as a
    // text/event-stream. Hono's stream() defaults to text/plain — explicit
    // headers ensure the browser EventSource pipeline activates and the
    // CloudFront CORS policy lets the response through with the right CT.
    c.header('Content-Type', encoder.getContentType());
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');

    let status: 'success' | 'error' = 'success';
    return stream(c, async (sseStream) => {
      sseStream.onAbort(() => {
        // Client disconnected; the rxjs subscription closes when the
        // stream's `write` rejects below, so no extra cleanup needed.
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const subscription = agent.run(input).subscribe({
            next: (event) => {
              void sseStream.write(encoder.encodeSSE(event));
            },
            error: (err) => {
              status = 'error';
              reject(err);
            },
            complete: () => resolve(),
          });
          sseStream.onAbort(() => subscription.unsubscribe());
        });
      } catch (err) {
        status = 'error';
        // eslint-disable-next-line no-console
        console.error(JSON.stringify({
          level: 'ERROR',
          message: 'onboarding agent stream error',
          errorName: (err as Error)?.name,
          errorMessage: (err as Error)?.message,
          errorStack: (err as Error)?.stack,
        }));
      } finally {
        // Emit the trace envelope HERE, INSIDE the stream callback, so it runs
        // AFTER the agent's run() Observable completes. Hono's `stream()`
        // returns the Response synchronously and continues the callback in the
        // background — putting `tracer.build()` in the outer try/finally
        // executes it before any tool/LLM event has been processed, leaving
        // toolCalls and llmCalls empty in the envelope.
        if (sessionId && tenantId) {
          const envelope = tracer.build(status);
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({
            level: 'INFO',
            message: 'onboarding trace envelope',
            tenantId,
            toolCallsCount: envelope.toolCalls.length,
            toolNames: envelope.toolCalls.map((t) => t.toolName),
            llmCallsCount: envelope.llmCalls.length,
            status,
          }));
          emitter
            .emit(envelope, { tenantId, correlationId: tenantId, agent: 'onboarding' })
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
    }) as unknown as Response;
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
