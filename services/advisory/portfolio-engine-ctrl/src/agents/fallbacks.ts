export function portfolioConstructionFallback(_state: Record<string, unknown>): Record<string, unknown> {
  return {
    allocations: [
      { instrument: 'VTI', targetWeight: 0.5, rationale: 'US equity core (fallback)' },
      { instrument: 'BND', targetWeight: 0.3, rationale: 'Fixed income ballast (fallback)' },
      { instrument: 'VXUS', targetWeight: 0.2, rationale: 'International diversification (fallback)' },
    ],
    totalExposure: 1.0,
    // BALANCED-shaped fallback: equityWeight 0.7 (VTI 0.5 + VXUS 0.2), largest position VTI 0.5.
    // The fallback is a coarse safety net — it intentionally does not vary by mode.
    equityWeight: 0.7,
    riskMetrics: { concentrationRisk: 0.3, sectorDiversity: 0.5, largestPositionWeight: 0.5 },
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
