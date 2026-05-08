// services/advisory/compliance-ctrl/src/rules/guardrail-params.ts
import type { OperatingMode, RebalanceCadence } from './rule-engine';

export interface GuardrailParams {
  readonly maxSingleTradePercent: number;
  readonly monthlyTurnoverCapPercent: number;
  readonly coolDownDays: number;
  readonly rebalanceCadence: RebalanceCadence | 'BI_WEEKLY';
  readonly equityRiskBandPercent: number;
  readonly driftTriggerPercent: number;
  readonly singleEtfConcentrationPercent: number;
  readonly drawdownCircuitBreakerPercent: number;
}

const GUARDRAIL_TABLE: Record<OperatingMode, GuardrailParams> = {
  CONSERVATIVE: {
    maxSingleTradePercent: 5, monthlyTurnoverCapPercent: 10, coolDownDays: 10,
    rebalanceCadence: 'QUARTERLY', equityRiskBandPercent: 3, driftTriggerPercent: 2,
    singleEtfConcentrationPercent: 20, drawdownCircuitBreakerPercent: 8,
  },
  BALANCED: {
    maxSingleTradePercent: 10, monthlyTurnoverCapPercent: 25, coolDownDays: 5,
    rebalanceCadence: 'MONTHLY', equityRiskBandPercent: 6, driftTriggerPercent: 4,
    singleEtfConcentrationPercent: 30, drawdownCircuitBreakerPercent: 12,
  },
  AGGRESSIVE: {
    maxSingleTradePercent: 20, monthlyTurnoverCapPercent: 50, coolDownDays: 2,
    rebalanceCadence: 'BI_WEEKLY', equityRiskBandPercent: 10, driftTriggerPercent: 7,
    singleEtfConcentrationPercent: 40, drawdownCircuitBreakerPercent: 18,
  },
};

export function resolveGuardrailParams(mode: OperatingMode): GuardrailParams {
  return GUARDRAIL_TABLE[mode];
}
