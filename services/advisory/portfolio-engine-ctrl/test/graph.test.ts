import { AIMessage } from '@langchain/core/messages';

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked portfolio construction.' })),
  })),
}));

import { buildGraph } from '../agents/graph';

describe('portfolio-engine-ctrl agent graph', () => {
  it('compiles and returns a response for a prompt', async () => {
    const graph = buildGraph();
    const result = await graph.invoke({
      messages: [{ role: 'user', content: 'Construct a portfolio for moderate risk.' }],
    });
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Mocked portfolio construction.');
  });
});
