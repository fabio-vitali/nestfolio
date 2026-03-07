export const MODERATE_INVESTOR_CONTEXT = {
  triggerEvent: { type: 'MANDATE_GRANTED', id: 'golden-evt-1' },
  investorProfile: {
    tenantId: 'golden-t1',
    operatingMode: 'BALANCED',
    riskScore: 5,
    goalObjective: 'Long-term growth',
    timeHorizonMonths: 120,
    monthlyContributionCents: 50000,
  },
  portfolioState: {
    positions: [],
    cashBalance: 10000_00,
    totalValue: 10000_00,
  },
  mandate: {
    level: 'ADVISORY',
    maxSingleTradePercent: 0.2,
    monthlyTurnoverCapPercent: 0.5,
    coolDownDays: 7,
    rebalanceCadence: 'MONTHLY',
  },
};

export const AGGRESSIVE_INVESTOR_CONTEXT = {
  triggerEvent: { type: 'GOAL_UPDATED', id: 'golden-evt-2' },
  investorProfile: {
    tenantId: 'golden-t2',
    operatingMode: 'AGGRESSIVE',
    riskScore: 9,
    goalObjective: 'Maximum growth',
    timeHorizonMonths: 240,
    monthlyContributionCents: 100000,
  },
  portfolioState: {
    positions: [
      { ticker: 'VTI', quantity: 50, currentValue: 15000_00 },
      { ticker: 'BND', quantity: 20, currentValue: 2000_00 },
    ],
    cashBalance: 3000_00,
    totalValue: 20000_00,
  },
  mandate: {
    level: 'DISCRETIONARY',
    maxSingleTradePercent: 0.3,
    monthlyTurnoverCapPercent: 0.8,
    coolDownDays: 3,
    rebalanceCadence: 'WEEKLY',
  },
};

export const CONSERVATIVE_INVESTOR_CONTEXT = {
  triggerEvent: { type: 'RISK_PROFILE_UPDATED', id: 'golden-evt-3' },
  investorProfile: {
    tenantId: 'golden-t3',
    operatingMode: 'CONSERVATIVE',
    riskScore: 2,
    goalObjective: 'Capital preservation',
    timeHorizonMonths: 36,
    monthlyContributionCents: 20000,
  },
  portfolioState: {
    positions: [
      { ticker: 'BND', quantity: 100, currentValue: 10000_00 },
      { ticker: 'VGSH', quantity: 50, currentValue: 5000_00 },
    ],
    cashBalance: 5000_00,
    totalValue: 20000_00,
  },
  mandate: {
    level: 'ADVISORY',
    maxSingleTradePercent: 0.1,
    monthlyTurnoverCapPercent: 0.2,
    coolDownDays: 14,
    rebalanceCadence: 'QUARTERLY',
  },
};

export const EDGE_CASE_MINIMAL_PORTFOLIO = {
  triggerEvent: { type: 'DEPOSIT_DETECTED', id: 'golden-evt-4' },
  investorProfile: {
    tenantId: 'golden-t4',
    operatingMode: 'BALANCED',
    riskScore: 5,
    goalObjective: 'First investment',
    timeHorizonMonths: 60,
    monthlyContributionCents: 10000,
  },
  portfolioState: {
    positions: [],
    cashBalance: 100_00, // Only $100
    totalValue: 100_00,
  },
  mandate: {
    level: 'ADVISORY',
    maxSingleTradePercent: 0.5,
    monthlyTurnoverCapPercent: 1.0,
    coolDownDays: 0,
    rebalanceCadence: 'MONTHLY',
  },
};

export const EDGE_CASE_CONFLICTING_CONSTRAINTS = {
  triggerEvent: { type: 'OPERATING_MODE_CHANGED', id: 'golden-evt-5' },
  investorProfile: {
    tenantId: 'golden-t5',
    operatingMode: 'AGGRESSIVE',
    riskScore: 2, // Low risk score but aggressive mode — conflict
    goalObjective: 'Maximum growth with capital preservation', // Contradictory
    timeHorizonMonths: 12, // Short horizon + aggressive — conflict
    monthlyContributionCents: 500000,
  },
  portfolioState: {
    positions: [{ ticker: 'VTI', quantity: 200, currentValue: 50000_00 }],
    cashBalance: 50000_00,
    totalValue: 100000_00,
  },
  mandate: {
    level: 'DISCRETIONARY',
    maxSingleTradePercent: 0.05, // Very low cap
    monthlyTurnoverCapPercent: 0.1, // Very low turnover
    coolDownDays: 30, // Long cool-down
    rebalanceCadence: 'QUARTERLY',
  },
};
