export const GOLDEN_PORTFOLIO = {
  // BALANCED-envelope golden fixture: 5 positions, equityWeight=0.55 (in [0.50,0.70]),
  // largest EQUITY position=0.15 (at cap), mass conserved at totalExposure=1.0.
  allocations: [
    { instrument: 'VTI',  assetClass: 'EQUITY' as const,       targetWeight: 0.15, rationale: 'US equity broad market exposure' },
    { instrument: 'VXUS', assetClass: 'EQUITY' as const,       targetWeight: 0.15, rationale: 'International equity diversification' },
    { instrument: 'QQQ',  assetClass: 'EQUITY' as const,       targetWeight: 0.15, rationale: 'Growth tilt' },
    { instrument: 'VWO',  assetClass: 'EQUITY' as const,       targetWeight: 0.10, rationale: 'Emerging markets diversification' },
    { instrument: 'BND',  assetClass: 'FIXED_INCOME' as const, targetWeight: 0.45, rationale: 'Investment-grade bond ballast' },
  ],
  totalExposure: 1.0,
  equityWeight: 0.55, // VTI 0.15 + VXUS 0.15 + QQQ 0.15 + VWO 0.10
  riskMetrics: { concentrationRisk: 0.20, sectorDiversity: 0.78, largestPositionWeight: 0.15 },
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
