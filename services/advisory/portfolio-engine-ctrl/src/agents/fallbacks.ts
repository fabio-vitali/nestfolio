export function portfolioConstructionFallback(_state: Record<string, unknown>): Record<string, unknown> {
  return {
    allocations: [
      { instrument: 'VTI', targetWeight: 0.5, rationale: 'US equity core (fallback)' },
      { instrument: 'BND', targetWeight: 0.3, rationale: 'Fixed income ballast (fallback)' },
      { instrument: 'VXUS', targetWeight: 0.2, rationale: 'International diversification (fallback)' },
    ],
    totalExposure: 1.0,
    riskMetrics: { concentrationRisk: 0.3, sectorDiversity: 0.5 },
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
