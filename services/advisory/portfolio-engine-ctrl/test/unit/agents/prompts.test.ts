import { buildPortfolioConstructionPrompt, rebalancePlannerPrompt } from '../../../src/agents/prompts';

describe('portfolio-engine prompts — content anchors', () => {
  describe('buildPortfolioConstructionPrompt — structural assertions (mode-orthogonal)', () => {
    // Mode-orthogonal structural assertions. Pick any one mode for the
    // shape check; per-mode number assertions live in test/unit/prompts.test.ts.
    const prompt = buildPortfolioConstructionPrompt('BALANCED');

    it('declares the role and task headers', () => {
      expect(prompt).toContain('ROLE: portfolio construction specialist');
      expect(prompt).toContain('TASK:');
    });

    it('emits the schema-derived field markers', () => {
      expect(prompt).toContain('"allocations"');
      expect(prompt).toContain('"assetClass"');
      expect(prompt).toContain('"targetWeight"');
      expect(prompt).toContain('"rationale"');
      expect(prompt).toContain('"equityWeight"');
      expect(prompt).toContain('"largestPositionWeight"');
      expect(prompt).toContain('"confidence"');
    });

    it('enumerates the seven asset classes', () => {
      expect(prompt).toContain('EQUITY | FIXED_INCOME | REIT | COMMODITY | CASH | CRYPTO | OTHER');
    });

    it('references the Operating Mode envelope clauses (post-α-tune wording)', () => {
      expect(prompt).toMatch(/OPERATING MODE/);
      expect(prompt).toMatch(/equityWeight/);
      expect(prompt).toMatch(/largest single EQUITY position/);
      expect(prompt).toMatch(/allocations\.length MUST be between/);
    });

    it('emits the forbid-empty marker', () => {
      expect(prompt).toContain('You MUST call the structured-output tool');
      expect(prompt).toContain('every required field above MUST be populated');
    });

    it('terminates with Input: {input} so the runtime placeholder still resolves', () => {
      expect(prompt.endsWith('Input: {input}')).toBe(true);
    });
  });

  describe('rebalancePlannerPrompt', () => {
    it('declares the role and task headers', () => {
      expect(rebalancePlannerPrompt).toContain('ROLE: rebalance planning specialist');
      expect(rebalancePlannerPrompt).toContain('TASK:');
    });

    it('emits the schema-derived field markers', () => {
      expect(rebalancePlannerPrompt).toContain('"trades"');
      expect(rebalancePlannerPrompt).toContain('"action"');
      expect(rebalancePlannerPrompt).toContain('"instrument"');
      expect(rebalancePlannerPrompt).toContain('"targetWeight"');
      expect(rebalancePlannerPrompt).toContain('"currentWeight"');
      expect(rebalancePlannerPrompt).toContain('"rationale"');
      expect(rebalancePlannerPrompt).toContain('"estimatedTurnover"');
      expect(rebalancePlannerPrompt).toContain('"confidence"');
    });

    it('enumerates the BUY/SELL/REBALANCE actions', () => {
      expect(rebalancePlannerPrompt).toContain('BUY | SELL | REBALANCE');
    });

    it('emits the forbid-empty marker', () => {
      expect(rebalancePlannerPrompt).toContain('You MUST call the structured-output tool');
    });

    it('terminates with Input: {input}', () => {
      expect(rebalancePlannerPrompt.endsWith('Input: {input}')).toBe(true);
    });
  });
});
