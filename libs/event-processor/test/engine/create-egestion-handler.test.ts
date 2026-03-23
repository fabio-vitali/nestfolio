import { createEgestionHandler } from '../../src/engine/create-egestion-handler';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutEventsCommand: jest.fn(),
}));

jest.mock('../../src/internal', () => ({
  isRetryable: jest.fn(() => true),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('createEgestionHandler', () => {
  it('returns a Lambda handler function', () => {
    const handler = createEgestionHandler({
      serviceName: 'test',
      processRecord: jest.fn().mockResolvedValue(undefined),
    });
    expect(typeof handler).toBe('function');
  });

  it('processes records through processRecord', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const handler = createEgestionHandler({
      serviceName: 'test',
      processRecord,
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
      ],
    });
    expect(processRecord).toHaveBeenCalledTimes(1);
  });

  it('processes records through processGroup with groupBy', async () => {
    const processGroup = jest.fn().mockResolvedValue(undefined);
    const handler = createEgestionHandler({
      serviceName: 'test',
      groupBy: { key: (r) => r.tenantId },
      processGroup,
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#2', __typename: 'A', tenantId: 't1' }),
      ],
    });
    expect(processGroup).toHaveBeenCalledTimes(1);
  });
});
