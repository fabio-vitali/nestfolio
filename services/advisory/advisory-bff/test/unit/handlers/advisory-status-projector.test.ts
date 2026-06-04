import type { DynamoDBStreamEvent } from 'aws-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

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

  it('recomputes AdvisoryStatus via an atomic __version self-increment (UpdateCommand)', async () => {
    countMock.mockResolvedValue(3);

    await handler(streamEvent([{ __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' }]));

    expect(countMock).toHaveBeenCalledWith('t1');
    // The write is an UpdateCommand (update intent), NOT a PutItem — match by Key.sk.
    // (commandCalls(UpdateCommand) fails the instanceof identity check across
    // event-processor's duplicate @aws-sdk/lib-dynamodb copy, so match over raw calls.
    // See feedback_worktree_symlink_masks_test_failures.)
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
    // Recomputed inFlightCount written via SET.
    expect(Object.values(input.ExpressionAttributeNames!)).toContain('inFlightCount');
    expect(Object.values(input.ExpressionAttributeValues!)).toContain(3);
    // REGRESSION (the fix): __version is bumped via an atomic ADD self-increment,
    // NOT a precomputed Date.now() version on a projectVersioned PutItem.
    expect(Object.values(input.ExpressionAttributeNames!)).toContain('__version');
    expect(input.UpdateExpression).toMatch(/\bADD\b/);
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
