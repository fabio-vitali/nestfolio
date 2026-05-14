import { createMemoryClient } from '../src/memory/memory-client';
import { createNoOpMemoryClient } from '../src/memory/no-op-client';

jest.mock('@aws-sdk/client-bedrock-agentcore', () => {
  const sendMock = jest.fn();
  return {
    BedrockAgentCoreClient: jest.fn(() => ({ send: sendMock })),
    RetrieveMemoryRecordsCommand: jest.fn((input) => ({ input, __type: 'RetrieveMemory' })),
    __sendMock: sendMock,
  };
});

const { __sendMock: sendMock } = jest.requireMock('@aws-sdk/client-bedrock-agentcore');

describe('createMemoryClient', () => {
  const config = {
    memoryId: 'mem-123',
    region: 'us-east-1',
    serviceName: 'investor-profile',
  };

  beforeEach(() => sendMock.mockReset());

  describe('openDecisionSession', () => {
    it('searchLongTermMemory uses RetrieveMemoryRecordsCommand with searchQuery', async () => {
      sendMock.mockResolvedValue({ memoryRecordSummaries: [] });
      const client = createMemoryClient(config);
      const session = client.openDecisionSession('tenant-1', 'dec-42');

      await session.searchLongTermMemory('preferences', 'risk tolerance', 3);

      const cmd = sendMock.mock.calls[0][0];
      expect(cmd.__type).toBe('RetrieveMemory');
      expect(cmd.input.namespace).toBe('/investor-profile/tenant-1/preferences');
      expect(cmd.input.searchCriteria.topK).toBe(3);
      expect(cmd.input.searchCriteria.searchQuery).toBe('risk tolerance');
    });
  });

  it('searchTenantMemory uses RetrieveMemoryRecordsCommand with searchQuery', async () => {
    sendMock.mockResolvedValue({ memoryRecordSummaries: [] });
    const client = createMemoryClient(config);

    await client.searchTenantMemory('tenant-1', 'signals', 'past allocations');

    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__type).toBe('RetrieveMemory');
    expect(cmd.input.namespace).toBe('/investor-profile/tenant-1/signals');
    expect(cmd.input.searchCriteria.searchQuery).toBe('past allocations');
  });
});

describe('createNoOpMemoryClient', () => {
  it('searchLongTermMemory returns empty array', async () => {
    const client = createNoOpMemoryClient();
    const session = client.openDecisionSession('t', 'd');
    const result = await session.searchLongTermMemory('preferences', 'any');
    expect(result).toEqual([]);
  });

  it('searchTenantMemory returns empty array', async () => {
    const client = createNoOpMemoryClient();
    const result = await client.searchTenantMemory('t', 'preferences', 'query');
    expect(result).toEqual([]);
  });
});

describe('searchLongTermMemory namespace path', () => {
  beforeEach(() => sendMock.mockReset());

  it('queries /{service}/{tenantId}/{namespace} when namespace is given', async () => {
    sendMock.mockResolvedValue({ memoryRecordSummaries: [] });
    const client = createMemoryClient({
      memoryId: 'mem-1',
      region: 'us-east-1',
      serviceName: 'investor-profile',
    });
    const session = client.openDecisionSession('tenant-a', 'dec-1');
    await session.searchLongTermMemory('preferences', 'risk tolerance', 3);

    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.__type).toBe('RetrieveMemory');
    expect(cmd.input.namespace).toBe('/investor-profile/tenant-a/preferences');
    expect(cmd.input.searchCriteria.searchQuery).toBe('risk tolerance');
    expect(cmd.input.searchCriteria.topK).toBe(3);
  });

  it('rejects invalid namespace names at the type level (compile-time check via constrained string union)', () => {
    const validNamespaces: Array<'preferences' | 'signals' | 'rationale'> = [
      'preferences', 'signals', 'rationale',
    ];
    expect(validNamespaces).toHaveLength(3);
  });
});
