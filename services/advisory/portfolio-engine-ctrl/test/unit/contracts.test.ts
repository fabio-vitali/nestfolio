import { PortfolioAgentCompletionSchema, PortfolioAgentFailureSchema } from '../../src/domain/contracts';
import type { PortfolioAgentCompletionRow, PortfolioAgentFailureRow } from '../../src/domain/models';
import type { z } from 'zod';

describe('portfolio-engine-ctrl AgentCompletion/AgentFailure contracts', () => {
  it('rejects a mismatched agentName literal', () => {
    expect(() => PortfolioAgentCompletionSchema.parse({
      decisionId: 'd', agentName: 'advisory-narrative', taskToken: 't',
      agentOutput: {}, completedAt: 'x',
    })).toThrow();
  });

  it('type: PortfolioAgentCompletion equals the AgentCompletion row domain fields', () => {
    type Inferred = z.infer<typeof PortfolioAgentCompletionSchema>;
    type RowDomain = Pick<PortfolioAgentCompletionRow, 'decisionId' | 'agentName' | 'taskToken' | 'agentOutput' | 'completedAt'>;
    const a = {} as Inferred; const b: RowDomain = a; const c: Inferred = b; void c;
    expect(typeof b).toBe('object');
  });

  it('type: PortfolioAgentFailure equals the AgentFailure row domain fields', () => {
    type Inferred = z.infer<typeof PortfolioAgentFailureSchema>;
    type RowDomain = Pick<PortfolioAgentFailureRow, 'decisionId' | 'agentName' | 'taskToken' | 'errorType' | 'errorMessage' | 'failedAt'>;
    const a = {} as Inferred; const b: RowDomain = a; const c: Inferred = b; void c;
    expect(typeof b).toBe('object');
  });
});
