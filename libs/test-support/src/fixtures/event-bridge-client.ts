import { EventBridgeClient as AwsEBClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import { EventSubjects, type RegisteredEventName, type SubjectOf } from '@nestfolio/test-contracts';
import type { TestContext } from '../context';

/**
 * Per-test identity override for the event CONTEXT (where handlers read identity).
 * Plain strings on purpose: the test layer does not brand TenantId/UserId, and the
 * constructed envelope is identical to the production BusEvent context.
 */
export interface TestEventContext {
  tenantId?: string;
  userId?: string;
  region?: string;
}

export class EventBridgeClient {
  private readonly client: AwsEBClient;
  private readonly ctx: TestContext;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = new AwsEBClient({ region: ctx.region });
    ctx.cleanup.register('EventBridgeClient', () => {
      this.client.destroy();
      return Promise.resolve();
    });
  }

  // Typed overload — `subject` is checked at compile time against the producer schema
  // for `detailType`, and `parse`d at runtime as a backstop. Per-test identity goes in
  // `context`, NOT the subject (DRY subjects: identity-in-subject is an excess-property error).
  async putEvent<K extends RegisteredEventName>(params: {
    bus: string;
    // Single target routes only to that service's Ingress. Array fans the same envelope
    // (shared `id`) to N services, each with its own `integration-test:<service>` source.
    targetService: string | string[];
    detailType: K;
    subject: SubjectOf<K>;
    context?: TestEventContext;
    eventId?: string;
  }): Promise<void>;
  // Legacy untyped overload — retained for not-yet-migrated domains; removed per-domain
  // by the typed-fixtures retrofit (gate: tools/check-typed-fixtures.mjs).
  async putEvent(params: {
    bus: string;
    // Single target ("advisory-ctrl") routes only to that service's Ingress.
    // Array fans the same envelope (shared `id`) to N services, each with its
    // own `integration-test:<service>` source so every matching Ingress rule
    // fires. Required when a scenario must drive multiple subscribers of the
    // same detailType (e.g. advisory-ctrl + decision-workflow-ctrl both
    // consume PORTFOLIO_DRIFT_DETECTED on the advisory bus, and ctx.eventId
    // alignment requires they receive the same id).
    targetService: string | string[];
    detailType: string;
    detail: Record<string, unknown>;
    eventId?: string;
  }): Promise<void>;
  async putEvent(params: {
    bus: string;
    targetService: string | string[];
    detailType: string;
    subject?: unknown;
    detail?: Record<string, unknown>;
    context?: TestEventContext;
    eventId?: string;
  }): Promise<void> {
    const targets = Array.isArray(params.targetService)
      ? params.targetService
      : [params.targetService];
    if (targets.length === 0) {
      throw new Error('putEvent: targetService must not be an empty array');
    }

    // Resolve the subject. Typed path = parse against the registry (runtime backstop,
    // BEFORE any network call so a bad subject throws offline). Legacy path = raw detail.
    let subject: unknown;
    if ('subject' in params && params.subject !== undefined) {
      const schema = EventSubjects[params.detailType as RegisteredEventName];
      if (!schema) {
        throw new Error(`putEvent: no registered subject schema for detailType "${params.detailType}"`);
      }
      subject = schema.parse(params.subject);
    } else {
      subject = params.detail;
    }

    const busArn = await this.ctx.ssm.busArn(params.bus);
    const maxRetries = this.ctx.timings.putEventRetries;
    const baseBackoff = this.ctx.timings.putEventBackoffMs;

    const detail = {
      id: params.eventId ?? `integ-${randomUUID()}`,
      type: params.detailType,
      timestamp: new Date().toISOString(),
      subject,
      context: {
        tenantId: params.context?.tenantId ?? this.ctx.tenantId,
        userId: params.context?.userId ?? this.ctx.userId,
        region: params.context?.region ?? this.ctx.region,
      },
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.client.send(new PutEventsCommand({
          Entries: targets.map((target) => ({
            EventBusName: busArn,
            Source: `integration-test:${target}`,
            DetailType: params.detailType,
            Detail: JSON.stringify(detail),
          })),
        }));
        if (result.FailedEntryCount === 0) return;
        if (attempt === maxRetries) {
          throw new Error(`putEvent failed after ${maxRetries} retries: ${result.Entries?.[0]?.ErrorMessage}`);
        }
      } catch (err) {
        if (attempt === maxRetries) throw err;
      }
      await new Promise(r => setTimeout(r, baseBackoff * Math.pow(2, attempt)));
    }
  }
}
