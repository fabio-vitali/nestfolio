import { AIMessage } from '@langchain/core/messages';

jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue(new AIMessage({ content: 'Mocked decision lifecycle response.' })),
  })),
}));

import { buildGraph } from '../agents/decision-lifecycle/graph';

describe('advisory-ctrl decision-lifecycle agent graph', () => {
  it('compiles and returns a response for a prompt', async () => {
    const graph = buildGraph();
    const result = await graph.invoke({
      messages: [{ role: 'user', content: 'Evaluate portfolio drift for tenant-123.' }],
    });
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Mocked decision lifecycle response.');
  });
});
