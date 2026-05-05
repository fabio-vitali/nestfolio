export const GOLDEN_PORTFOLIO = {
  allocations: [
    { instrument: 'VTI', targetWeight: 0.4, rationale: 'US equity broad market exposure' },
    { instrument: 'VXUS', targetWeight: 0.15, rationale: 'International equity diversification' },
    { instrument: 'BND', targetWeight: 0.3, rationale: 'Investment-grade bond ballast' },
    { instrument: 'VNQ', targetWeight: 0.15, rationale: 'Real estate diversification' },
  ],
  totalExposure: 1.0,
  equityWeight: 0.7, // VTI 0.4 + VXUS 0.15 + VNQ 0.15 (REIT counts as equity by exposure type)
  riskMetrics: { concentrationRisk: 0.25, sectorDiversity: 0.78, largestPositionWeight: 0.4 },
  confidence: 0.85,
};

export const GOLDEN_REBALANCE = {
  trades: [
    { action: 'BUY' as const, instrument: 'VTI', targetWeight: 0.4, currentWeight: 0.35, quantity: 15, rationale: 'Increase to target' },
    { action: 'SELL' as const, instrument: 'BND', targetWeight: 0.3, currentWeight: 0.35, quantity: 8, rationale: 'Reduce to target' },
  ],
  estimatedTurnover: 0.05,
  confidence: 0.82,
};
