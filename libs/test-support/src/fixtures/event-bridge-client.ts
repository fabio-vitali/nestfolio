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
    targetService: string;
    detailType: string;
    detail: Record<string, unknown>;
    eventId?: string;
  }): Promise<void> {
    const busArn = await this.ctx.ssm.busArn(params.bus);
    const maxRetries = this.ctx.timings.putEventRetries;
    const baseBackoff = this.ctx.timings.putEventBackoffMs;

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
          Entries: [{
            EventBusName: busArn,
            Source: `integration-test:${params.targetService}`,
            DetailType: params.detailType,
            Detail: JSON.stringify(detail),
          }],
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
