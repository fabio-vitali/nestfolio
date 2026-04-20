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
});
