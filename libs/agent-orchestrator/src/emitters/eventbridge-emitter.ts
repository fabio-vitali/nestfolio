import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { EventName } from '@nestfolio/event-types';
import type { AgentTraceEnvelope } from '../agent-tracer';
import type { EmitContext, TraceEmitter } from './types';

export interface EventBridgeTraceEmitterOptions {
  /** Event bus name/ARN. If empty/undefined, `emit()` becomes a no-op (see constructor). */
  busName: string | undefined;
  source: string;
  detailType: EventName;
  region?: string;
  client?: EventBridgeClient;
}

export class EventBridgeTraceEmitter implements TraceEmitter {
  private readonly client: EventBridgeClient;

  constructor(private readonly opts: EventBridgeTraceEmitterOptions) {
    this.client = opts.client ?? new EventBridgeClient({ region: opts.region ?? 'us-east-1' });
  }

  async emit(envelope: AgentTraceEnvelope, ctx: EmitContext): Promise<void> {
    // No-op when busName is absent. This lets agent servers construct the
    // emitter eagerly at module load even when EVENT_BUS_NAME is not set
    // (local dev, unit tests that exercise the server without AWS wiring).
    // Without this guard, a missing env var would fail-fast on first invocation.
    if (!this.opts.busName) return;
    await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: this.opts.source,
            DetailType: this.opts.detailType,
            EventBusName: this.opts.busName,
            Detail: JSON.stringify({
              // `context.tenantId` wrapping is REQUIRED: matches workspace
              // envelope convention (see libs/event-processor parsers) and the
              // EventBusTrap filter (libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts
              // line 70-76) which matches on `detail.context.tenantId`.
              context: { tenantId: ctx.tenantId },
              correlationId: ctx.correlationId,
              agent: ctx.agent,
              envelope,
              emittedAt: new Date().toISOString(),
            }),
          },
        ],
      }),
    );
  }
}
