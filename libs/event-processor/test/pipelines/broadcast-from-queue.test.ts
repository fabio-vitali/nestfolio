import type { SQSEvent } from 'aws-lambda';

const postAppSyncMutation = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

import { broadcastFromQueue } from '../../src/pipelines/broadcast-from-queue';

const MUTATION = 'mutation PublishX($id: ID!) { publishX(id: $id) { id } }';

function makeSqsEvent(events: Array<{ type: string; subject: Record<string, unknown> }>): SQSEvent {
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

describe('broadcastFromQueue', () => {
  beforeEach(() => {
    (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('broadcasts a single mutation when mapPayload returns an object', async () => {
    const handler = broadcastFromQueue({
      serviceName: 'svc',
      appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        FOO_HAPPENED: {
          mutation: MUTATION,
          mapPayload: (payload) => ({ id: (payload.subject as { id: string })['id'] }),
        },
      },
    });
    const result = await handler(
      makeSqsEvent([{ type: 'FOO_HAPPENED', subject: { id: 'a' } }]),
      {} as never,
      () => {},
    );
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    expect(postAppSyncMutation).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { id: 'a' } }),
    );
    expect(result?.batchItemFailures ?? []).toEqual([]);
  });

  it('broadcasts N mutations when mapPayload returns an array (fan-out)', async () => {
    const handler = broadcastFromQueue({
      serviceName: 'svc',
      appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        FAN_OUT: {
          mutation: MUTATION,
          mapPayload: () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        },
      },
    });
    await handler(
      makeSqsEvent([{ type: 'FAN_OUT', subject: {} }]),
      {} as never,
      () => {},
    );
    expect(postAppSyncMutation).toHaveBeenCalledTimes(3);
    expect(postAppSyncMutation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ variables: { id: 'a' } }),
    );
    expect(postAppSyncMutation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ variables: { id: 'b' } }),
    );
    expect(postAppSyncMutation).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ variables: { id: 'c' } }),
    );
  });

  it('skips events with unconfigured types', async () => {
    const handler = broadcastFromQueue({
      serviceName: 'svc',
      appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        FOO: { mutation: MUTATION, mapPayload: () => ({}) },
      },
    });
    await handler(
      makeSqsEvent([{ type: 'BAR', subject: {} }]),
      {} as never,
      () => {},
    );
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('reports batch item failure when a record throws', async () => {
    (postAppSyncMutation as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const handler = broadcastFromQueue({
      serviceName: 'svc',
      appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        FOO: { mutation: MUTATION, mapPayload: () => ({ id: 'a' }) },
      },
    });
    const result = await handler(
      makeSqsEvent([{ type: 'FOO', subject: {} }]),
      {} as never,
      () => {},
    );
    expect(result?.batchItemFailures.length).toBe(1);
  });
});
