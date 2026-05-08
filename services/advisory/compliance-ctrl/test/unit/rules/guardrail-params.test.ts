import { resolveGuardrailParams } from '../../../src/rules/guardrail-params';

describe('resolveGuardrailParams', () => {
  it.each([
    ['CONSERVATIVE', 5, 10, 'QUARTERLY'],
    ['BALANCED', 10, 25, 'MONTHLY'],
    ['AGGRESSIVE', 20, 50, 'BI_WEEKLY'],
  ] as const)('mode %s → %d/%d/%s', (mode, singleTrade, turnover, cadence) => {
    const p = resolveGuardrailParams(mode);
    expect(p.maxSingleTradePercent).toBe(singleTrade);
    expect(p.monthlyTurnoverCapPercent).toBe(turnover);
    expect(p.rebalanceCadence).toBe(cadence);
  });
});
