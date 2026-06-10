import { NarrativeAgentOutputSchema } from '../../../src/domain/contracts';

describe('advisory-narrative-ctrl contracts', () => {
  it('NarrativeAgentOutputSchema parses the composite runPipeline output (explainability spread)', () => {
    const parsed = NarrativeAgentOutputSchema.parse({
      decisionId: 'd1',
      summary: 'Bought VTI',
      rationale: 'core equity',
      keyFactors: ['risk'],
      tone: 'neutral',
      wordCount: 42,
      confidence: 0.9,
      metadata: { durationMs: 800, modelTier: 'haiku' },
    });
    expect(parsed.summary).toBe('Bought VTI');
    expect(parsed.decisionId).toBe('d1');
  });

  it('NarrativeAgentOutputSchema rejects when summary is absent', () => {
    expect(() =>
      NarrativeAgentOutputSchema.parse({
        decisionId: 'd1',
        rationale: 'x',
        keyFactors: [],
        tone: 'neutral',
        wordCount: 1,
        confidence: 0.5,
        metadata: { durationMs: 1, modelTier: 'haiku' },
      }),
    ).toThrow();
  });
});
