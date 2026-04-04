const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  RetrieveCommand: jest.fn().mockImplementation((input) => ({ _type: 'Retrieve', input })),
}));

import { createKBClient } from './kb-retrieval';

describe('createKBClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retrieves documents from KB and returns text chunks', async () => {
    mockSend.mockResolvedValue({
      retrievalResults: [
        { content: { text: 'ETF risk factor summary' }, score: 0.92, location: { type: 'S3' } },
        { content: { text: 'Market outlook Q1' }, score: 0.85, location: { type: 'S3' } },
      ],
    });

    const client = createKBClient({ knowledgeBaseId: 'kb-123', region: 'us-east-1' });
    const results = await client.retrieve('ETF risk factors', 5);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ text: 'ETF risk factor summary', score: 0.92 });
    expect(results[1]).toEqual({ text: 'Market outlook Q1', score: 0.85 });
  });

  it('returns empty array when no results', async () => {
    mockSend.mockResolvedValue({ retrievalResults: [] });

    const client = createKBClient({ knowledgeBaseId: 'kb-123', region: 'us-east-1' });
    const results = await client.retrieve('nonexistent topic', 5);

    expect(results).toEqual([]);
  });

  it('returns empty array on error', async () => {
    mockSend.mockRejectedValue(new Error('KB unavailable'));

    const client = createKBClient({ knowledgeBaseId: 'kb-123', region: 'us-east-1' });
    const results = await client.retrieve('query', 5);

    expect(results).toEqual([]);
  });
});
