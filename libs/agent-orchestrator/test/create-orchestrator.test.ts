import { z } from 'zod';
import { Annotation } from '@langchain/langgraph';
import type { AgentConfig, OrchestratorConfig } from '../src/types';

// Mock ChatBedrockConverse to prevent real Bedrock calls
const mockInvoke = jest.fn().mockResolvedValue({ result: 'mock-output' });
jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
}));

import { createOrchestrator } from '../src/create-orchestrator';

describe('createOrchestrator', () => {
  beforeEach(() => jest.clearAllMocks());
  const testSchema = z.object({ result: z.string() });

  const TestState = Annotation.Root({
    input: Annotation<string | undefined>,
    alpha: Annotation<Record<string, unknown> | undefined>,
    beta: Annotation<Record<string, unknown> | undefined>,
  });

  type TestAgentKey = 'alpha' | 'beta';

  const makeConfig = (overrides?: Partial<AgentConfig<typeof testSchema>>): AgentConfig<typeof testSchema> => ({
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    maxTokens: 1024,
    temperature: 0.0,
    schema: testSchema,
    promptTemplate: 'test: {input}',
    ...overrides,
  });

  it('returns a compiled graph with an invoke method', () => {
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [{ agents: ['alpha', 'beta'] }],
      stateAnnotation: TestState,
      agents: {
        alpha: makeConfig(),
        beta: makeConfig(),
      },
    };
    const graph = createOrchestrator(config);
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
  });

  it('creates sequential edges between waves', () => {
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [
        { agents: ['alpha'] },
        { agents: ['beta'], dependsOn: ['alpha'] },
      ],
      stateAnnotation: TestState,
      agents: {
        alpha: makeConfig(),
        beta: makeConfig(),
      },
    };
    const graph = createOrchestrator(config);
    expect(graph).toBeDefined();
  });

  it('throws if wave references unknown agent key', () => {
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [{ agents: ['alpha', 'unknown' as any] }],
      stateAnnotation: TestState,
      agents: { alpha: makeConfig(), beta: makeConfig() },
    };
    expect(() => createOrchestrator(config)).toThrow(/unknown agent/i);
  });

  it('wave node propagates AgentNodeResult discriminant for each agent', async () => {
    mockInvoke.mockResolvedValue({ result: 'parallel-output' });
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [{ agents: ['alpha', 'beta'] }],
      stateAnnotation: TestState,
      agents: {
        alpha: makeConfig(),
        beta: makeConfig(),
      },
    };
    const graph = createOrchestrator(config);
    const result = await graph.invoke({ input: 'go' });
    expect(result['alpha']).toEqual({ ok: true, output: { result: 'parallel-output' } });
    expect(result['beta']).toEqual({ ok: true, output: { result: 'parallel-output' } });
  });

  it('wave node marks an agent ok:false when its decorator stack throws and no fallback is configured', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('alpha down'));
    mockInvoke.mockResolvedValueOnce({ result: 'beta-up' });
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [{ agents: ['alpha', 'beta'] }],
      stateAnnotation: TestState,
      agents: {
        alpha: makeConfig(),
        beta: makeConfig(),
      },
      retryOptions: { maxAttempts: 1 },
    };
    const graph = createOrchestrator(config);
    const result = await graph.invoke({ input: 'go' });
    expect((result['alpha'] as { ok: boolean }).ok).toBe(false);
    expect((result['alpha'] as { reason: string }).reason).toMatch(/alpha down/);
    expect(result['beta']).toEqual({ ok: true, output: { result: 'beta-up' } });
  });

  // Regression: 2026-05-07. The Approach-B mode-aware portfolioValidationRule
  // depends on `ctx.state['operatingMode']` reaching the validation hook.
  // Diagnostic on deployed dev confirmed propagation works, but the only test
  // coverage was a mock that bypassed the orchestrator. This test uses the
  // REAL createOrchestrator with a real LangGraph StateGraph, only mocking
  // ChatBedrockConverse at the Bedrock boundary, and asserts that a
  // stateAnnotation-declared channel value reaches the validation rule.
  it('propagates stateAnnotation channels into validation rule ctx.state', async () => {
    mockInvoke.mockResolvedValue({ result: 'mode-aware-output' });
    const ModeState = Annotation.Root({
      input: Annotation<string | undefined>,
      operatingMode: Annotation<string | undefined>,
      alpha: Annotation<Record<string, unknown> | undefined>,
    });
    type ModeKey = 'alpha';
    const captured: Array<{ keys: string[]; operatingMode: unknown; attempt: number }> = [];
    const config: OrchestratorConfig<ModeKey, typeof ModeState.State> = {
      waves: [{ agents: ['alpha'] }],
      stateAnnotation: ModeState,
      agents: { alpha: makeConfig() },
      validationRules: {
        alpha: {
          validate: (_output, ctx) => {
            captured.push({
              keys: Object.keys(ctx?.state ?? {}),
              operatingMode: ctx?.state?.['operatingMode'],
              attempt: ctx?.attempt ?? -1,
            });
            return { valid: true, errors: [] };
          },
        },
      },
      retryOptions: { maxAttempts: 1 },
    };
    const graph = createOrchestrator(config);
    await graph.invoke({ input: 'go', operatingMode: 'CONSERVATIVE' });
    expect(captured).toHaveLength(1);
    expect(captured[0].keys).toEqual(expect.arrayContaining(['input', 'operatingMode']));
    expect(captured[0].operatingMode).toBe('CONSERVATIVE');
    expect(captured[0].attempt).toBe(0);
  });

  it('wave node uses configured fallback when agent throws', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'));
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [{ agents: ['alpha'] }],
      stateAnnotation: TestState,
      agents: { alpha: makeConfig(), beta: makeConfig() },
      fallbacks: {
        alpha: () => ({ alpha: { result: 'static-fallback' } } as any),
        beta: () => ({} as any),
      },
      retryOptions: { maxAttempts: 1 },
    };
    const graph = createOrchestrator(config);
    const result = await graph.invoke({ input: 'go' });
    expect(result['alpha']).toEqual({
      ok: false,
      reason: expect.stringMatching(/boom/),
      fallback: { alpha: { result: 'static-fallback' } },
    });
  });
});
