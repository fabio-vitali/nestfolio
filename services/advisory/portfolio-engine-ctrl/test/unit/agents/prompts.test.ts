import { portfolioConstructionPrompt, rebalancePlannerPrompt } from '../../../src/agents/prompts';

describe('portfolio-engine prompts — content anchors', () => {
  describe('portfolioConstructionPrompt', () => {
    it('declares the role and task headers', () => {
      expect(portfolioConstructionPrompt).toContain('ROLE: portfolio construction specialist');
      expect(portfolioConstructionPrompt).toContain('TASK:');
    });

    it('emits the schema-derived field markers', () => {
      expect(portfolioConstructionPrompt).toContain('"allocations"');
      expect(portfolioConstructionPrompt).toContain('"assetClass"');
      expect(portfolioConstructionPrompt).toContain('"targetWeight"');
      expect(portfolioConstructionPrompt).toContain('"rationale"');
      expect(portfolioConstructionPrompt).toContain('"equityWeight"');
      expect(portfolioConstructionPrompt).toContain('"largestPositionWeight"');
      expect(portfolioConstructionPrompt).toContain('"confidence"');
    });

    it('enumerates the seven asset classes', () => {
      expect(portfolioConstructionPrompt).toContain('EQUITY | FIXED_INCOME | REIT | COMMODITY | CASH | CRYPTO | OTHER');
    });

    it('references the Operating Mode envelope clauses', () => {
      expect(portfolioConstructionPrompt).toMatch(/operating mode/i);
      expect(portfolioConstructionPrompt).toMatch(/HARD RULES/);
      expect(portfolioConstructionPrompt).toMatch(/equity weight band/);
      expect(portfolioConstructionPrompt).toMatch(/single-position cap/);
      expect(portfolioConstructionPrompt).toMatch(/position count/);
    });

    it('emits the forbid-empty marker', () => {
      expect(portfolioConstructionPrompt).toContain('You MUST call the structured-output tool');
      expect(portfolioConstructionPrompt).toContain('every required field above MUST be populated');
    });

    it('terminates with Input: {input} so the runtime placeholder still resolves', () => {
      expect(portfolioConstructionPrompt.endsWith('Input: {input}')).toBe(true);
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
