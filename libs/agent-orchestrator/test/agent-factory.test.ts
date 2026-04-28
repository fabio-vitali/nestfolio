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
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
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
        model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
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
        model: 'us.anthropic.claude-opus-4-6-v1',
      }),
    );
  });
});

describe('createAgentNode — RunnableConfig propagation', () => {
  const testSchema = z.object({ value: z.string() });
  const config: AgentConfig<typeof testSchema> = {
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
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

describe('createAgentNode — AGENT_MODEL_OVERRIDE (cost-cap downgrade)', () => {
  const testSchema = z.object({ value: z.string() });

  const sonnetConfig: AgentConfig<typeof testSchema> = {
    modelId: 'us.anthropic.claude-sonnet-4-6',
    maxTokens: 1024,
    temperature: 0,
    schema: testSchema,
    promptTemplate: '{input}',
  };

  const opusConfig: AgentConfig<typeof testSchema> = {
    modelId: 'us.anthropic.claude-opus-4-6-v1',
    maxTokens: 1024,
    temperature: 0,
    schema: testSchema,
    promptTemplate: '{input}',
  };

  const haikuConfig: AgentConfig<typeof testSchema> = {
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    maxTokens: 1024,
    temperature: 0,
    schema: testSchema,
    promptTemplate: '{input}',
  };

  const ORIGINAL_OVERRIDE = process.env['AGENT_MODEL_OVERRIDE'];

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env['AGENT_MODEL_OVERRIDE'];
  });

  afterAll(() => {
    if (ORIGINAL_OVERRIDE === undefined) delete process.env['AGENT_MODEL_OVERRIDE'];
    else process.env['AGENT_MODEL_OVERRIDE'] = ORIGINAL_OVERRIDE;
  });

  it('unset env: no effect — Sonnet config invokes with Sonnet model', async () => {
    const node = createAgentNode(sonnetConfig);
    await node({ input: 'test' });
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'us.anthropic.claude-sonnet-4-6' }),
    );
  });

  it('AGENT_MODEL_OVERRIDE=haiku downgrades Sonnet config to Haiku', async () => {
    process.env['AGENT_MODEL_OVERRIDE'] = 'haiku';
    const node = createAgentNode(sonnetConfig);
    await node({ input: 'test' });
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' }),
    );
  });

  it('smart-skip: AGENT_MODEL_OVERRIDE=haiku does NOT touch Opus configs', async () => {
    process.env['AGENT_MODEL_OVERRIDE'] = 'haiku';
    const node = createAgentNode(opusConfig);
    await node({ input: 'test' });
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'us.anthropic.claude-opus-4-6-v1' }),
    );
  });

  it('AGENT_MODEL_OVERRIDE=haiku is a no-op when config already at Haiku', async () => {
    process.env['AGENT_MODEL_OVERRIDE'] = 'haiku';
    const node = createAgentNode(haikuConfig);
    await node({ input: 'test' });
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' }),
    );
  });

  it('no-upgrade rule: AGENT_MODEL_OVERRIDE=opus does NOT upgrade a Sonnet config', async () => {
    process.env['AGENT_MODEL_OVERRIDE'] = 'opus';
    const node = createAgentNode(sonnetConfig);
    await node({ input: 'test' });
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'us.anthropic.claude-sonnet-4-6' }),
    );
  });

  it('AGENT_MODEL_OVERRIDE=sonnet downgrades Sonnet to Sonnet (no-op) and skips Opus', async () => {
    process.env['AGENT_MODEL_OVERRIDE'] = 'sonnet';
    const opusNode = createAgentNode(opusConfig);
    await opusNode({ input: 'test' });
    expect(MockChatBedrockConverse).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'us.anthropic.claude-opus-4-6-v1' }),
    );
  });

  it('invalid AGENT_MODEL_OVERRIDE value is ignored', async () => {
    process.env['AGENT_MODEL_OVERRIDE'] = 'gpt-9';
    const node = createAgentNode(sonnetConfig);
    await node({ input: 'test' });
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'us.anthropic.claude-sonnet-4-6' }),
    );
  });

  it('__escalationTier on state wins over AGENT_MODEL_OVERRIDE', async () => {
    process.env['AGENT_MODEL_OVERRIDE'] = 'haiku';
    const node = createAgentNode(sonnetConfig);
    await node({ input: 'test', __escalationTier: 'opus' });
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'us.anthropic.claude-opus-4-6-v1' }),
    );
  });
});
