import {
  buildPortfolioConstructionPrompt,
  rebalancePlannerPrompt,
} from '../../src/agents/prompts';

describe('buildPortfolioConstructionPrompt', () => {
  describe('CONSERVATIVE', () => {
    const prompt = buildPortfolioConstructionPrompt('CONSERVATIVE');

    it('embeds the CONSERVATIVE worked example numbers', () => {
      // Worked example shape per spec § "Concrete worked examples".
      // BND 0.50 / SHY 0.30 / VTI 0.10 / IXUS 0.10 → equity 0.20, largest-equity 0.10
      expect(prompt).toContain('"BND"');
      expect(prompt).toContain('"targetWeight": 0.50');
      expect(prompt).toContain('"equityWeight": 0.20');
      expect(prompt).toContain('"largestPositionWeight": 0.10');
    });

    it('rules state the largest EQUITY position cap is 0.10', () => {
      expect(prompt).toMatch(/largest .*EQUITY.*0\.10/);
    });

    it('rules state the position count band is 3 to 5', () => {
      expect(prompt).toMatch(/3 (to|and|-) 5/);
    });

    it('rules state the equityWeight cap is 0.30', () => {
      expect(prompt).toMatch(/equityWeight .* 0\.30/);
    });
  });

  describe('BALANCED', () => {
    const prompt = buildPortfolioConstructionPrompt('BALANCED');

    it('embeds the BALANCED worked example numbers', () => {
      // VTI 0.14 / IXUS 0.14 / QQQ 0.14 / VWO 0.13 / BND 0.27 / SHY 0.18
      // → equity 0.55, largest-equity 0.14, count 6
      expect(prompt).toContain('"QQQ"');
      expect(prompt).toContain('"equityWeight": 0.55');
      expect(prompt).toContain('"largestPositionWeight": 0.14');
    });

    it('rules state the largest EQUITY position cap is 0.15', () => {
      expect(prompt).toMatch(/largest .*EQUITY.*0\.15/);
    });

    it('rules state the equityWeight band is 0.50 to 0.70', () => {
      expect(prompt).toContain('0.50');
      expect(prompt).toContain('0.70');
    });

    it('rules state the position count band is 5 to 8', () => {
      expect(prompt).toMatch(/5 (to|and|-) 8/);
    });
  });

  describe('AGGRESSIVE', () => {
    const prompt = buildPortfolioConstructionPrompt('AGGRESSIVE');

    it('embeds the AGGRESSIVE worked example numbers', () => {
      // VTI 0.20 / VOO 0.18 / QQQ 0.15 / IXUS 0.12 / VWO 0.10 / ARKK 0.10
      // / BND 0.10 / BIL 0.05 → equity 0.85, largest-equity 0.20, count 8
      expect(prompt).toContain('"ARKK"');
      expect(prompt).toContain('"equityWeight": 0.85');
      expect(prompt).toContain('"largestPositionWeight": 0.20');
    });

    it('rules state the largest EQUITY position cap is 0.25', () => {
      expect(prompt).toMatch(/largest .*EQUITY.*0\.25/);
    });

    it('rules state the equityWeight floor is 0.70', () => {
      // Bracket notation `[0.70, 0.90]` puts no space before `0.70` so allow either.
      expect(prompt).toMatch(/equityWeight[^\n]*0\.70/);
    });

    it('rules state the position count band starts at 6', () => {
      expect(prompt).toMatch(/6 (to|and|-) 12/);
    });
  });

  it('rejects unknown modes at compile time', () => {
    // @ts-expect-error — mode parameter is a literal union; the call also throws at runtime
    expect(() => buildPortfolioConstructionPrompt('UNKNOWN' as never)).toThrow();
  });

  it('throws at runtime when an invalid mode string slips past the type', () => {
    expect(() =>
      buildPortfolioConstructionPrompt('MODERATE' as never),
    ).toThrow(/unknown OperatingMode 'MODERATE'/);
  });
});

describe('rebalancePlannerPrompt (mode-orthogonal — unchanged by α-tune)', () => {
  it('still exports a single string prompt', () => {
    expect(typeof rebalancePlannerPrompt).toBe('string');
    expect(rebalancePlannerPrompt).toContain('rebalance planning specialist');
  });
});
