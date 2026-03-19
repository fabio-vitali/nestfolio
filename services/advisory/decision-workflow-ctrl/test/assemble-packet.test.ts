jest.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: jest.fn(),
  CreateEventCommand: jest.fn(),
  RetrieveMemoryRecordsCommand: jest.fn(),
}));

jest.mock('@nestfolio/agent-core', () => ({
  createMemoryClient: jest.fn(),
  createNoOpMemoryClient: jest.fn(),
}));

jest.mock('@nestfolio/event-processor', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
}));

process.env.MEMORY_ID = 'mem-test';

import { createAssemblePacketHandler } from '../src/handlers/assemble-packet';

describe('assemble-packet handler', () => {
  const mockReadUpstream = jest.fn();
  const mockMemoryClient = {
    openDecisionSession: jest.fn(() => ({
      writeAgentOutput: jest.fn(),
      readUpstreamOutput: mockReadUpstream,
      searchLongTermMemory: jest.fn(),
    })),
    searchTenantMemory: jest.fn(),
  };

  const handler = createAssemblePacketHandler({ memoryClient: mockMemoryClient as any });

  beforeEach(() => mockReadUpstream.mockReset());

  it('reads all 4 upstream outputs from Memory', async () => {
    mockReadUpstream.mockResolvedValue([{ content: '{"test":true}', score: 1, memoryRecordId: 'r1' }]);

    const result = await handler({ decisionId: 'dec-1', tenantId: 'tenant-1' });

    expect(mockReadUpstream).toHaveBeenCalledTimes(4);
    expect(mockReadUpstream).toHaveBeenCalledWith('investor-profile');
    expect(mockReadUpstream).toHaveBeenCalledWith('market-intelligence');
    expect(mockReadUpstream).toHaveBeenCalledWith('portfolio-engine');
    expect(mockReadUpstream).toHaveBeenCalledWith('advisory-narrative');
    expect(result.investorProfileOutput).toEqual({ test: true });
  });

  it('returns null for missing outputs', async () => {
    mockReadUpstream.mockResolvedValue([]);

    const result = await handler({ decisionId: 'dec-1', tenantId: 'tenant-1' });

    expect(result.investorProfileOutput).toBeNull();
    expect(result.marketAnalysisOutput).toBeNull();
  });
});
