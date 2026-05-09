import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = jest.fn().mockResolvedValue(undefined);
// broadcastFromStream imports postAppSyncMutation via relative path inside the lib.
// The moduleNameMapper resolves @nestfolio/event-processor/(.*) → lib src, so Jest
// treats both the relative and the alias as the same module — mock via the alias.
jest.mock('@nestfolio/event-processor/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

process.env.APPSYNC_URL = 'https://x.example/graphql';
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../../../src/handlers/decision-publisher';

function streamEvent(record: {
  eventName: 'INSERT' | 'MODIFY';
  newImage: Record<string, unknown>;
  oldImage?: Record<string, unknown>;
}): DynamoDBStreamEvent {
  const m = (item: Record<string, unknown>): Record<string, { S?: string; N?: string; L?: unknown[]; BOOL?: boolean; NULL?: boolean }> => {
    const out: Record<string, { S?: string; N?: string; L?: unknown[]; BOOL?: boolean; NULL?: boolean }> = {};
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === 'string') out[k] = { S: v };
      else if (typeof v === 'number') out[k] = { N: String(v) };
      else if (typeof v === 'boolean') out[k] = { BOOL: v };
      else if (v === null) out[k] = { NULL: true };
      else if (Array.isArray(v)) out[k] = { L: [] };
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

describe('decision-publisher', () => {
  beforeEach(() => (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('broadcasts when DecisionReadModel.status flips to AWAITING_CONFIRMATION', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' },
      newImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'AWAITING_CONFIRMATION', explanation: 'rationale', version: 2, updatedAt: '2026-05-02T00:00:01Z', trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      decisionId: 'd1', tenantId: 't1', status: 'AWAITING_CONFIRMATION',
      explanation: 'rationale', version: 2,
      trigger: 'PORTFOLIO_DRIFT',
      createdAt: '2026-05-02T00:00:00Z',
    });
  });

  it('skips MODIFY when no UI-relevant field changed', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, taskToken: 'a' },
      newImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, taskToken: 'b' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('broadcasts on INSERT (initial materialisation visible to early subscribers)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1', status: 'PENDING', explanation: '', version: 1, updatedAt: '2026-05-02T00:00:00Z', trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({ trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z' });
  });

  it('propagates confirmedAt/rejectedAt/rejectionReason/confirmationRequired to the broadcast', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: {
        sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1',
        status: 'AWAITING_CONFIRMATION', explanation: 'rationale', version: 2,
        trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z',
        confirmationRequired: true, confirmedAt: null, rejectedAt: null, rejectionReason: null,
      },
      newImage: {
        sk: 'DecisionReadModel', decisionId: 'd1', tenantId: 't1',
        status: 'CONFIRMED', explanation: 'rationale', version: 3,
        updatedAt: '2026-05-02T00:00:05Z',
        trigger: 'PORTFOLIO_DRIFT', createdAt: '2026-05-02T00:00:00Z',
        confirmationRequired: true, confirmedAt: '2026-05-02T00:00:05Z',
        rejectedAt: null, rejectionReason: null,
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      decisionId: 'd1',
      tenantId: 't1',
      status: 'CONFIRMED',
      version: 3,
      confirmationRequired: true,
      confirmedAt: '2026-05-02T00:00:05Z',
      rejectedAt: null,
      rejectionReason: null,
    });
  });

  it('skips records with sk other than DecisionReadModel', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { sk: 'UserConfirmation', decisionId: 'd1', tenantId: 't1' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
});

describe('AdvisoryStatus broadcast', () => {
  beforeEach(() => (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('publishes AdvisoryStatus changes via publishAdvisoryStatusUpdate mutation', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: {
        pk: 'T#tenant-1',
        sk: 'AdvisoryStatus',
        __typename: 'AdvisoryStatus',
        inFlightCount: 1,
        lastTriggerAt: '2026-05-09T09:59:00.000Z',
        updatedAt: '2026-05-09T09:59:00.000Z',
      },
      newImage: {
        pk: 'T#tenant-1',
        sk: 'AdvisoryStatus',
        __typename: 'AdvisoryStatus',
        inFlightCount: 2,
        lastTriggerAt: '2026-05-09T10:00:00.000Z',
        updatedAt: '2026-05-09T10:00:00.000Z',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.mutation).toContain('publishAdvisoryStatusUpdate');
    expect(call.variables).toMatchObject({
      tenantId: 'tenant-1',
      inFlightCount: 2,
      lastTriggerAt: '2026-05-09T10:00:00.000Z',
      updatedAt: '2026-05-09T10:00:00.000Z',
    });
  });

  it('skips AdvisoryStatus MODIFY when inFlightCount and lastTriggerAt are unchanged', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: {
        pk: 'T#tenant-1',
        sk: 'AdvisoryStatus',
        __typename: 'AdvisoryStatus',
        inFlightCount: 2,
        lastTriggerAt: '2026-05-09T10:00:00.000Z',
        updatedAt: '2026-05-09T09:59:00.000Z',
      },
      newImage: {
        pk: 'T#tenant-1',
        sk: 'AdvisoryStatus',
        __typename: 'AdvisoryStatus',
        inFlightCount: 2,
        lastTriggerAt: '2026-05-09T10:00:00.000Z',
        updatedAt: '2026-05-09T10:00:00.000Z',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
});
