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
