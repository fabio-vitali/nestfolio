import { marketResearchPrompt } from '../../../src/agents/prompts';

describe('market-intelligence marketResearchPrompt — content anchors', () => {
  it('declares the role and task headers', () => {
    expect(marketResearchPrompt).toContain('ROLE: market research analyst');
    expect(marketResearchPrompt).toContain('TASK:');
  });

  it('emits the schema-derived field markers', () => {
    expect(marketResearchPrompt).toContain('"signals"');
    expect(marketResearchPrompt).toContain('"type"');
    expect(marketResearchPrompt).toContain('"ticker"');
    expect(marketResearchPrompt).toContain('"sentiment"');
    expect(marketResearchPrompt).toContain('"confidence"');
    expect(marketResearchPrompt).toContain('"source"');
    expect(marketResearchPrompt).toContain('"tickersMentioned"');
    expect(marketResearchPrompt).toContain('"marketOutlook"');
    expect(marketResearchPrompt).toContain('"confidenceScore"');
  });

  it('enumerates the BULLISH/BEARISH/NEUTRAL sentiment enum', () => {
    expect(marketResearchPrompt).toContain('BULLISH | BEARISH | NEUTRAL');
  });

  it('forbids fabricating tickers or signals', () => {
    expect(marketResearchPrompt).toMatch(/Do NOT fabricate/);
  });

  it('emits the forbid-empty marker', () => {
    expect(marketResearchPrompt).toContain('You MUST call the structured-output tool');
  });

  it('terminates with Input: {input}', () => {
    expect(marketResearchPrompt.endsWith('Input: {input}')).toBe(true);
  });
});
