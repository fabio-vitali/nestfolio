import { createRetryableAgentNode } from './invoke-with-retry';
import { MODERATE_USER_GOALS } from './test-fixtures/golden-outputs';

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

// Mock Logger
const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: mockLogInfo,
    warn: mockLogWarn,
    error: mockLogError,
  })),
}));

// Mock Metrics
const mockAddMetric = jest.fn();
const mockPublishStoredMetrics = jest.fn();
jest.mock('@aws-lambda-powertools/metrics', () => ({
  Metrics: jest.fn().mockImplementation(() => ({
    addMetric: mockAddMetric,
    publishStoredMetrics: mockPublishStoredMetrics,
  })),
  MetricUnit: { Count: 'Count' },
}));

describe('createRetryableAgentNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns result on first attempt when output is valid', async () => {
    mockInvoke.mockResolvedValue(MODERATE_USER_GOALS);

    const nodeFn = createRetryableAgentNode('user-goals');
    const result = await nodeFn({ input: 'test' });

    expect(result).toEqual({ 'user-goals': MODERATE_USER_GOALS });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockAddMetric).toHaveBeenCalledWith('AgentSuccess', 'Count', 1);
  });

  it('escalates to next tier on validation failure', async () => {
    const invalidOutput = {
      ...MODERATE_USER_GOALS,
      timeHorizonMonths: -5, // Invalid: negative
    };
    const validOutput = { ...MODERATE_USER_GOALS };

    mockInvoke
      .mockResolvedValueOnce(invalidOutput) // First attempt: invalid
      .mockResolvedValueOnce(validOutput); // Second attempt: valid

    const nodeFn = createRetryableAgentNode('user-goals', { maxAttempts: 3 });
    const result = await nodeFn({ input: 'test' });

    expect(result).toEqual({ 'user-goals': validOutput });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockAddMetric).toHaveBeenCalledWith('ValidationFailure', 'Count', 1);
    expect(mockAddMetric).toHaveBeenCalledWith('TierEscalation', 'Count', 1);
  });

  it('falls back to deterministic on all attempts exhausted', async () => {
    const invalidOutput = {
      ...MODERATE_USER_GOALS,
      timeHorizonMonths: -5, // Invalid
    };

    mockInvoke.mockResolvedValue(invalidOutput);

    const nodeFn = createRetryableAgentNode('user-goals', { maxAttempts: 2 });
    const result = await nodeFn({ input: 'test' });

    // Should return fallback data
    expect(result).toHaveProperty('user-goals');
    const goals = result['user-goals'] as Record<string, unknown>;
    expect(goals).toHaveProperty('goalId', 'fallback-goal');
    expect(mockAddMetric).toHaveBeenCalledWith('FallbackActivated', 'Count', 1);
  });

  it('handles invocation errors with retry and escalation', async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error('Throttling')) // First attempt: error
      .mockResolvedValueOnce(MODERATE_USER_GOALS); // Second attempt: success

    const nodeFn = createRetryableAgentNode('user-goals', { maxAttempts: 3 });
    const result = await nodeFn({ input: 'test' });

    expect(result).toEqual({ 'user-goals': MODERATE_USER_GOALS });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockAddMetric).toHaveBeenCalledWith('AgentInvocationError', 'Count', 1);
  });

  it('tracks escalation success metric when escalated model succeeds', async () => {
    const invalidOutput = {
      ...MODERATE_USER_GOALS,
      timeHorizonMonths: -5, // Invalid
    };

    mockInvoke
      .mockResolvedValueOnce(invalidOutput) // Haiku: invalid
      .mockResolvedValueOnce(MODERATE_USER_GOALS); // Sonnet: valid

    const nodeFn = createRetryableAgentNode('user-goals', { maxAttempts: 3 });
    await nodeFn({ input: 'test' });

    expect(mockAddMetric).toHaveBeenCalledWith('TierEscalationSuccess', 'Count', 1);
  });

  it('falls back to deterministic when all invocations throw errors', async () => {
    mockInvoke.mockRejectedValue(new Error('Service unavailable'));

    const nodeFn = createRetryableAgentNode('user-goals', { maxAttempts: 2 });
    const result = await nodeFn({ input: 'test' });

    expect(result).toHaveProperty('user-goals');
    const goals = result['user-goals'] as Record<string, unknown>;
    expect(goals).toHaveProperty('goalId', 'fallback-goal');
    expect(mockAddMetric).toHaveBeenCalledWith('FallbackActivated', 'Count', 1);
  });

  it('respects maxAttempts option', async () => {
    mockInvoke.mockRejectedValue(new Error('Error'));

    const nodeFn = createRetryableAgentNode('user-goals', { maxAttempts: 1 });
    await nodeFn({ input: 'test' });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('works with Opus agents that have no escalation path', async () => {
    // risk-assessment starts at Opus (1-step path)
    const validRisk = {
      riskScore: 50,
      riskCategory: 'moderate',
      maxDrawdown: 0.15,
      volatilityBudget: 0.12,
      concentrationLimits: { singleStock: 0.15, sector: 0.35 },
      rationale: 'Moderate risk profile',
    };

    mockInvoke.mockResolvedValue(validRisk);

    const nodeFn = createRetryableAgentNode('risk-assessment');
    const result = await nodeFn({ input: 'test' });

    expect(result).toEqual({ 'risk-assessment': validRisk });
  });
});
