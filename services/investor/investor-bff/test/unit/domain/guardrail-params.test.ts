import { resolveGuardrailParams } from '../../../src/domain/guardrail-params';

describe('resolveGuardrailParams', () => {
  it('returns conservative parameters', () => {
    const p = resolveGuardrailParams('CONSERVATIVE');
    expect(p.maxSingleTradePercent).toBe(5);
    expect(p.monthlyTurnoverCapPercent).toBe(10);
    expect(p.coolDownDays).toBe(10);
    expect(p.rebalanceCadence).toBe('QUARTERLY');
    expect(p.equityRiskBandPercent).toBe(3);
    expect(p.driftTriggerPercent).toBe(2);
    expect(p.singleEtfConcentrationPercent).toBe(20);
    expect(p.drawdownCircuitBreakerPercent).toBe(8);
  });

  it('returns balanced parameters', () => {
    const p = resolveGuardrailParams('BALANCED');
    expect(p.maxSingleTradePercent).toBe(10);
    expect(p.monthlyTurnoverCapPercent).toBe(25);
    expect(p.coolDownDays).toBe(5);
    expect(p.rebalanceCadence).toBe('MONTHLY');
    expect(p.equityRiskBandPercent).toBe(6);
    expect(p.driftTriggerPercent).toBe(4);
    expect(p.singleEtfConcentrationPercent).toBe(30);
    expect(p.drawdownCircuitBreakerPercent).toBe(12);
  });

  it('returns aggressive parameters', () => {
    const p = resolveGuardrailParams('AGGRESSIVE');
    expect(p.maxSingleTradePercent).toBe(20);
    expect(p.monthlyTurnoverCapPercent).toBe(50);
    expect(p.coolDownDays).toBe(2);
    expect(p.rebalanceCadence).toBe('BI_WEEKLY');
    expect(p.equityRiskBandPercent).toBe(10);
    expect(p.driftTriggerPercent).toBe(7);
    expect(p.singleEtfConcentrationPercent).toBe(40);
    expect(p.drawdownCircuitBreakerPercent).toBe(18);
  });
});
