import type { DynamoDBStreamEvent } from 'aws-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

const countMock = jest.fn<Promise<number>, [string]>();
jest.mock('../../../src/repositories/advisory.repository', () => ({
  AdvisoryRepository: jest.fn().mockImplementation(() => ({
    countInFlightDecisions: countMock,
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
    countMock.mockReset();
  });

  it('recomputes AdvisoryStatus on a DecisionReadModel stream record', async () => {
    countMock.mockResolvedValue(3);

    await handler(streamEvent([{ __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' }]));

    expect(countMock).toHaveBeenCalledWith('t1');
    const put = ddbMock.commandCalls(PutCommand).find((c) => c.args[0].input.Item?.sk === 'AdvisoryStatus');
    expect(put).toBeDefined();
    expect(put!.args[0].input.Item!.inFlightCount).toBe(3);
    expect(put!.args[0].input.Item!.__typename).toBe('AdvisoryStatus');
    expect(put!.args[0].input.Item!.pk).toBe('T#t1');
  });

  it('ignores AdvisoryStatus records (no recompute loop)', async () => {
    await handler(streamEvent([{ __typename: 'AdvisoryStatus', tenantId: 't1', pk: 'T#t1' }]));

    expect(countMock).not.toHaveBeenCalled();
  });

  it('recomputes once per tenant even with multiple DecisionReadModel records', async () => {
    countMock.mockResolvedValue(1);

    await handler(streamEvent([
      { __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' },
      { __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d2' },
    ]));

    expect(countMock).toHaveBeenCalledTimes(1);
  });
});
