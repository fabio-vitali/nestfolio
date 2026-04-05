import {
  EventBridgeClient, PutRuleCommand, PutTargetsCommand,
  RemoveTargetsCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SQSClient, CreateQueueCommand, DeleteQueueCommand,
  ReceiveMessageCommand, GetQueueAttributesCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import type { IntegrationContext } from '../context';

export interface CapturedEvent {
  detailType: string;
  detail: Record<string, unknown>;
  source: string;
  time: string;
}

export class EventBusTrap {
  private readonly eb: EventBridgeClient;
  private readonly sqs: SQSClient;
  private readonly ctx: IntegrationContext;

  private queueUrl?: string;
  private queueArn?: string;
  private ruleName?: string;
  private busArn?: string;
  private captured: CapturedEvent[] = [];

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.eb = new EventBridgeClient({ region: ctx.region });
    this.sqs = new SQSClient({ region: ctx.region });
  }

  async deploy(params: {
    bus: string;
    detailType: string | string[];
  }): Promise<void> {
    this.busArn = await this.ctx.ssm.busArn(params.bus);
    const timestamp = Date.now();
    const suffix = Math.random().toString(36).slice(2, 8);
    const trapId = `integ-trap-${timestamp}-${suffix}`;

    // Create SQS queue
    const createResult = await this.sqs.send(new CreateQueueCommand({
      QueueName: trapId,
      Attributes: {
        VisibilityTimeout: '60',
        MessageRetentionPeriod: '300',
      },
    }));
    this.queueUrl = createResult.QueueUrl!;

    // Get queue ARN
    const attrsResult = await this.sqs.send(new GetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      AttributeNames: ['QueueArn'],
    }));
    this.queueArn = attrsResult.Attributes!['QueueArn'];

    // Create EB rule
    this.ruleName = trapId;
    const detailTypes = Array.isArray(params.detailType) ? params.detailType : [params.detailType];

    await this.eb.send(new PutRuleCommand({
      Name: this.ruleName,
      EventBusName: this.busArn,
      EventPattern: JSON.stringify({
        'detail-type': detailTypes,
        detail: {
          context: {
            tenantId: [this.ctx.tenantId],
          },
        },
      }),
      State: 'ENABLED',
    }));

    // Set SQS policy to allow EB
    const policy = {
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { Service: 'events.amazonaws.com' },
        Action: 'sqs:SendMessage',
        Resource: this.queueArn,
        Condition: {
          ArnEquals: { 'aws:SourceArn': `arn:aws:events:${this.ctx.region}:*:rule/${this.busArn!.split('/').pop()}/${this.ruleName}` },
        },
      }],
    };
    await this.sqs.send(new SetQueueAttributesCommand({
      QueueUrl: this.queueUrl,
      Attributes: { Policy: JSON.stringify(policy) },
    }));

    // Add SQS target
    await this.eb.send(new PutTargetsCommand({
      Rule: this.ruleName,
      EventBusName: this.busArn,
      Targets: [{ Id: 'trap-target', Arn: this.queueArn }],
    }));

    // Wait for rule activation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Register cleanup
    this.ctx.cleanup.register('EventBusTrap', () => this.teardown());
  }

  async waitForEvent(params?: {
    detailType?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<CapturedEvent> {
    const timeout = params?.timeoutMs ?? 30_000;
    const pollInterval = params?.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      // Check captured buffer first
      if (params?.detailType) {
        const match = this.captured.find(e => e.detailType === params.detailType);
        if (match) {
          this.captured = this.captured.filter(e => e !== match);
          return match;
        }
      } else if (this.captured.length > 0) {
        return this.captured.shift()!;
      }

      // Poll SQS
      const result = await this.sqs.send(new ReceiveMessageCommand({
        QueueUrl: this.queueUrl!,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: Math.min(5, Math.ceil((deadline - Date.now()) / 1000)),
      }));

      for (const msg of result.Messages ?? []) {
        const body = JSON.parse(msg.Body!);
        const event: CapturedEvent = {
          detailType: body['detail-type'],
          detail: body.detail,
          source: body.source,
          time: body.time,
        };

        if (params?.detailType && event.detailType === params.detailType) {
          return event;
        }
        if (!params?.detailType) {
          return event;
        }
        // Buffer non-matching events
        this.captured.push(event);
      }

      if (!result.Messages?.length) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    throw new Error(`EventBusTrap: timeout waiting for event${params?.detailType ? ` ${params.detailType}` : ''} after ${timeout}ms`);
  }

  async drain(): Promise<CapturedEvent[]> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl!,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 0,
    }));

    const events: CapturedEvent[] = [...this.captured];
    this.captured = [];

    for (const msg of result.Messages ?? []) {
      const body = JSON.parse(msg.Body!);
      events.push({
        detailType: body['detail-type'],
        detail: body.detail,
        source: body.source,
        time: body.time,
      });
    }

    return events;
  }

  async teardown(): Promise<void> {
    try {
      if (this.ruleName && this.busArn) {
        await this.eb.send(new RemoveTargetsCommand({
          Rule: this.ruleName,
          EventBusName: this.busArn,
          Ids: ['trap-target'],
        }));
        await this.eb.send(new DeleteRuleCommand({
          Name: this.ruleName,
          EventBusName: this.busArn,
        }));
      }
    } catch (err) {
      console.error('EventBusTrap: failed to delete EB rule', err);
    }
    try {
      if (this.queueUrl) {
        await this.sqs.send(new DeleteQueueCommand({ QueueUrl: this.queueUrl }));
      }
    } catch (err) {
      console.error('EventBusTrap: failed to delete SQS queue', err);
    }
  }
}
