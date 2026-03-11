// Set env BEFORE module import (top-level const in handler captures it)
process.env.BUS_NAME = 'test-advisory-event-bus';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutEvents', input })),
}));

jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
}));

import { handler } from '../src/handlers/tools/event-publisher';

describe('event-publisher tool handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should publish event to EventBridge with correct bus name', async () => {
    const { PutEventsCommand } = require('@aws-sdk/client-eventbridge');

    await handler({
      eventType: 'DECISION_CREATED',
      detail: { decisionId: 'd1', tenantId: 't1' },
    });

    expect(PutEventsCommand).toHaveBeenCalledWith({
      Entries: [
        expect.objectContaining({
          EventBusName: 'test-advisory-event-bus',
          Source: 'advisory-ctrl',
          DetailType: 'DECISION_CREATED',
          Detail: JSON.stringify({ decisionId: 'd1', tenantId: 't1' }),
        }),
      ],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should return success response', async () => {
    const result = await handler({
      eventType: 'REBALANCE_PROPOSED',
      detail: { portfolioId: 'p1' },
    });

    expect(result).toEqual({ published: true, eventType: 'REBALANCE_PROPOSED' });
  });
});
