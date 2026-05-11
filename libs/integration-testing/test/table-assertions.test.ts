import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { TableAssertions } from '../src/fixtures/table-assertions';
import type { TestContext } from '@nestfolio/test-support';

const ddbMock = mockClient(DynamoDBClient);

function makeCtx(): TestContext {
  return {
    region: 'us-east-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    timings: { eventTimeout: 2_000, pollInterval: 50, putEventRetries: 1, putEventBackoffMs: 50 },
    cleanup: { register: jest.fn(), runAll: jest.fn() },
    ssm: { tableName: jest.fn().mockResolvedValue('my-table') } as unknown as TestContext['ssm'],
  } as unknown as TestContext;
}

function marshalledItem(attrs: Record<string, unknown>) {
  return marshall(attrs);
}

beforeEach(() => {
  ddbMock.reset();
});

describe('TableAssertions.waitForItem — match parameter', () => {
  describe('GetItem branch (sk provided)', () => {
    it('returns item immediately when no match param is given', async () => {
      ddbMock.on(GetItemCommand).resolves({
        Item: marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN' }),
      });

      const assertions = new TableAssertions(makeCtx());
      const item = await assertions.waitForItem({ table: 'circuit-breaker', pk: 'CB#broker', sk: 'STATE' });
      expect(item['state']).toBe('OPEN');
    });

    it('returns item when match fields equal item fields', async () => {
      ddbMock.on(GetItemCommand).resolves({
        Item: marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN' }),
      });

      const assertions = new TableAssertions(makeCtx());
      const item = await assertions.waitForItem({
        table: 'circuit-breaker',
        pk: 'CB#broker',
        sk: 'STATE',
        match: { state: 'OPEN' },
      });
      expect(item['state']).toBe('OPEN');
    });

    it('keeps polling when item exists but match field does not match, then resolves when it does', async () => {
      // First two calls return PENDING, third call returns OPEN
      ddbMock
        .on(GetItemCommand)
        .resolvesOnce({ Item: marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'PENDING' }) })
        .resolvesOnce({ Item: marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'PENDING' }) })
        .resolvesOnce({ Item: marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN' }) });

      const assertions = new TableAssertions(makeCtx());
      const item = await assertions.waitForItem({
        table: 'circuit-breaker',
        pk: 'CB#broker',
        sk: 'STATE',
        match: { state: 'OPEN' },
      });
      expect(item['state']).toBe('OPEN');
      expect(ddbMock.commandCalls(GetItemCommand).length).toBe(3);
    });

    it('times out with match description in error message when item never matches', async () => {
      ddbMock.on(GetItemCommand).resolves({
        Item: marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'PENDING' }),
      });

      const assertions = new TableAssertions(makeCtx());
      await expect(
        assertions.waitForItem({
          table: 'circuit-breaker',
          pk: 'CB#broker',
          sk: 'STATE',
          match: { state: 'OPEN' },
          timeoutMs: 100,
          pollIntervalMs: 30,
        }),
      ).rejects.toThrow('match={"state":"OPEN"}');
    });

    it('times out without match description when no match param given', async () => {
      ddbMock.on(GetItemCommand).resolves({ Item: undefined });

      const assertions = new TableAssertions(makeCtx());
      await expect(
        assertions.waitForItem({
          table: 'circuit-breaker',
          pk: 'CB#broker',
          sk: 'STATE',
          timeoutMs: 100,
          pollIntervalMs: 30,
        }),
      ).rejects.toThrow(/timeout waiting for item pk=CB#broker sk=STATE in circuit-breaker after 100ms/);
    });

    it('does not include match= in error message when match param is omitted', async () => {
      ddbMock.on(GetItemCommand).resolves({ Item: undefined });

      const assertions = new TableAssertions(makeCtx());
      await expect(
        assertions.waitForItem({
          table: 'circuit-breaker',
          pk: 'CB#broker',
          sk: 'STATE',
          timeoutMs: 100,
          pollIntervalMs: 30,
        }),
      ).rejects.toThrow(expect.objectContaining({ message: expect.not.stringContaining('match=') }));
    });
  });

  describe('Query branch (no sk)', () => {
    it('returns item immediately when no match param is given', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN' })],
      });

      const assertions = new TableAssertions(makeCtx());
      const item = await assertions.waitForItem({ table: 'circuit-breaker', pk: 'CB#broker' });
      expect(item['state']).toBe('OPEN');
    });

    it('returns item when match fields equal item fields', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN' })],
      });

      const assertions = new TableAssertions(makeCtx());
      const item = await assertions.waitForItem({
        table: 'circuit-breaker',
        pk: 'CB#broker',
        match: { state: 'OPEN' },
      });
      expect(item['state']).toBe('OPEN');
    });

    it('keeps polling when item exists but match field does not match, then resolves when it does', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'PENDING' })] })
        .resolvesOnce({ Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'PENDING' })] })
        .resolvesOnce({ Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN' })] });

      const assertions = new TableAssertions(makeCtx());
      const item = await assertions.waitForItem({
        table: 'circuit-breaker',
        pk: 'CB#broker',
        match: { state: 'OPEN' },
      });
      expect(item['state']).toBe('OPEN');
      expect(ddbMock.commandCalls(QueryCommand).length).toBe(3);
    });

    it('times out with match description when item never matches', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'PENDING' })],
      });

      const assertions = new TableAssertions(makeCtx());
      await expect(
        assertions.waitForItem({
          table: 'circuit-breaker',
          pk: 'CB#broker',
          match: { state: 'OPEN' },
          timeoutMs: 100,
          pollIntervalMs: 30,
        }),
      ).rejects.toThrow('match={"state":"OPEN"}');
    });

    it('supports multi-field match — all fields must equal', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN', failureCount: 3 })],
      });

      const assertions = new TableAssertions(makeCtx());
      const item = await assertions.waitForItem({
        table: 'circuit-breaker',
        pk: 'CB#broker',
        match: { state: 'OPEN', failureCount: 3 },
      });
      expect(item['state']).toBe('OPEN');
      expect(item['failureCount']).toBe(3);
    });

    it('keeps polling when only some match fields match', async () => {
      // state matches but failureCount does not
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN', failureCount: 1 })] })
        .resolvesOnce({ Items: [marshalledItem({ pk: 'CB#broker', sk: 'STATE', state: 'OPEN', failureCount: 3 })] });

      const assertions = new TableAssertions(makeCtx());
      const item = await assertions.waitForItem({
        table: 'circuit-breaker',
        pk: 'CB#broker',
        match: { state: 'OPEN', failureCount: 3 },
      });
      expect(item['failureCount']).toBe(3);
      expect(ddbMock.commandCalls(QueryCommand).length).toBe(2);
    });
  });
});

describe('TableAssertions.waitForItem — predicate parameter', () => {
  it('returns item when predicate returns true', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'APPROVED' }),
    });

    const assertions = new TableAssertions(makeCtx());
    const item = await assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      predicate: (i) => i['status'] === 'APPROVED',
      description: 'status === APPROVED',
    });
    expect(item['status']).toBe('APPROVED');
  });

  it('keeps polling when predicate returns false, resolves once it returns true', async () => {
    ddbMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'PENDING' }) })
      .resolvesOnce({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'PENDING' }) })
      .resolves({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'APPROVED' }) });

    const assertions = new TableAssertions(makeCtx());
    const item = await assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      predicate: (i) => i['status'] === 'APPROVED',
    });
    expect(item['status']).toBe('APPROVED');
  });

  it('AND-combines match and predicate: both must be satisfied', async () => {
    ddbMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', kind: 'X', status: 'PENDING' }) })
      .resolves({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', kind: 'X', status: 'APPROVED' }) });

    const assertions = new TableAssertions(makeCtx());
    const item = await assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      match: { kind: 'X' },
      predicate: (i) => i['status'] === 'APPROVED',
    });
    expect(item['status']).toBe('APPROVED');
  });

  it('on timeout: error includes last observed item and predicate description', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'PENDING' }),
    });

    const assertions = new TableAssertions(makeCtx());
    await expect(assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      timeoutMs: 200,
      pollIntervalMs: 50,
      predicate: (i) => i['status'] === 'APPROVED',
      description: 'status === APPROVED',
    })).rejects.toThrow(/predicate: "status === APPROVED".*Last item.*"status":"PENDING"/s);
  });

  it('on timeout with no description: predicate label says "(unlabeled)"', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', status: 'PENDING' }),
    });

    const assertions = new TableAssertions(makeCtx());
    await expect(assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      timeoutMs: 200,
      pollIntervalMs: 50,
      predicate: (i) => i['status'] === 'APPROVED',
    })).rejects.toThrow(/predicate: "\(unlabeled\)"/);
  });

  it('on timeout with no item ever observed: Last item label says "(never observed)"', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });

    const assertions = new TableAssertions(makeCtx());
    await expect(assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      timeoutMs: 200,
      pollIntervalMs: 50,
      predicate: (i) => i['status'] === 'APPROVED',
      description: 'status === APPROVED',
    })).rejects.toThrow(/Last item: \(never observed\)/);
  });

  it('predicate exceptions surface immediately (not retried)', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel' }),
    });

    const assertions = new TableAssertions(makeCtx());
    await expect(assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      timeoutMs: 1_000,
      predicate: () => { throw new Error('boom'); },
    })).rejects.toThrow('boom');
  });

  it('AND-combines: when match fails (and predicate would pass), still retries until match passes', async () => {
    ddbMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', kind: 'Y', status: 'APPROVED' }) })
      .resolves({ Item: marshalledItem({ pk: 'D#1', sk: 'Readmodel', kind: 'X', status: 'APPROVED' }) });

    const assertions = new TableAssertions(makeCtx());
    const item = await assertions.waitForItem({
      table: 'advisory-bff',
      pk: 'D#1',
      sk: 'Readmodel',
      match: { kind: 'X' },
      predicate: (i) => i['status'] === 'APPROVED',
    });
    expect(item['kind']).toBe('X');
    expect(item['status']).toBe('APPROVED');
  });
});
