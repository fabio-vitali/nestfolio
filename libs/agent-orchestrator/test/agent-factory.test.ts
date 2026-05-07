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
import { DegradedStructuredOutputError } from '../src/errors';

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

describe('createAgentNode — Phase γ.4 structured-output retry', () => {
  // Spec 3 (services/investor/onboarding-bff/src/agent/phase-node.ts, commit
  // fa78514c) showed that retrying once with tool_choice pinned recovers
  // Sonnet 4.6's intermittent zero-tool-call cases. This test suite exercises
  // the lib-level equivalent.
  const testSchema = z.object({
    value: z.string(),
    items: z.array(z.string()),
  });
  const config: AgentConfig<typeof testSchema> = {
    modelId: 'us.anthropic.claude-sonnet-4-6',
    maxTokens: 1024,
    temperature: 0.0,
    schema: testSchema,
    promptTemplate: 'agent {input}',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env['AGENT_MODEL_OVERRIDE'];
  });

  it('happy path: when first invoke returns a populated payload, no retry is taken', async () => {
    mockInvoke.mockResolvedValueOnce({ value: 'ok', items: ['a', 'b'] });
    const node = createAgentNode(config);
    const result = await node({ input: 'go' });
    expect(result).toEqual({ value: 'ok', items: ['a', 'b'] });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // Only one withStructuredOutput call (no pinned-retry second instantiation)
    expect(mockWithStructuredOutput).toHaveBeenCalledTimes(1);
  });

  it('retry path: degraded first invoke triggers tool_choice-pinned retry; populated second invoke returns', async () => {
    mockInvoke.mockResolvedValueOnce({}); // degraded
    mockInvoke.mockResolvedValueOnce({ value: 'recovered', items: ['x'] });
    const node = createAgentNode(config);
    const result = await node({ input: 'go' });
    expect(result).toEqual({ value: 'recovered', items: ['x'] });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    // Second withStructuredOutput call carries the pinned tool name option
    expect(mockWithStructuredOutput).toHaveBeenCalledTimes(2);
    const secondCallOpts = mockWithStructuredOutput.mock.calls[1][1];
    expect(secondCallOpts).toEqual(expect.objectContaining({ name: expect.any(String), includeRaw: false }));
  });

  it('double-fail path: second invoke also degraded → throws DegradedStructuredOutputError', async () => {
    mockInvoke.mockResolvedValueOnce({});
    mockInvoke.mockResolvedValueOnce({});
    const node = createAgentNode(config);
    await expect(node({ input: 'go' })).rejects.toThrow(DegradedStructuredOutputError);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('retry call carries the same RunnableConfig so AgentTracer captures both attempts', async () => {
    mockInvoke.mockResolvedValueOnce({});
    mockInvoke.mockResolvedValueOnce({ value: 'ok', items: ['a'] });
    const cb = { name: 'tracer' };
    const runnableConfig = { callbacks: [cb] };
    const node = createAgentNode(config);
    await node({ input: 'go' }, runnableConfig as any);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    // Both invokes received the same runnableConfig
    expect(mockInvoke.mock.calls[0][1]).toEqual(runnableConfig);
    expect(mockInvoke.mock.calls[1][1]).toEqual(runnableConfig);
    // Second prompt carries the REINFORCE_SUFFIX
    expect(mockInvoke.mock.calls[1][0]).toEqual(expect.stringContaining('Re-emit the structured-output tool call with EVERY required field populated'));
  });
});

describe('createAgentNode — __retryFeedback prompt augmentation', () => {
  const testSchema = z.object({ value: z.string() });
  const config: AgentConfig<typeof testSchema> = {
    modelId: 'us.anthropic.claude-sonnet-4-6',
    maxTokens: 1024,
    temperature: 0.0,
    schema: testSchema,
    promptTemplate: 'Analyze: {input}',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env['AGENT_MODEL_OVERRIDE'];
  });

  it('appends PRIOR ATTEMPT FEEDBACK section when state.__retryFeedback is set', async () => {
    mockInvoke.mockResolvedValueOnce({ value: 'recovered' });
    const node = createAgentNode(config);
    await node({ input: 'something', __retryFeedback: 'previous output had X, must be Y' });
    const promptArg = mockInvoke.mock.calls[0][0] as string;
    expect(promptArg).toContain('Analyze: something');
    expect(promptArg).toContain('PRIOR ATTEMPT FEEDBACK — your previous output was rejected. Correct it now:');
    expect(promptArg).toContain('previous output had X, must be Y');
  });

  it('emits the bare prompt when state.__retryFeedback is absent', async () => {
    mockInvoke.mockResolvedValueOnce({ value: 'ok' });
    const node = createAgentNode(config);
    await node({ input: 'something' });
    const promptArg = mockInvoke.mock.calls[0][0] as string;
    expect(promptArg).toBe('Analyze: something');
    expect(promptArg).not.toContain('PRIOR ATTEMPT FEEDBACK');
  });

  it('feedback-augmented prompt is also used by the tool_choice-pinned retry inside agent-factory', async () => {
    mockInvoke.mockResolvedValueOnce({}); // degraded → triggers in-call retry
    mockInvoke.mockResolvedValueOnce({ value: 'recovered' });
    const node = createAgentNode(config);
    await node({ input: 'something', __retryFeedback: 'corrective hint' });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    const firstPrompt = mockInvoke.mock.calls[0][0] as string;
    const secondPrompt = mockInvoke.mock.calls[1][0] as string;
    expect(firstPrompt).toContain('PRIOR ATTEMPT FEEDBACK');
    expect(firstPrompt).toContain('corrective hint');
    // Second prompt carries BOTH the feedback and the existing REINFORCE_SUFFIX
    expect(secondPrompt).toContain('PRIOR ATTEMPT FEEDBACK');
    expect(secondPrompt).toContain('corrective hint');
    expect(secondPrompt).toContain('Re-emit the structured-output tool call with EVERY required field populated');
  });
});
