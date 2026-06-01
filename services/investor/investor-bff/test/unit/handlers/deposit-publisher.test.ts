import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = jest.fn().mockResolvedValue(undefined);
// broadcastFromStream imports postAppSyncMutation via a relative path inside the
// lib. The moduleNameMapper resolves @nestfolio/event-processor/(.*) → lib src,
// so Jest treats both the relative and the alias as the same module.
jest.mock('@nestfolio/event-processor/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

process.env.APPSYNC_URL = 'https://x.example/graphql';
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../../../src/handlers/deposit-publisher';

function streamEvent(record: {
  eventName: 'INSERT' | 'MODIFY';
  newImage: Record<string, unknown>;
  oldImage?: Record<string, unknown>;
}): DynamoDBStreamEvent {
  const m = (item: Record<string, unknown>): Record<string, { S?: string; N?: string; L?: unknown[] }> => {
    const out: Record<string, { S?: string; N?: string; L?: unknown[] }> = {};
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === 'string') out[k] = { S: v };
      else if (typeof v === 'number') out[k] = { N: String(v) };
    }
    return out;
  };
  return {
    Records: [{
      eventID: 'evt-1',
      eventName: record.eventName,
      eventSource: 'aws:dynamodb',
      dynamodb: {
        NewImage: m(record.newImage),
        ...(record.oldImage ? { OldImage: m(record.oldImage) } : {}),
      },
    }],
  } as unknown as DynamoDBStreamEvent;
}

describe('deposit-publisher', () => {
  beforeEach(() => (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('broadcasts publishDepositUpdate when Deposit row status REQUESTED→DETECTED (MODIFY)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1', __typename: 'Deposit', depositId: 'dep-1', status: 'REQUESTED', amountCents: 500000, currency: 'USD' },
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1', __typename: 'Deposit', depositId: 'dep-1', status: 'DETECTED', amountCents: 500000, currency: 'USD', detectedAt: '2026-06-01T12:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.mutation).toContain('publishDepositUpdate');
    expect(call.variables).toMatchObject({
      depositId: 'dep-1', status: 'DETECTED', amountCents: 500000, currency: 'USD', detectedAt: '2026-06-01T12:00:00Z',
    });
  });

  it('skips Deposit MODIFY when status is unchanged', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1', __typename: 'Deposit', depositId: 'dep-1', status: 'DETECTED', amountCents: 500000, currency: 'USD', detectedAt: '2026-06-01T12:00:00Z' },
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1', __typename: 'Deposit', depositId: 'dep-1', status: 'DETECTED', amountCents: 500000, currency: 'USD', detectedAt: '2026-06-01T12:00:00Z', updatedAt: '2026-06-01T12:00:05Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('broadcasts on Deposit INSERT (first projected REQUESTED row)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-2', __typename: 'Deposit', depositId: 'dep-2', status: 'REQUESTED', amountCents: 100000, currency: 'USD' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({ depositId: 'dep-2', status: 'REQUESTED' });
  });

  it('broadcasts publishWithdrawalUpdate when WithdrawalRequest status REQUESTED→SETTLED (MODIFY)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'InvestorProfile#t1#u1', sk: 'Withdrawal#wd-1', __typename: 'WithdrawalRequest', withdrawalId: 'wd-1', status: 'REQUESTED', amountCents: 200000, currency: 'USD' },
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Withdrawal#wd-1', __typename: 'WithdrawalRequest', withdrawalId: 'wd-1', status: 'SETTLED', amountCents: 200000, currency: 'USD', settledAt: '2026-06-01T13:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.mutation).toContain('publishWithdrawalUpdate');
    expect(call.variables).toMatchObject({
      withdrawalId: 'wd-1', status: 'SETTLED', amountCents: 200000, currency: 'USD', settledAt: '2026-06-01T13:00:00Z',
    });
  });

  it('does NOT broadcast on the DepositIntent outbox row (only the projected Deposit row)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'DepositIntent#dep-3', __typename: 'DepositIntent', depositId: 'dep-3', status: 'INITIATED', amountCents: 100000, currency: 'USD' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('mapImage emits explicit nulls for absent optional fields (Deposit REQUESTED→SETTLED, no failedAt/reason)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-4', __typename: 'Deposit', depositId: 'dep-4', status: 'REQUESTED', amountCents: 500000, currency: 'USD' },
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-4', __typename: 'Deposit', depositId: 'dep-4', status: 'SETTLED', amountCents: 500000, currency: 'USD', settledAt: '2026-06-01T14:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({ status: 'SETTLED', settledAt: '2026-06-01T14:00:00Z' });
    // toMatchObject is a subset matcher — assert the nulls explicitly.
    expect(call.variables.failedAt).toBeNull();
    expect(call.variables.reason).toBeNull();
  });

  it('broadcasts on WithdrawalRequest INSERT (first projected REQUESTED row)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Withdrawal#wd-2', __typename: 'WithdrawalRequest', withdrawalId: 'wd-2', status: 'REQUESTED', amountCents: 200000, currency: 'USD' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.mutation).toContain('publishWithdrawalUpdate');
    expect(call.variables).toMatchObject({ withdrawalId: 'wd-2', status: 'REQUESTED' });
  });
});
