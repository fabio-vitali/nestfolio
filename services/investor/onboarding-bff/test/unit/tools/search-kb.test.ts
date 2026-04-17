import { handler } from '../../../src/agent/tools/search-kb.handler';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => mockSend(...args),
  })),
  RetrieveAndGenerateCommand: jest.fn().mockImplementation((input) => input),
}));

describe('search-kb handler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns generated text from Knowledge Base', async () => {
    mockSend.mockResolvedValueOnce({
      output: { text: 'Nestfolio è una piattaforma di consulenza finanziaria automatizzata.' },
    });

    const result = await handler({
      query: 'Cos\'è Nestfolio?',
    });

    expect(result).toBe('Nestfolio è una piattaforma di consulenza finanziaria automatizzata.');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns fallback message when no results', async () => {
    mockSend.mockResolvedValueOnce({ output: { text: '' } });
    const result = await handler({ query: 'something unknown' });
    expect(result).toContain('Non ho trovato');
  });
});
