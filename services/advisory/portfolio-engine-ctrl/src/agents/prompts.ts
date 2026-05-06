import { formatStructuredOutputPrompt } from '@nestfolio/agent-orchestrator';

const portfolioConstructionSchemaShape = `{
  "allocations": [
    {
      "instrument": "VTI",
      "assetClass": "EQUITY",
      "targetWeight": 0.55,
      "rationale": "Core US equity exposure via low-cost broad-market ETF"
    },
    {
      "instrument": "BND",
      "assetClass": "FIXED_INCOME",
      "targetWeight": 0.30,
      "rationale": "Aggregate bond ETF for income and ballast"
    }
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.55,
  "riskMetrics": {
    "concentrationRisk": 0.18,
    "sectorDiversity": 0.72,
    "largestPositionWeight": 0.55
  },
  "confidence": 0.86
}`;

export const portfolioConstructionPrompt = formatStructuredOutputPrompt({
  role: 'portfolio construction specialist',
  task: 'Design target allocations based on the investor profile, risk assessment, and market analysis. Use fund prospectus and instrument data from the knowledge base when available.',
  schemaShape: portfolioConstructionSchemaShape,
  rules: [
    'The Operating Mode behavioural envelope is provided in the Input below. You MUST honour the equity weight band, single-position cap, and position count specified there — these are HARD RULES for this invocation.',
    'Every allocation MUST include assetClass as one of EQUITY | FIXED_INCOME | REIT | COMMODITY | CASH | CRYPTO | OTHER so the downstream pipeline can derive equity weight from individual positions.',
    'Total of allocations.targetWeight values MUST equal totalExposure (typically 1.0).',
    'equityWeight MUST be the sum of targetWeight across allocations whose assetClass is EQUITY (or REIT if interpreted as equity-like). riskMetrics.largestPositionWeight MUST be the maximum targetWeight across allocations.',
    'allocations.length MUST fall within the position-count band specified by the Operating Mode in the Input.',
    'Every allocation MUST include a non-empty rationale string explaining why the position is selected and sized at that weight.',
    'confidence MUST be a number in [0, 1] reflecting the model\'s confidence in this allocation given the investor profile and market analysis.',
  ],
});

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
