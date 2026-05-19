import type { IterationResult, ModelSweep, RawResults, TaskBenchConfig } from './types';

describe('types', () => {
  it('IterationResult allows null for notDegraded + validationPass', () => {
    const r: IterationResult = {
      ix: 0,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      schemaPass: false,
      notDegraded: null,
      validationPass: null,
      output: null,
      error: 'ThrottlingException',
    };
    expect(r.schemaPass).toBe(false);
  });

  it('ModelSweep aggregates carry pass-rates as N/M strings', () => {
    const s: ModelSweep = {
      modelId: 'us.anthropic.claude-sonnet-4-6',
      iterations: [],
      aggregates: {
        schemaPassRate: '3/3',
        notDegradedRate: '2/3',
        validationPassRate: null,
        medianLatencyMs: 1000,
        minLatencyMs: 800,
        maxLatencyMs: 1200,
        medianCostUSD: 0.01,
        totalCostUSD: 0.03,
        totalInputTokens: 300,
        totalOutputTokens: 200,
      },
    };
    expect(s.aggregates.schemaPassRate).toBe('3/3');
  });

  it('RawResults binds task identity fields', () => {
    const r: RawResults = {
      taskName: 'explainability',
      service: 'advisory-narrative-ctrl',
      configFilePath: 'services/advisory/advisory-narrative-ctrl/src/agents/explainability.config.ts',
      fixturePath: 'benchmarks/fixtures/explainability.input.json',
      iterationsPerCombo: 3,
      startedAt: '2026-05-19T00:00:00.000Z',
      finishedAt: '2026-05-19T00:01:00.000Z',
      pricingFetchedAt: '2026-05-19T00:00:00.000Z',
      models: [],
    };
    expect(r.taskName).toBe('explainability');
  });
});
