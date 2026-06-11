import {
  NarrativeAgentCompletionSchema, NarrativeAgentFailureSchema, ExplanationGeneratedSchema,
} from '../../src/domain/contracts';
import type { NarrativeAgentCompletionRow, NarrativeAgentFailureRow } from '../../src/domain/models';
import type { z } from 'zod';

describe('advisory-narrative-ctrl contracts', () => {
  it('rejects a mismatched agentName literal on the completion schema', () => {
    expect(() => NarrativeAgentCompletionSchema.parse({
      decisionId: 'd', agentName: 'portfolio-engine', taskToken: 't', agentOutput: {}, completedAt: 'x',
    })).toThrow();
  });

  it('type: NarrativeAgentCompletion equals the AgentCompletion row domain fields', () => {
    type Inferred = z.infer<typeof NarrativeAgentCompletionSchema>;
    type RowDomain = Pick<NarrativeAgentCompletionRow, 'decisionId' | 'agentName' | 'taskToken' | 'agentOutput' | 'completedAt'>;
    const a = {} as Inferred; const b: RowDomain = a; const c: Inferred = b; void c;
    expect(typeof b).toBe('object');
  });

  it('type: NarrativeAgentFailure equals the AgentFailure row domain fields', () => {
    type Inferred = z.infer<typeof NarrativeAgentFailureSchema>;
    type RowDomain = Pick<NarrativeAgentFailureRow, 'decisionId' | 'agentName' | 'taskToken' | 'errorType' | 'errorMessage' | 'failedAt'>;
    const a = {} as Inferred; const b: RowDomain = a; const c: Inferred = b; void c;
    expect(typeof b).toBe('object');
  });

  it('ExplanationGenerated parses the real ReasoningOutput row shape (envelope stripped)', () => {
    const subject = ExplanationGeneratedSchema.parse({
      pk: 'DECISION#d1', sk: 'REASONING#e1', __typename: 'ReasoningOutput', tenantId: 't1',
      invocationId: 'e1', decisionId: 'd1',
      summary: 'A clear summary.', rationale: 'Because diversification.',
      keyFactors: ['risk', 'horizon'], tone: 'reassuring', wordCount: 42, confidence: 0.8,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const s = subject as Record<string, unknown>;
    expect(s.pk).toBeUndefined();
    expect(s.__typename).toBeUndefined();
    expect(s.tenantId).toBeUndefined();
    expect(s.decisionId).toBe('d1');
    expect(s.invocationId).toBe('e1');
  });
});
