// libs/agent-core/test/agent-factory.test.ts
import { z } from 'zod';
import type { AgentConfig } from '../src/types';

const mockInvoke = jest.fn().mockResolvedValue({ value: 'test-output' });
const mockWithStructuredOutput = jest.fn().mockReturnValue({
  invoke: mockInvoke,
});
const MockChatBedrockConverse = jest.fn().mockImplementation(() => ({
  withStructuredOutput: mockWithStructuredOutput,
}));
jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: MockChatBedrockConverse,
}));

import { createAgentNode } from '../src/agent-factory';

describe('createAgentNode (generic)', () => {
  const testSchema = z.object({ value: z.string() });

  const config: AgentConfig<typeof testSchema> = {
    modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    maxTokens: 1024,
    temperature: 0.0,
    schema: testSchema,
    promptTemplate: 'You are a test agent. Analyze: {input}',
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates ChatBedrockConverse with correct model params', async () => {
    const node = createAgentNode(config);
    await node({ input: 'test' });
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic.claude-haiku-4-5-20251001-v1:0',
        maxTokens: 1024,
        temperature: 0.0,
      }),
    );
  });

  it('calls withStructuredOutput with the provided schema', async () => {
    const node = createAgentNode(config);
    await node({ input: 'test' });
    expect(mockWithStructuredOutput).toHaveBeenCalledWith(testSchema);
  });

  it('returns a callable node function', async () => {
    const node = createAgentNode(config);
    expect(typeof node).toBe('function');
  });

  it('uses __escalationTier to override model when present in state', async () => {
    const node = createAgentNode(config);
    await node({ input: 'test', __escalationTier: 'opus' });
    expect(MockChatBedrockConverse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'anthropic.claude-opus-4-6-20250501-v1:0',
      }),
    );
  });
});

describe('createAgentNode — RunnableConfig propagation', () => {
  const testSchema = z.object({ value: z.string() });
  const config: AgentConfig<typeof testSchema> = {
    modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
    maxTokens: 1024,
    temperature: 0.0,
    schema: testSchema,
    promptTemplate: '{input}',
  };

  beforeEach(() => jest.clearAllMocks());

  it('forwards RunnableConfig to structured.invoke so LangChain callbacks propagate', async () => {
    const node = createAgentNode(config);
    const mockCallback = { name: 'test-callback' };
    const runnableConfig = { callbacks: [mockCallback] };

    await node({ input: 'hello' }, runnableConfig as any);

    expect(mockInvoke).toHaveBeenCalledWith('hello', runnableConfig);
  });

  it('passes undefined config through when invoked without one', async () => {
    const node = createAgentNode(config);
    await node({ input: 'hello' });
    expect(mockInvoke).toHaveBeenCalledWith('hello', undefined);
  });
});
