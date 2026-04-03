import { AIMessage } from '@langchain/core/messages';

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked investor profile analysis.' })),
  })),
}));

import { buildGraph } from '../agents/graph';

describe('investor-profile-ctrl agent graph', () => {
  it('compiles and returns a response for a prompt', async () => {
    const graph = buildGraph();
    const result = await graph.invoke({
      messages: [{ role: 'user', content: 'Analyze investor risk tolerance and goals.' }],
    });
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Mocked investor profile analysis.');
  });
});
