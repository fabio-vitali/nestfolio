import { createAgentNode } from './agent-factory';
import { AGENT_TYPES } from './model-config';

// Mock ChatBedrockConverse
const mockInvoke = jest.fn();
const mockWithStructuredOutput = jest.fn(() => ({
  invoke: mockInvoke,
}));

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    withStructuredOutput: mockWithStructuredOutput,
  })),
}));

describe('createAgentNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(AGENT_TYPES)('returns a function for agent type "%s"', (agentType) => {
    const nodeFn = createAgentNode(agentType);
    expect(typeof nodeFn).toBe('function');
  });

  it('invokes the structured model with system and human messages', async () => {
    const mockResult = { goalId: 'g1', interpretedObjective: 'Growth' };
    mockInvoke.mockResolvedValue(mockResult);

    const nodeFn = createAgentNode('user-goals');
    const state = { input: 'I want to grow my savings' };

    const result = await nodeFn(state);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const messages = mockInvoke.mock.calls[0][0];
    expect(messages).toHaveLength(2);
    expect(result).toEqual({ 'user-goals': mockResult });
  });

  it('passes the region option to ChatBedrockConverse', () => {
    const { ChatBedrockConverse } = jest.requireMock('@langchain/aws');

    createAgentNode('risk-assessment', { region: 'eu-west-1' });

    expect(ChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'eu-west-1' }),
    );
  });

  it('uses withStructuredOutput with the correct schema', () => {
    createAgentNode('market-research');
    expect(mockWithStructuredOutput).toHaveBeenCalledTimes(1);
    expect(mockWithStructuredOutput).toHaveBeenCalledWith(expect.anything());
  });
});
