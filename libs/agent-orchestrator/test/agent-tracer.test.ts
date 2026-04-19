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

describe('AgentTracer LangChain callbacks', () => {
  it('records a chain start/end pair into nodeSequence', () => {
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'run-1');
    tracer.handleChainEnd({}, 'run-1');
    const env = tracer.build('success');
    expect(env.nodeSequence).toHaveLength(1);
    expect(env.nodeSequence[0].nodeName).toBe('nodeA');
    expect(env.nodeSequence[0].completedAt).not.toBe('');
  });

  it('ignores chains without an extractable node name', () => {
    const tracer = new AgentTracer();
    tracer.handleChainStart({} as any, {}, 'run-1');
    const env = tracer.build('success');
    expect(env.nodeSequence).toHaveLength(0);
  });

  it('attributes completedAt to the correct chain when two run in parallel (interleaved start/end)', () => {
    // Simulates parallel nodes — e.g. portfolio-engine and investor-profile fan-out.
    // If nodeSequence were keyed by "last array entry" instead of runId, chain A's
    // completedAt would land on chain B's record.
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'run-A');
    tracer.handleChainStart({ kwargs: { name: 'nodeB' } } as any, {}, 'run-B');
    tracer.handleChainEnd({}, 'run-A'); // A finishes first
    tracer.handleChainEnd({}, 'run-B');
    const env = tracer.build('success');
    expect(env.nodeSequence).toHaveLength(2);
    const byName = Object.fromEntries(env.nodeSequence.map((n) => [n.nodeName, n]));
    expect(byName['nodeA'].completedAt).not.toBe('');
    expect(byName['nodeB'].completedAt).not.toBe('');
    // Both records carry their own startedAt/completedAt, not each other's.
    expect(new Date(byName['nodeA'].completedAt).getTime())
      .toBeLessThanOrEqual(new Date(byName['nodeB'].completedAt).getTime());
  });

  it('records an LLM call with token usage from tokenUsage', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMStart(
      { kwargs: { model: 'us.anthropic.claude-sonnet-4-6' } } as any,
      ['prompt'],
      'run-1',
    );
    tracer.handleLLMEnd(
      { generations: [], llmOutput: { tokenUsage: { input_tokens: 100, output_tokens: 50 } } } as any,
      'run-1',
    );
    const env = tracer.build('success');
    expect(env.llmCalls).toHaveLength(1);
    expect(env.llmCalls[0]['gen_ai.request.model']).toBe('sonnet');
    expect(env.llmCalls[0]['gen_ai.usage.input_tokens']).toBe(100);
    expect(env.llmCalls[0]['gen_ai.usage.output_tokens']).toBe(50);
    expect(env.llmCalls[0]['gen_ai.operation.name']).toBe('chat');
    expect(env.llmCalls[0].escalatedFromTier).toBeUndefined();
  });

  it('records escalatedFromTier when successive LLM calls escalate upward', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMStart({ kwargs: { model: 'haiku-x' } } as any, [], 'run-1');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-1');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'run-2');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-2');
    const env = tracer.build('success');
    expect(env.llmCalls).toHaveLength(2);
    expect(env.llmCalls[1].escalatedFromTier).toBe('haiku');
  });

  it('leaves escalatedFromTier undefined when tier de-escalates (e.g. opus→sonnet)', () => {
    // The field means "escalated from", not "differs from". A fallback to a
    // cheaper tier must not masquerade as escalation.
    const tracer = new AgentTracer();
    tracer.handleLLMStart({ kwargs: { model: 'opus-x' } } as any, [], 'run-1');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-1');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'run-2');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-2');
    const env = tracer.build('success');
    expect(env.llmCalls[1].escalatedFromTier).toBeUndefined();
  });

  it('leaves escalatedFromTier undefined when either tier is unknown', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMStart({ kwargs: { model: 'nova-pro' } } as any, [], 'run-1');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-1');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'run-2');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'run-2');
    const env = tracer.build('success');
    expect(env.llmCalls[0]['gen_ai.request.model']).toBe('unknown');
    expect(env.llmCalls[1].escalatedFromTier).toBeUndefined();
  });

  it('attributes LLM calls to the correct node when two nodes run in parallel', () => {
    // Regression: if node attribution went through a shared `currentNode`
    // field, whichever chain started most recently would own every LLM call
    // until the next chain started. Here LLM-A and LLM-B interleave between
    // chains A and B and must each keep their own node.
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'chain-A');
    tracer.handleChainStart({ kwargs: { name: 'nodeB' } } as any, {}, 'chain-B');
    tracer.handleLLMStart({ kwargs: { model: 'sonnet-x' } } as any, [], 'llm-A', 'chain-A');
    tracer.handleLLMStart({ kwargs: { model: 'haiku-x' } } as any, [], 'llm-B', 'chain-B');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'llm-B');
    tracer.handleLLMEnd({ generations: [], llmOutput: {} } as any, 'llm-A');
    tracer.handleChainEnd({}, 'chain-A');
    tracer.handleChainEnd({}, 'chain-B');
    const env = tracer.build('success');
    expect(env.llmCalls).toHaveLength(2);
    const byNode = Object.fromEntries(env.llmCalls.map((c) => [c.nodeName, c]));
    expect(byNode['nodeA']['gen_ai.request.model']).toBe('sonnet');
    expect(byNode['nodeB']['gen_ai.request.model']).toBe('haiku');
  });

  it('attributes tool calls to the correct node when two nodes run in parallel', () => {
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'chain-A');
    tracer.handleChainStart({ kwargs: { name: 'nodeB' } } as any, {}, 'chain-B');
    tracer.handleToolStart({ kwargs: { name: 'toolA' } } as any, '{}', 'tool-A', 'chain-A');
    tracer.handleToolStart({ kwargs: { name: 'toolB' } } as any, '{}', 'tool-B', 'chain-B');
    tracer.handleToolEnd('{}', 'tool-B');
    tracer.handleToolEnd('{}', 'tool-A');
    tracer.handleChainEnd({}, 'chain-A');
    tracer.handleChainEnd({}, 'chain-B');
    const env = tracer.build('success');
    const byTool = Object.fromEntries(env.toolCalls.map((c) => [c.toolName, c]));
    expect(byTool['toolA'].nodeName).toBe('nodeA');
    expect(byTool['toolB'].nodeName).toBe('nodeB');
  });

  it('records a tool call with argKeys and resultKeys derived from JSON', () => {
    const tracer = new AgentTracer();
    tracer.handleToolStart({ kwargs: { name: 'portfolio-lookup' } } as any, '{"tenantId":"t","decisionId":"d"}', 'run-1');
    tracer.handleToolEnd('{"positions":[],"cash":0}', 'run-1');
    const env = tracer.build('success');
    expect(env.toolCalls).toHaveLength(1);
    expect(env.toolCalls[0].toolName).toBe('portfolio-lookup');
    expect(env.toolCalls[0].argKeys.sort()).toEqual(['decisionId', 'tenantId']);
    expect(env.toolCalls[0].resultKeys?.sort()).toEqual(['cash', 'positions']);
    expect(env.toolCalls[0].status).toBe('success');
  });

  it('records tool error with status error and an error entry', () => {
    const tracer = new AgentTracer();
    tracer.handleToolStart({ kwargs: { name: 'market-data' } } as any, '{}', 'run-1');
    tracer.handleToolError(new Error('boom'), 'run-1');
    const env = tracer.build('success');
    expect(env.toolCalls[0].status).toBe('error');
    expect(env.errors).toContainEqual({ nodeName: undefined, kind: 'tool_error', message: 'boom' });
  });

  it('records chain error', () => {
    const tracer = new AgentTracer();
    tracer.handleChainStart({ kwargs: { name: 'nodeA' } } as any, {}, 'run-1');
    tracer.handleChainError(new Error('chain-fail'), 'run-1');
    const env = tracer.build('error');
    expect(env.errors).toContainEqual({ nodeName: 'nodeA', kind: 'chain_error', message: 'chain-fail' });
  });

  it('records llm error without consuming a matching pending run', () => {
    const tracer = new AgentTracer();
    tracer.handleLLMError(new Error('llm-fail'), 'run-1');
    const env = tracer.build('error');
    expect(env.errors).toContainEqual({ nodeName: undefined, kind: 'llm_error', message: 'llm-fail' });
  });

  it('handles non-JSON tool input and output gracefully (argKeys empty, resultKeys undefined)', () => {
    const tracer = new AgentTracer();
    tracer.handleToolStart({ kwargs: { name: 't' } } as any, 'not-json', 'run-1');
    tracer.handleToolEnd('still-not-json', 'run-1');
    const env = tracer.build('success');
    expect(env.toolCalls[0].argKeys).toEqual([]);
    expect(env.toolCalls[0].resultKeys).toBeUndefined();
  });
});
