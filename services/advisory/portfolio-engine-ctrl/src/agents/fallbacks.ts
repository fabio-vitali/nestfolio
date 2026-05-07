export function portfolioConstructionFallback(_state: Record<string, unknown>): Record<string, unknown> {
  return {
    allocations: [
      // BALANCED-envelope fallback: 5 positions, equityWeight=0.55 (in [0.50,0.70]),
      // largest EQUITY position=0.15 (at cap), mass conserved at totalExposure=1.0.
      // The fallback is a coarse safety net — it intentionally does not vary by mode.
      { instrument: 'VTI',  assetClass: 'EQUITY',       targetWeight: 0.15, rationale: 'US equity core (fallback)' },
      { instrument: 'VXUS', assetClass: 'EQUITY',       targetWeight: 0.15, rationale: 'International diversification (fallback)' },
      { instrument: 'QQQ',  assetClass: 'EQUITY',       targetWeight: 0.15, rationale: 'Growth tilt (fallback)' },
      { instrument: 'VWO',  assetClass: 'EQUITY',       targetWeight: 0.10, rationale: 'Emerging markets (fallback)' },
      { instrument: 'BND',  assetClass: 'FIXED_INCOME', targetWeight: 0.45, rationale: 'Fixed income ballast (fallback)' },
    ],
    totalExposure: 1.0,
    equityWeight: 0.55,
    riskMetrics: { concentrationRisk: 0.2, sectorDiversity: 0.6, largestPositionWeight: 0.15 },
    confidence: 0.2,
  };
}

export function rebalancePlannerFallback(_state: Record<string, unknown>): Record<string, unknown> {
  return {
    trades: [],
    estimatedTurnover: 0,
    confidence: 0.2,
  };
}
