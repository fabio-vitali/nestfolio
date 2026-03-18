import { createMemoryClient } from '../src/memory/memory-client';
import { createNoOpMemoryClient } from '../src/memory/no-op-client';

jest.mock('@aws-sdk/client-bedrock-agentcore', () => {
  const sendMock = jest.fn();
  return {
    BedrockAgentCoreClient: jest.fn(() => ({ send: sendMock })),
    CreateEventCommand: jest.fn((input) => ({ input, __type: 'CreateEvent' })),
    RetrieveMemoryRecordsCommand: jest.fn((input) => ({
      input,
      __type: 'RetrieveMemory',
    })),
    __sendMock: sendMock,
  };
});

const { __sendMock: sendMock } = jest.requireMock(
  '@aws-sdk/client-bedrock-agentcore'
);

describe('createMemoryClient', () => {
  const config = {
    memoryId: 'mem-123',
    region: 'us-east-1',
    serviceName: 'investor-profile',
  };

  beforeEach(() => sendMock.mockReset());

  describe('openDecisionSession', () => {
    it('writeAgentOutput sends CreateEventCommand with correct fields', async () => {
      sendMock.mockResolvedValue({});
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      await session.writeAgentOutput({ goals: 'conservative' });

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.memoryId).toBe('mem-123');
      expect(cmd.input.actorId).toBe('tenant-1');
      expect(cmd.input.sessionId).toBe('dec-42');
      expect(cmd.input.payload[0].conversational.role).toBe('ASSISTANT');
    });

    it('readUpstreamOutput queries correct upstream namespace', async () => {
      sendMock.mockResolvedValue({
        memoryRecordSummaries: [
          {
            content: { text: '{"signals":[]}' },
            score: 0.95,
            memoryRecordId: 'rec-1',
          },
        ],
      });
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      const records = await session.readUpstreamOutput('market-intelligence');

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.namespace).toBe(
        '/market-intelligence/tenant-1/decisions/dec-42'
      );
      expect(records).toHaveLength(1);
      expect(records[0].score).toBe(0.95);
    });

    it('searchLongTermMemory uses service namespace', async () => {
      sendMock.mockResolvedValue({ memoryRecordSummaries: [] });
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      await session.searchLongTermMemory('risk tolerance', 3);

      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.input.namespace).toBe('/investor-profile/tenant-1');
      expect(cmd.input.searchCriteria.topK).toBe(3);
    });
  });

  it('searchTenantMemory uses service namespace', async () => {
    sendMock.mockResolvedValue({ memoryRecordSummaries: [] });
    const client = createMemoryClient(config);

    await client.searchTenantMemory('tenant-1', 'past allocations');

    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input.namespace).toBe('/investor-profile/tenant-1');
  });
});

describe('createNoOpMemoryClient', () => {
  it('writeAgentOutput resolves without error', async () => {
    const client = createNoOpMemoryClient();
    const session = client.openDecisionSession('t', 'd');
    await expect(session.writeAgentOutput({})).resolves.toBeUndefined();
  });

  it('readUpstreamOutput returns empty array', async () => {
    const client = createNoOpMemoryClient();
    const session = client.openDecisionSession('t', 'd');
    const result = await session.readUpstreamOutput('any-service');
    expect(result).toEqual([]);
  });

  it('searchTenantMemory returns empty array', async () => {
    const client = createNoOpMemoryClient();
    const result = await client.searchTenantMemory('t', 'query');
    expect(result).toEqual([]);
  });
});
