import {
  EventBridgeClient, PutEventsCommand, PutRuleCommand, PutTargetsCommand,
  RemoveTargetsCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SQSClient, CreateQueueCommand, DeleteQueueCommand,
  ReceiveMessageCommand, GetQueueAttributesCommand,
  SetQueueAttributesCommand, DeleteMessageBatchCommand,
} from '@aws-sdk/client-sqs';
import type { TestContext } from '@nestfolio/test-support';

export interface CapturedEvent<TDetail = Record<string, unknown>> {
  detailType: string;
  detail: TDetail;
  source: string;
  time: string;
}

export class EventBusTrap {
  private readonly eb: EventBridgeClient;
  private readonly sqs: SQSClient;
  private readonly ctx: TestContext;

  private queueUrl?: string;
  private queueArn?: string;
  private ruleName?: string;
  private busArn?: string;
  private captured: CapturedEvent[] = [];
  private readonly seenMessageIds = new Set<string>();

  constructor(ctx: TestContext) {
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

    // Create EB rule — include canary detailType for warmup verification
    this.ruleName = trapId;
    const detailTypes = Array.isArray(params.detailType) ? params.detailType : [params.detailType];

    await this.eb.send(new PutRuleCommand({
      Name: this.ruleName,
      EventBusName: this.busArn,
      EventPattern: JSON.stringify({
        'detail-type': [...detailTypes, '__INTEG_CANARY'],
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

    // Canary warmup — repeatedly send canary events and poll SQS until one arrives.
    // The EB rule may not be active when the first canary is sent (propagation delay),
    // so we resend on every poll iteration to catch the moment it activates.
    const canaryEntry = {
      EventBusName: this.busArn,
      Source: 'integration-test:canary',
      DetailType: '__INTEG_CANARY',
      Detail: JSON.stringify({ context: { tenantId: this.ctx.tenantId } }),
    };

    const canaryTimeout = this.ctx.timings.canaryTimeout;
    const canaryDeadline = Date.now() + canaryTimeout;
    let canaryReceived = false;

    while (Date.now() < canaryDeadline && !canaryReceived) {
      // Send a fresh canary on each iteration — if the rule just activated, this one will match
      await this.eb.send(new PutEventsCommand({ Entries: [canaryEntry] }));

      const result = await this.sqs.send(new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: Math.min(5, Math.ceil((canaryDeadline - Date.now()) / 1000)),
      }));

      for (const msg of result.Messages ?? []) {
        const body = JSON.parse(msg.Body!);
        if (body['detail-type'] === '__INTEG_CANARY') {
          canaryReceived = true;
          continue;
        }
        // Buffer any real events that arrived during warmup
        this.captured.push({
          detailType: body['detail-type'],
          detail: body.detail,
          source: body.source,
          time: body.time,
        });
      }
    }

    if (!canaryReceived) {
      throw new Error(`EventBusTrap: canary event did not arrive after ${canaryTimeout}ms — EB rule may not be active`);
    }

    // Register cleanup
    this.ctx.cleanup.register('EventBusTrap', () => this.teardown());
  }

  private async consumeMessages(waitTimeSeconds: number): Promise<CapturedEvent[]> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl!,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: waitTimeSeconds,
    }));

    const messages = result.Messages ?? [];
    if (messages.length === 0) return [];

    // Best-effort delete to free SQS storage and prevent visibility-timeout re-receives
    const deletable = messages
      .filter(m => m.MessageId && m.ReceiptHandle)
      .map(m => ({ Id: m.MessageId!, ReceiptHandle: m.ReceiptHandle! }));
    if (deletable.length > 0) {
      try {
        await this.sqs.send(new DeleteMessageBatchCommand({
          QueueUrl: this.queueUrl!,
          Entries: deletable,
        }));
      } catch (error) {
        // Best-effort: in-memory dedup below catches re-receives if delete fails
        // Note: not using logger here because the fixture doesn't import one;
        // a console.warn is acceptable in test infrastructure.
        // eslint-disable-next-line no-console
        console.warn('EventBusTrap: DeleteMessageBatch failed (best-effort, continuing)', error);
      }
    }

    const fresh: CapturedEvent[] = [];
    for (const msg of messages) {
      if (!msg.MessageId || this.seenMessageIds.has(msg.MessageId)) continue;
      this.seenMessageIds.add(msg.MessageId);
      const body = JSON.parse(msg.Body!);
      // Discard canary events that arrive after warmup — they are an internal
      // implementation detail and must never leak to waitForEvent() consumers.
      if (body['detail-type'] === '__INTEG_CANARY') continue;
      fresh.push({
        detailType: body['detail-type'],
        detail: body.detail,
        source: body.source,
        time: body.time,
      });
    }
    return fresh;
  }

  async waitForEvent<TDetail = Record<string, unknown>>(params?: {
    detailType?: string;
    match?: (detail: TDetail) => boolean;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<CapturedEvent<TDetail>> {
    const timeout = params?.timeoutMs ?? this.ctx.timings.eventTimeout;
    const pollInterval = params?.pollIntervalMs ?? this.ctx.timings.pollInterval;
    const deadline = Date.now() + timeout;

    const satisfies = (e: CapturedEvent): boolean => {
      if (params?.detailType && e.detailType !== params.detailType) return false;
      if (params?.match && !params.match(e.detail as TDetail)) return false;
      return true;
    };

    while (Date.now() < deadline) {
      // Check captured buffer first — events that don't satisfy the filter stay
      // in the buffer so a future waitForEvent call with different params can find them.
      const buffered = this.captured.find(satisfies);
      if (buffered) {
        this.captured = this.captured.filter(e => e !== buffered);
        return buffered as CapturedEvent<TDetail>;
      }

      // Poll SQS via the dedup-aware helper
      const fresh = await this.consumeMessages(
        Math.min(5, Math.max(1, Math.ceil((deadline - Date.now()) / 1000))),
      );

      for (const event of fresh) {
        if (satisfies(event)) {
          return event as CapturedEvent<TDetail>;
        }
        // Buffer non-matching events for a future waitForEvent call
        this.captured.push(event);
      }

      if (fresh.length === 0) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    const suffix = [
      params?.detailType ? ` ${params.detailType}` : '',
      params?.match ? ' (matching predicate)' : '',
    ].join('');
    // Surface what we DID see so trap-side test failures point at the
    // upstream cause (wrong detailType, missing field, etc.) instead of
    // a generic "timeout" message.
    const seen = this.captured.map(e => ({
      detailType: e.detailType,
      subject: (e.detail as { subject?: unknown })?.subject,
    }));
    throw new Error(
      `EventBusTrap: timeout waiting for event${suffix} after ${timeout}ms. ` +
        `Captured-but-unmatched buffer: ${JSON.stringify(seen).slice(0, 2000)}`,
    );
  }

  async drain(): Promise<CapturedEvent[]> {
    const fresh = await this.consumeMessages(0);
    const events: CapturedEvent[] = [...this.captured, ...fresh];
    this.captured = [];
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
      // eslint-disable-next-line no-console
      console.error('EventBusTrap: failed to delete EB rule', err);
    }
    try {
      if (this.queueUrl) {
        await this.sqs.send(new DeleteQueueCommand({ QueueUrl: this.queueUrl }));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('EventBusTrap: failed to delete SQS queue', err);
    }
    this.eb.destroy();
    this.sqs.destroy();
  }
}
