import { explainabilityPrompt } from '../../../src/agents/prompts';

describe('advisory-narrative explainabilityPrompt — content anchors', () => {
  it('declares the role and task headers', () => {
    expect(explainabilityPrompt).toContain('ROLE: financial explanation specialist');
    expect(explainabilityPrompt).toContain('TASK:');
  });

  it('emits the schema-derived field markers', () => {
    expect(explainabilityPrompt).toContain('"summary"');
    expect(explainabilityPrompt).toContain('"rationale"');
    expect(explainabilityPrompt).toContain('"keyFactors"');
    expect(explainabilityPrompt).toContain('"tone"');
    expect(explainabilityPrompt).toContain('"wordCount"');
    expect(explainabilityPrompt).toContain('"confidence"');
  });

  it('encodes the validation thresholds (summary >= 20 chars, rationale >= 20 chars, keyFactors >= 1, wordCount <= 2000)', () => {
    expect(explainabilityPrompt).toMatch(/summary[^.]*at least 20 characters/);
    expect(explainabilityPrompt).toMatch(/rationale[^.]*at least 20 characters/);
    expect(explainabilityPrompt).toMatch(/keyFactors[^.]*AT LEAST 1/);
    expect(explainabilityPrompt).toMatch(/wordCount[^.]*2000/);
  });

  it('references the Operating Mode framing as a HARD RULE', () => {
    expect(explainabilityPrompt).toMatch(/operating mode/i);
    expect(explainabilityPrompt).toMatch(/HARD RULE/);
  });

  it('emits the forbid-empty marker', () => {
    expect(explainabilityPrompt).toContain('You MUST call the structured-output tool');
    expect(explainabilityPrompt).toContain('every required field above MUST be populated');
  });

  it('terminates with Input: {input}', () => {
    expect(explainabilityPrompt.endsWith('Input: {input}')).toBe(true);
  });
});
