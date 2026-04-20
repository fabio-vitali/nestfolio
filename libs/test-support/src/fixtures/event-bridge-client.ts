import { EventBridgeClient as AwsEBClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import type { TestContext } from '../context';

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
  }): Promise<void> {
    const busArn = await this.ctx.ssm.busArn(params.bus);
    const maxRetries = this.ctx.timings.putEventRetries;
    const baseBackoff = this.ctx.timings.putEventBackoffMs;
    const targets = Array.isArray(params.targetService)
      ? params.targetService
      : [params.targetService];
    if (targets.length === 0) {
      throw new Error('putEvent: targetService must not be an empty array');
    }

    const detail = {
      id: params.eventId ?? `integ-${randomUUID()}`,
      type: params.detailType,
      timestamp: new Date().toISOString(),
      subject: params.detail,
      context: {
        tenantId: this.ctx.tenantId,
        userId: this.ctx.userId,
        region: this.ctx.region,
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
