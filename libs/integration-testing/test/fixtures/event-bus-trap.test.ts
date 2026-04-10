import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { SQSClient, ReceiveMessageCommand, DeleteMessageBatchCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient as AwsEbClient } from '@aws-sdk/client-eventbridge';
import { EventBusTrap } from '../../src/fixtures/event-bus-trap.fixture';
import type { IntegrationContext } from '../../src/context';

const sqsMock = mockClient(SQSClient);
mockClient(AwsEbClient);

function makeMessage(id: string, detailType: string) {
  return {
    MessageId: id,
    ReceiptHandle: `rh-${id}`,
    Body: JSON.stringify({
      'detail-type': detailType,
      detail: { id: `evt-${id}` },
      source: 'test',
      time: '2026-04-10T00:00:00Z',
    }),
  };
}

function makeCtx(): IntegrationContext {
  return {
    region: 'us-east-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    timings: { eventTimeout: 5_000, pollInterval: 100, putEventRetries: 1, putEventBackoffMs: 100 },
    cleanup: { register: jest.fn(), runAll: jest.fn() },
    ssm: { busArn: jest.fn().mockResolvedValue('arn:aws:events:us-east-1:111111111111:event-bus/test') },
  } as unknown as IntegrationContext;
}

describe('EventBusTrap dedup + auto-delete', () => {
  beforeEach(() => {
    sqsMock.reset();
  });

  it('drain dedupes messages by MessageId across receive calls', async () => {
    const trap = new EventBusTrap(makeCtx());
    // Inject a deployed queue URL via private field access (test-only)
    (trap as unknown as { queueUrl: string }).queueUrl = 'https://sqs.test/queue';

    // First receive returns msg-1; second receive (simulating visibility timeout
    // re-receive) returns the same msg-1 plus a new msg-2.
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [makeMessage('msg-1', 'EVENT_A')] })
      .resolvesOnce({ Messages: [makeMessage('msg-1', 'EVENT_A'), makeMessage('msg-2', 'EVENT_B')] });

    sqsMock.on(DeleteMessageBatchCommand).resolves({});

    const first = await trap.drain();
    const second = await trap.drain();

    expect(first).toHaveLength(1);
    expect(first[0].detailType).toBe('EVENT_A');
    expect(second).toHaveLength(1); // only msg-2, msg-1 already seen
    expect(second[0].detailType).toBe('EVENT_B');
  });

  it('drain calls DeleteMessageBatchCommand after every receive', async () => {
    const trap = new EventBusTrap(makeCtx());
    (trap as unknown as { queueUrl: string }).queueUrl = 'https://sqs.test/queue';

    sqsMock
      .on(ReceiveMessageCommand)
      .resolves({ Messages: [makeMessage('msg-x', 'EVENT_X')] });
    sqsMock.on(DeleteMessageBatchCommand).resolves({});

    await trap.drain();

    expect(sqsMock).toHaveReceivedCommandWith(DeleteMessageBatchCommand, {
      QueueUrl: 'https://sqs.test/queue',
      Entries: [{ Id: 'msg-x', ReceiptHandle: 'rh-msg-x' }],
    });
  });

  it('drain continues even when DeleteMessageBatch fails (best-effort)', async () => {
    const trap = new EventBusTrap(makeCtx());
    (trap as unknown as { queueUrl: string }).queueUrl = 'https://sqs.test/queue';

    sqsMock
      .on(ReceiveMessageCommand)
      .resolves({ Messages: [makeMessage('msg-y', 'EVENT_Y')] });
    sqsMock.on(DeleteMessageBatchCommand).rejects(new Error('SQS down'));

    const result = await trap.drain();

    expect(result).toHaveLength(1);
    expect(result[0].detailType).toBe('EVENT_Y');
  });
});
