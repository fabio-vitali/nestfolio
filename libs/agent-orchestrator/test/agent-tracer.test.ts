import { AgentTracer, extractNodeName, extractModelTier, extractToolName } from '../src/agent-tracer';

describe('AgentTracer.build()', () => {
  it('returns envelope with empty arrays and success status when nothing observed', () => {
    const tracer = new AgentTracer();
    const env = tracer.build('success');
    expect(env.status).toBe('success');
    expect(env.llmCalls).toEqual([]);
    expect(env.toolCalls).toEqual([]);
    expect(env.nodeSequence).toEqual([]);
    expect(env.errors).toEqual([]);
    expect(env['gen_ai.invocation.latency_ms']).toBeGreaterThanOrEqual(0);
    expect(new Date(env['gen_ai.invocation.started_at']).toString()).not.toBe('Invalid Date');
    expect(new Date(env['gen_ai.invocation.completed_at']).toString()).not.toBe('Invalid Date');
  });

  it('returns envelope with error status when error passed', () => {
    const tracer = new AgentTracer();
    const env = tracer.build('error');
    expect(env.status).toBe('error');
  });
});

describe('extract helpers', () => {
  it('extractNodeName reads kwargs.name first, then last id segment', () => {
    expect(extractNodeName({ kwargs: { name: 'portfolioConstruction' } } as any)).toBe('portfolioConstruction');
    expect(extractNodeName({ id: ['langchain', 'nodes', 'goalExtraction'] } as any)).toBe('goalExtraction');
    expect(extractNodeName(undefined)).toBeUndefined();
  });
  it('extractModelTier maps Bedrock inference profile ids to tier names', () => {
    expect(extractModelTier({ kwargs: { model: 'us.anthropic.claude-haiku-4-5' } } as any)).toBe('haiku');
    expect(extractModelTier({ kwargs: { model: 'us.anthropic.claude-opus-4-7' } } as any)).toBe('opus');
    expect(extractModelTier({ kwargs: { model: 'us.anthropic.claude-sonnet-4-6' } } as any)).toBe('sonnet');
    expect(extractModelTier({ kwargs: { model: 'us.anthropic.claude-sonnet-4-7' } } as any)).toBe('sonnet');
    expect(extractModelTier({ kwargs: {} } as any)).toBe('unknown');
    expect(extractModelTier({ kwargs: { model: 'us.amazon.nova-pro-v1:0' } } as any)).toBe('unknown');
  });
  it('extractToolName reads kwargs.name first, then last id segment', () => {
    expect(extractToolName({ kwargs: { name: 'portfolio-lookup' } } as any)).toBe('portfolio-lookup');
    expect(extractToolName({ id: ['tools', 'market-data'] } as any)).toBe('market-data');
    expect(extractToolName(undefined)).toBe('unknown');
  });
});
