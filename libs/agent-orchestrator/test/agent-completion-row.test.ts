import {
  agentCompletionPk, agentCompletionSk, agentFailurePk, agentFailureSk,
  type AgentCompletionRow, type AgentFailureRow,
} from '../src/agent-completion-row';

describe('agent-completion-row helpers', () => {
  it('builds the AgentCompletion pk/sk', () => {
    expect(agentCompletionPk('dec-1')).toBe('AgentCompletion#dec-1');
    expect(agentCompletionSk('portfolio-engine')).toBe('AgentCompletion#portfolio-engine');
  });
  it('builds the AgentFailure pk/sk', () => {
    expect(agentFailurePk('dec-1')).toBe('AgentFailure#dec-1');
    expect(agentFailureSk('advisory-narrative')).toBe('AgentFailure#advisory-narrative');
  });
  it('AgentCompletionRow<A> is generic over the agentName literal + agentOutput', () => {
    const row: AgentCompletionRow<'portfolio-engine', { ok: boolean }> = {
      pk: 'AgentCompletion#d1', sk: 'AgentCompletion#portfolio-engine', __typename: 'AgentCompletion',
      decisionId: 'd1', tenantId: 't', agentName: 'portfolio-engine', taskToken: 'tok',
      agentOutput: { ok: true }, completedAt: '2026', createdAt: '2026',
    };
    expect(row.agentName).toBe('portfolio-engine');
  });
  it('AgentFailureRow<A> is generic over the agentName literal', () => {
    const row: AgentFailureRow<'advisory-narrative'> = {
      pk: 'AgentFailure#d1', sk: 'AgentFailure#advisory-narrative', __typename: 'AgentFailure',
      decisionId: 'd1', tenantId: 't', agentName: 'advisory-narrative', taskToken: 'tok',
      errorType: 'SomeError', errorMessage: 'oops', failedAt: '2026', createdAt: '2026',
    };
    expect(row.agentName).toBe('advisory-narrative');
  });
});

import { z } from 'zod';
import { AgentCompletionRowSchema, AgentFailureRowSchema } from '../src/agent-completion-row';

describe('AgentCompletionRowSchema / AgentFailureRowSchema generators', () => {
  const OutputSchema = z.object({ score: z.number() });
  const PortfolioCompletion = AgentCompletionRowSchema('portfolio-engine', OutputSchema);
  const PortfolioFailure = AgentFailureRowSchema('portfolio-engine');

  const fullRow = {
    pk: 'AgentCompletion#d1', sk: 'AgentCompletion#portfolio-engine', __typename: 'AgentCompletion',
    decisionId: 'd1', tenantId: 't1', agentName: 'portfolio-engine', taskToken: 'tok',
    agentOutput: { score: 0.9 }, completedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
  };

  it('parses a full AgentCompletion row into the DRY subject (envelope + tenantId stripped)', () => {
    const subject = PortfolioCompletion.parse(fullRow);
    expect(subject).toEqual({
      decisionId: 'd1', agentName: 'portfolio-engine', taskToken: 'tok',
      agentOutput: { score: 0.9 }, completedAt: '2026-01-01T00:00:00Z',
    });
    const s = subject as Record<string, unknown>;
    expect(s.pk).toBeUndefined();
    expect(s.sk).toBeUndefined();
    expect(s.__typename).toBeUndefined();
    expect(s.tenantId).toBeUndefined();
    expect(s.createdAt).toBeUndefined();
  });

  it('rejects a mismatched agentName (z.literal tripwire)', () => {
    expect(() => PortfolioCompletion.parse({ ...fullRow, agentName: 'wrong-agent' })).toThrow();
  });

  it('rejects a drifted agentOutput', () => {
    expect(() => PortfolioCompletion.parse({ ...fullRow, agentOutput: { score: 'NaN' } })).toThrow();
  });

  it('AgentFailureRowSchema parses the failure row into the DRY subject', () => {
    const subject = PortfolioFailure.parse({
      pk: 'AgentFailure#d1', sk: 'AgentFailure#portfolio-engine', __typename: 'AgentFailure',
      decisionId: 'd1', tenantId: 't1', agentName: 'portfolio-engine', taskToken: 'tok',
      errorType: 'SomeError', errorMessage: 'oops', failedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    });
    expect(subject).toEqual({
      decisionId: 'd1', agentName: 'portfolio-engine', taskToken: 'tok',
      errorType: 'SomeError', errorMessage: 'oops', failedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('type: inferred subject equals the AgentCompletionRow domain-field portion', () => {
    type Inferred = z.infer<typeof PortfolioCompletion>;
    type RowDomain = Pick<
      import('../src/agent-completion-row').AgentCompletionRow<'portfolio-engine', { score: number }>,
      'decisionId' | 'agentName' | 'taskToken' | 'agentOutput' | 'completedAt'
    >;
    const a = {} as Inferred;
    const b: RowDomain = a; // compile error if shapes diverge
    const c: Inferred = b;  // compile error in the other direction
    void c;
    expect(typeof b).toBe('object');
  });
});
