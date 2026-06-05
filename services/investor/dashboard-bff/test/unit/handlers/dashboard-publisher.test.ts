import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = jest.fn().mockResolvedValue(undefined);
// broadcastFromStream imports postAppSyncMutation via relative path inside the lib.
// The moduleNameMapper resolves @nestfolio/event-processor/(.*) → lib src, so Jest
// treats both the relative and the alias as the same module — mock via the alias.
jest.mock('@nestfolio/event-processor/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

process.env.APPSYNC_URL = 'https://x.example/graphql';
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../../../src/handlers/dashboard-publisher';

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

describe('dashboard-publisher', () => {
  beforeEach(() => (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('broadcasts publishDashboardUpdate with the full advisory aggregate (MODIFY)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 1, generatingCount: 0, failedCount: 0, updatedAt: '2026-05-01T00:00:00Z' },
      newImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 2, generatingCount: 0, failedCount: 0, updatedAt: '2026-05-01T12:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      tenantId: 'tenant1',
      advisoryStatus: { pendingDecisionsCount: 2, generatingCount: 0, failedCount: 0 },
    });
  });

  it('broadcasts when only generatingCount changes (cycle start, pending unchanged)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 0, generatingCount: 0, failedCount: 0, updatedAt: '2026-05-01T00:00:00Z' },
      newImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 0, generatingCount: 1, failedCount: 0, oldestGeneratingAt: '2026-05-01T00:05:00Z', updatedAt: '2026-05-01T00:05:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables.advisoryStatus).toMatchObject({
      generatingCount: 1, oldestGeneratingAt: '2026-05-01T00:05:00Z',
    });
  });

  it('skips MODIFY when no UI-relevant field changed', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 1, updatedAt: '2026-05-01T00:00:00Z', someOtherField: 'a' },
      newImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 1, updatedAt: '2026-05-01T00:01:00Z', someOtherField: 'b' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('broadcasts on INSERT (first AdvisoryStatus materialisation)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'T#tenant1', sk: 'AdvisoryStatus', pendingDecisionsCount: 0, updatedAt: '2026-05-01T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      tenantId: 'tenant1',
      advisoryStatus: { pendingDecisionsCount: 0, generatingCount: 0, failedCount: 0, oldestGeneratingAt: null },
    });
  });

  it('skips records whose typename has no broadcast entry', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'T#tenant1', sk: 'PortfolioSummary', __typename: 'PortfolioSummary', totalValueCents: 1 },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('derives tenantId by stripping T# prefix from pk', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'T#my-tenant-42', sk: 'AdvisoryStatus', pendingDecisionsCount: 3, updatedAt: '2026-05-01T00:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables.tenantId).toBe('my-tenant-42');
  });

  it('broadcasts publishActivityUpdate on Activity row INSERT (key by __typename)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: {
        pk: 'T#tenant1',
        sk: 'Activity#2026-05-28T12:48:03Z#evt-42',
        __typename: 'Activity',
        activityId: 'evt-42',
        activityType: 'DEPOSIT_DETECTED',
        description: 'Deposit detected: 1000 USD',
        createdAt: '2026-05-28T12:48:03Z',
        metadata: '{"amountCents":100000}',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({
      tenantId: 'tenant1',
      activity: {
        activityId: 'evt-42',
        activityType: 'DEPOSIT_DETECTED',
        description: 'Deposit detected: 1000 USD',
        createdAt: '2026-05-28T12:48:03Z',
        metadata: '{"amountCents":100000}',
      },
    });
  });

  it('Activity broadcast handles null metadata', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: {
        pk: 'T#tenant1',
        sk: 'Activity#2026-05-28T12:48:03Z#evt-43',
        __typename: 'Activity',
        activityId: 'evt-43',
        activityType: 'DECISION_APPROVED',
        description: 'Decision approved: dec-1',
        createdAt: '2026-05-28T12:48:03Z',
      },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables.activity.metadata).toBeNull();
  });
});
