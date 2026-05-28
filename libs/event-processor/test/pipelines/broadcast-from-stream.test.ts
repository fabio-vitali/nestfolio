import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

import { broadcastFromStream } from '../../src/pipelines/broadcast-from-stream';

const MUTATION = 'mutation PublishX($id: ID!) { publishX(id: $id) { id } }';

function makeEvent(records: Array<{
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  newImage?: Record<string, unknown>;
  oldImage?: Record<string, unknown>;
}>): DynamoDBStreamEvent {
  const marshall = (item: Record<string, unknown>): Record<string, { S?: string; N?: string; L?: unknown[] }> => {
    const out: Record<string, { S?: string; N?: string; L?: unknown[] }> = {};
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === 'string') out[k] = { S: v };
      else if (typeof v === 'number') out[k] = { N: String(v) };
      else if (Array.isArray(v)) out[k] = { L: [] };
    }
    return out;
  };
  return {
    Records: records.map((r, i) => ({
      eventID: `evt-${i}`,
      eventName: r.eventName,
      eventSource: 'aws:dynamodb',
      dynamodb: {
        ...(r.newImage ? { NewImage: marshall(r.newImage) } : {}),
        ...(r.oldImage ? { OldImage: marshall(r.oldImage) } : {}),
      },
    })),
  } as unknown as DynamoDBStreamEvent;
}

describe('broadcastFromStream', () => {
  beforeEach(() => {
    (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('broadcasts on INSERT for matched typename (skipInsert default false)', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: {
          mutation: MUTATION,
          mapImage: (img) => ({ id: img['id'] }),
        },
      },
    });
    await handler(makeEvent([{ eventName: 'INSERT', newImage: { sk: 'Foo', id: 'a' } }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledWith(expect.objectContaining({
      mutation: MUTATION, variables: { id: 'a' },
    }));
  });

  it('skips INSERT when skipInsert true', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: { mutation: MUTATION, skipInsert: true, mapImage: (img) => ({ id: img['id'] }) },
      },
    });
    await handler(makeEvent([{ eventName: 'INSERT', newImage: { sk: 'Foo', id: 'a' } }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('skips MODIFY when no whenChanged field changed', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: { mutation: MUTATION, whenChanged: ['status'], mapImage: (img) => ({ id: img['id'] }) },
      },
    });
    await handler(makeEvent([{
      eventName: 'MODIFY',
      oldImage: { sk: 'Foo', id: 'a', status: 'X', other: 'p' },
      newImage: { sk: 'Foo', id: 'a', status: 'X', other: 'q' },
    }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('broadcasts MODIFY when a whenChanged field changes', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: { mutation: MUTATION, whenChanged: ['status'], mapImage: (img) => ({ id: img['id'] }) },
      },
    });
    await handler(makeEvent([{
      eventName: 'MODIFY',
      oldImage: { sk: 'Foo', id: 'a', status: 'X' },
      newImage: { sk: 'Foo', id: 'a', status: 'Y' },
    }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
  });

  it('skips records with unmatched typename', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: { Foo: { mutation: MUTATION, mapImage: () => ({}) } },
    });
    await handler(makeEvent([{ eventName: 'INSERT', newImage: { sk: 'Bar', id: 'x' } }]), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('shouldBroadcast escape hatch overrides whenChanged', async () => {
    const shouldBroadcast = jest.fn().mockReturnValue(true);
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: {
          mutation: MUTATION,
          whenChanged: ['status'],
          shouldBroadcast,
          mapImage: (img) => ({ id: img['id'] }),
        },
      },
    });
    await handler(makeEvent([{
      eventName: 'MODIFY',
      oldImage: { sk: 'Foo', id: 'a', status: 'X' },
      newImage: { sk: 'Foo', id: 'a', status: 'X' },
    }]), {} as never, () => {});
    expect(shouldBroadcast).toHaveBeenCalledTimes(1);
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
  });

  it('rethrows when postAppSyncMutation rejects (at-least-once contract)', async () => {
    (postAppSyncMutation as jest.Mock).mockRejectedValueOnce(new Error('appsync-down'));
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: { mutation: MUTATION, mapImage: (img) => ({ id: img['id'] }) },
      },
    });
    await expect(
      handler(makeEvent([{ eventName: 'INSERT', newImage: { sk: 'Foo', id: 'a' } }]), {} as never, () => {}),
    ).rejects.toThrow('appsync-down');
  });

  it('treats empty whenChanged array as always-broadcast on MODIFY', async () => {
    const handler = broadcastFromStream({
      serviceName: 'svc', appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Foo: { mutation: MUTATION, whenChanged: [], mapImage: (img) => ({ id: img['id'] }) },
      },
    });
    await handler(makeEvent([{
      eventName: 'MODIFY',
      oldImage: { sk: 'Foo', id: 'a', status: 'X' },
      newImage: { sk: 'Foo', id: 'a', status: 'X' },
    }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
  });
});

describe('broadcastFromStream dispatch key', () => {
  beforeEach(() => (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('dispatches by __typename when sk is compound', async () => {
    const handler = broadcastFromStream({
      serviceName: 'test',
      appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        Activity: {
          mutation: 'mutation X { x }',
          mapImage: (img) => ({ ok: img['__typename'] }),
        },
      },
    });
    await handler(makeEvent([{
      eventName: 'INSERT',
      newImage: {
        pk: 'T#tenant1',
        sk: 'Activity#2026-05-28T00:00:00Z#evt-42',
        __typename: 'Activity',
        activityId: 'evt-42',
      },
    }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    expect((postAppSyncMutation as jest.Mock).mock.calls[0][0].variables).toEqual({ ok: 'Activity' });
  });

  it('still dispatches scalar-sk rows (backwards-compat)', async () => {
    const handler = broadcastFromStream({
      serviceName: 'test',
      appsyncUrl: 'https://x.example/graphql',
      broadcasts: {
        AdvisoryStatus: {
          mutation: 'mutation X { x }',
          mapImage: () => ({ ok: true }),
        },
      },
    });
    await handler(makeEvent([{
      eventName: 'INSERT',
      newImage: {
        pk: 'T#tenant1',
        sk: 'AdvisoryStatus',
        __typename: 'AdvisoryStatus',
        pendingDecisionsCount: 1,
      },
    }]), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
  });
});
