import type { DynamoDBStreamEvent } from 'aws-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

const aggregateMock = jest.fn<Promise<{
  inFlightCount: number; generatingCount: number; failedCount: number; oldestGeneratingAt: string | null;
}>, [string]>();
jest.mock('../../../src/repositories/advisory.repository', () => ({
  AdvisoryRepository: jest.fn().mockImplementation(() => ({
    deriveAdvisoryAggregate: aggregateMock,
  })),
}));

process.env.TABLE_NAME = 'test-table';

import { handler } from '../../../src/handlers/advisory-status-projector';

function streamEvent(rows: Record<string, unknown>[]): DynamoDBStreamEvent {
  return {
    Records: rows.map((row, i) => ({
      eventID: `evt-${i}`,
      eventName: 'MODIFY',
      eventSource: 'aws:dynamodb',
      dynamodb: { NewImage: marshall(row, { removeUndefinedValues: true }) },
    })),
  } as unknown as DynamoDBStreamEvent;
}

describe('advisory-status-projector', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.onAnyCommand().resolves({});
    aggregateMock.mockReset();
  });

  it('recomputes AdvisoryStatus (4 fields) via an atomic __version self-increment', async () => {
    aggregateMock.mockResolvedValue({
      inFlightCount: 3, generatingCount: 1, failedCount: 0,
      oldestGeneratingAt: '2026-06-05T09:00:00.000Z',
    });

    await handler(streamEvent([{ __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' }]));

    expect(aggregateMock).toHaveBeenCalledWith('t1');
    type UpdateInput = {
      Key?: Record<string, unknown>;
      UpdateExpression?: string;
      ExpressionAttributeNames?: Record<string, string>;
      ExpressionAttributeValues?: Record<string, unknown>;
    };
    const call = (ddbMock.calls() as Array<{ args: [{ input: UpdateInput }] }>)
      .find((c) => c.args[0].input.Key?.sk === 'AdvisoryStatus');
    expect(call).toBeDefined();
    const input = call!.args[0].input;
    expect(input.Key!.pk).toBe('T#t1');
    const names = Object.values(input.ExpressionAttributeNames!);
    expect(names).toEqual(expect.arrayContaining([
      'inFlightCount', 'generatingCount', 'failedCount', 'oldestGeneratingAt', '__version',
    ]));
    const values = Object.values(input.ExpressionAttributeValues!);
    expect(values).toEqual(expect.arrayContaining([3, 1, 0, '2026-06-05T09:00:00.000Z']));
    // __version is bumped via an atomic ADD self-increment, NOT a Date.now() PutItem.
    expect(input.UpdateExpression).toMatch(/\bADD\b/);
  });

  it('ignores AdvisoryStatus records (no recompute loop)', async () => {
    await handler(streamEvent([{ __typename: 'AdvisoryStatus', tenantId: 't1', pk: 'T#t1' }]));

    expect(aggregateMock).not.toHaveBeenCalled();
  });

  it('recomputes once per tenant even with multiple DecisionReadModel records', async () => {
    aggregateMock.mockResolvedValue({ inFlightCount: 1, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null });

    await handler(streamEvent([
      { __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' },
      { __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d2' },
    ]));

    expect(aggregateMock).toHaveBeenCalledTimes(1);
  });
});
