import type { SQSEvent } from 'aws-lambda';

const postAppSyncMutation = jest.fn().mockResolvedValue(undefined);
// broadcastFromQueue imports postAppSyncMutation via relative path inside the lib.
// The moduleNameMapper resolves @nestfolio/event-processor/(.*) → lib src, so Jest
// treats both the relative and the alias as the same module — mock via the alias.
jest.mock('@nestfolio/event-processor/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

process.env.APPSYNC_URL = 'https://x.example/graphql';
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../../../src/handlers/broadcast-listener';

function sqsEvent(events: Array<{ type: string; subject: Record<string, unknown> }>): SQSEvent {
  return {
    Records: events.map((e, i) => ({
      messageId: `m-${i}`,
      receiptHandle: `r-${i}`,
      body: JSON.stringify({
        id: `evt-${i}`,
        type: e.type,
        timestamp: '2026-05-02T00:00:00Z',
        subject: e.subject,
        context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
      }),
      attributes: {} as never,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: '',
      awsRegion: 'us-east-1',
    })),
  } as SQSEvent;
}

describe('broadcast-listener', () => {
  beforeEach(() => (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('on BROKER_CIRCUIT_OPEN fires updateFeatureFlag for the 3 gated flags (disabled)', async () => {
    await handler(sqsEvent([{ type: 'BROKER_CIRCUIT_OPEN', subject: {} }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(3);
    const flags = (postAppSyncMutation as jest.Mock).mock.calls.map((c) => c[0].variables);
    expect(flags).toEqual([
      { name: 'confirmDecision', enabled: false, reason: 'Broker connectivity issue', eventTimestamp: '2026-05-02T00:00:00Z' },
      { name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue', eventTimestamp: '2026-05-02T00:00:00Z' },
      { name: 'requestWithdrawal', enabled: false, reason: 'Broker connectivity issue', eventTimestamp: '2026-05-02T00:00:00Z' },
    ]);
  });

  it('on BROKER_CIRCUIT_CLOSED fires updateFeatureFlag for the 3 gated flags (enabled)', async () => {
    await handler(sqsEvent([{ type: 'BROKER_CIRCUIT_CLOSED', subject: {} }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(3);
    const flags = (postAppSyncMutation as jest.Mock).mock.calls.map((c) => c[0].variables);
    expect(flags).toEqual([
      { name: 'confirmDecision', enabled: true, eventTimestamp: '2026-05-02T00:00:00Z' },
      { name: 'initiateDeposit', enabled: true, eventTimestamp: '2026-05-02T00:00:00Z' },
      { name: 'requestWithdrawal', enabled: true, eventTimestamp: '2026-05-02T00:00:00Z' },
    ]);
  });

  it('skips events with unconfigured types', async () => {
    await handler(sqsEvent([{ type: 'BALANCE_UPDATED', subject: {} }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
});
