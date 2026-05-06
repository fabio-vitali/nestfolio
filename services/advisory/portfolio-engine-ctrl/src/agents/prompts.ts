import { formatStructuredOutputPrompt } from '@nestfolio/agent-orchestrator';

export type OperatingMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

// Per-mode worked example shapes. Numbers are tuned to sit inside their mode
// envelope so the model anchors on a mode-correct shape rather than regressing
// to a BALANCED-shaped output. See spec § "Concrete worked examples" for the
// reasoning behind each example.

const conservativeShape = `{
  "allocations": [
    {
      "instrument": "BND",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.50,
      "rationale": "Core aggregate bond ETF for capital preservation"
    },
    {
      "instrument": "SHY",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.30,
      "rationale": "Short-duration treasuries — minimal interest-rate sensitivity"
    },
    {
      "instrument": "VTI",
      "assetClass": "EQUITY",
      "targetWeight": 0.10,
      "rationale": "Broad-market US equity for modest growth participation"
    },
    {
      "instrument": "IXUS",
      "assetClass": "EQUITY",
      "targetWeight": 0.10,
      "rationale": "Broad ex-US equity for geographic diversification"
    }
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.20,
  "riskMetrics": {
    "concentrationRisk": 0.10,
    "sectorDiversity": 0.85,
    "largestPositionWeight": 0.10
  },
  "confidence": 0.88
}`;

const balancedShape = `{
  "allocations": [
    {
      "instrument": "VTI",
      "assetClass": "EQUITY",
      "targetWeight": 0.14,
      "rationale": "Core US broad-market equity"
    },
    {
      "instrument": "IXUS",
      "assetClass": "EQUITY",
      "targetWeight": 0.14,
      "rationale": "Broad ex-US equity for geographic diversification"
    },
    {
      "instrument": "QQQ",
      "assetClass": "EQUITY",
      "targetWeight": 0.14,
      "rationale": "Tech tilt within equity sleeve"
    },
    {
      "instrument": "VWO",
      "assetClass": "EQUITY",
      "targetWeight": 0.13,
      "rationale": "Emerging markets equity"
    },
    {
      "instrument": "BND",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.27,
      "rationale": "Aggregate bond ETF for income and ballast"
    },
    {
      "instrument": "SHY",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.18,
      "rationale": "Short-duration treasuries — interest-rate hedge"
    }
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.55,
  "riskMetrics": {
    "concentrationRisk": 0.18,
    "sectorDiversity": 0.72,
    "largestPositionWeight": 0.14
  },
  "confidence": 0.86
}`;

const aggressiveShape = `{
  "allocations": [
    {
      "instrument": "VTI",
      "assetClass": "EQUITY",
      "targetWeight": 0.20,
      "rationale": "Core US broad-market equity"
    },
    {
      "instrument": "VOO",
      "assetClass": "EQUITY",
      "targetWeight": 0.18,
      "rationale": "S&P 500 — large-cap exposure"
    },
    {
      "instrument": "QQQ",
      "assetClass": "EQUITY",
      "targetWeight": 0.15,
      "rationale": "Nasdaq-100 tech tilt"
    },
    {
      "instrument": "IXUS",
      "assetClass": "EQUITY",
      "targetWeight": 0.12,
      "rationale": "Broad ex-US equity"
    },
    {
      "instrument": "VWO",
      "assetClass": "EQUITY",
      "targetWeight": 0.10,
      "rationale": "Emerging markets equity"
    },
    {
      "instrument": "ARKK",
      "assetClass": "EQUITY",
      "targetWeight": 0.10,
      "rationale": "Disruptive innovation thematic"
    },
    {
      "instrument": "BND",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.10,
      "rationale": "Bond ballast for volatility control"
    },
    {
      "instrument": "BIL",
      "assetClass": "CASH",
      "targetWeight": 0.05,
      "rationale": "T-bill ETF — dry powder"
    }
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.85,
  "riskMetrics": {
    "concentrationRisk": 0.22,
    "sectorDiversity": 0.65,
    "largestPositionWeight": 0.20
  },
  "confidence": 0.84
}`;

interface ModeEnvelope {
  readonly schemaShape: string;
  readonly equityRule: string;
  readonly largestEquityRule: string;
  readonly countRule: string;
}

const modeEnvelopes: Record<OperatingMode, ModeEnvelope> = {
  CONSERVATIVE: {
    schemaShape: conservativeShape,
    equityRule: 'equityWeight MUST be ≤ 0.30 (the rest in fixed income / cash).',
    largestEquityRule: 'The largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.10. Bond and cash positions may exceed this cap because they are diversified by construction.',
    countRule: 'allocations.length MUST be between 3 and 5 inclusive.',
  },
  BALANCED: {
    schemaShape: balancedShape,
    equityRule: 'equityWeight MUST be in [0.50, 0.70].',
    largestEquityRule: 'The largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.15. Bond and cash positions may exceed this cap because they are diversified by construction.',
    countRule: 'allocations.length MUST be between 5 and 8 inclusive.',
  },
  AGGRESSIVE: {
    schemaShape: aggressiveShape,
    equityRule: 'equityWeight MUST be in [0.70, 0.90].',
    largestEquityRule: 'The largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.25. Bond and cash positions may exceed this cap because they are diversified by construction.',
    countRule: 'allocations.length MUST be between 6 and 12 inclusive.',
  },
};

export function buildPortfolioConstructionPrompt(mode: OperatingMode): string {
  const env = modeEnvelopes[mode as keyof typeof modeEnvelopes] ?? modeEnvelopes['BALANCED'];
  return formatStructuredOutputPrompt({
    role: 'portfolio construction specialist',
    task: `Design target allocations based on the investor profile, risk assessment, and market analysis. The investor is in ${mode} mode — the worked example above and the rules below are tuned to that mode and MUST be honoured. Use fund prospectus and instrument data from the knowledge base when available.`,
    schemaShape: env.schemaShape,
    rules: [
      `OPERATING MODE: ${mode}. ${env.equityRule}`,
      env.largestEquityRule,
      env.countRule,
      'Every allocation MUST include assetClass as one of EQUITY | FIXED_INCOME | REIT | COMMODITY | CASH | CRYPTO | OTHER so the downstream pipeline can derive equity weight from individual positions.',
      'Total of allocations.targetWeight values MUST equal totalExposure (typically 1.0).',
      'equityWeight MUST be the sum of targetWeight across allocations whose assetClass is EQUITY. riskMetrics.largestPositionWeight MUST be the maximum targetWeight across allocations whose assetClass is EQUITY (NOT across all allocations — bond and cash positions are excluded from this metric).',
      'Every allocation MUST include a non-empty rationale string explaining why the position is selected and sized at that weight.',
      'confidence MUST be a number in [0, 1] reflecting the model\'s confidence in this allocation given the investor profile and market analysis.',
    ],
  });
}

const rebalancePlannerSchemaShape = `{
  "trades": [
    {
      "action": "BUY",
      "instrument": "VTI",
      "targetWeight": 0.55,
      "currentWeight": 0.40,
      "quantity": 12,
      "rationale": "Increase US equity exposure to reach target weight"
    },
    {
      "action": "SELL",
      "instrument": "AGG",
      "targetWeight": 0.00,
      "currentWeight": 0.10,
      "quantity": 8,
      "rationale": "Exit overlapping bond fund in favour of BND"
    }
  ],
  "estimatedTurnover": 0.15,
  "confidence": 0.83
}`;

export const rebalancePlannerPrompt = formatStructuredOutputPrompt({
  role: 'rebalance planning specialist',
  task: 'Given current portfolio holdings and target allocations, plan specific trades to reach the target state. Minimise turnover and transaction costs; consider tax-loss harvesting opportunities and trade execution constraints.',
  schemaShape: rebalancePlannerSchemaShape,
  rules: [
    'Every trade MUST include an action of BUY | SELL | REBALANCE.',
    'Every trade MUST include both targetWeight and currentWeight (each a number) so the downstream pipeline can size the order delta.',
    'quantity MAY be null if the lot-level quantity cannot be derived deterministically; in that case the rationale MUST explain why.',
    'Every trade MUST include a non-empty rationale string explaining the trade intent (rebalance, tax-loss, drift correction, etc.).',
    'estimatedTurnover MUST be a number in [0, 1] approximating the fraction of portfolio value moved by the planned trades.',
    'confidence MUST be a number in [0, 1] reflecting the model\'s confidence in this trade plan.',
    'If no trades are required because the portfolio already matches the target, return an empty trades array with estimatedTurnover=0 and a high confidence — but only when current and target allocations match within tolerance.',
  ],
});
