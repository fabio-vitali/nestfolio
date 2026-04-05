import { EventBridgeClient as AwsEBClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import type { IntegrationContext } from '../context';

export class EventBridgeClient {
  private readonly client: AwsEBClient;
  private readonly ctx: IntegrationContext;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new AwsEBClient({ region: ctx.region });
  }

  async putEvent(params: {
    bus: string;
    targetService: string;
    detailType: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    const busArn = await this.ctx.ssm.busArn(params.bus);

    const detail = {
      id: `integ-${randomUUID()}`,
      type: params.detailType,
      timestamp: new Date().toISOString(),
      subject: params.detail,
      context: {
        tenantId: this.ctx.tenantId,
        userId: this.ctx.userId,
        region: this.ctx.region,
      },
    };

    await this.client.send(new PutEventsCommand({
      Entries: [{
        EventBusName: busArn,
        Source: `integration-test:${params.targetService}`,
        DetailType: params.detailType,
        Detail: JSON.stringify(detail),
      }],
    }));
  }
}
