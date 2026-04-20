import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for advisory-ctrl integration tests.
 *
 * Mirrors the real container's contract:
 * - Body is `{ tenantId, decisionId, upstreamOutputs }` (AgentInvocation envelope).
 * - Response is the agent result JSON directly (no `{response, status}` envelope).
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const _payload = event.body ? JSON.parse(event.body) : {}; // parse to validate shape
  void _payload;
  return json(200, {
    'user-goals': {
      goals: [{ description: 'Mock growth goal', priority: 'HIGH', timeHorizon: 'LONG_TERM' }],
      investmentStyle: 'GROWTH',
      confidence: 0.9,
    },
    'risk-assessment': {
      riskScore: 7,
      riskBand: 'MODERATE',
      maxDrawdownTolerance: 0.15,
      confidence: 0.85,
    },
    'market-research': {
      signals: [{ indicator: 'VIX', value: 18, interpretation: 'LOW_VOLATILITY' }],
      regime: 'BULL',
      confidence: 0.8,
    },
    'portfolio-construction': {
      allocations: [
        { ticker: 'VTI', weight: 0.6, assetClass: 'US_EQUITY' },
        { ticker: 'BND', weight: 0.4, assetClass: 'FIXED_INCOME' },
      ],
      confidence: 0.85,
    },
    'rebalance-planner': {
      trades: [
        { ticker: 'VTI', action: 'buy', quantity: 5 },
        { ticker: 'BND', action: 'buy', quantity: 10 },
      ],
      urgency: 'NORMAL',
      confidence: 0.9,
    },
    explainability: {
      summary: 'Mock: Portfolio rebalanced toward growth allocation.',
      rationale: 'Mock rationale for integration test',
      keyFactors: ['Market conditions favorable', 'Risk tolerance moderate'],
      tone: 'confident',
      wordCount: 12,
      confidence: 0.85,
    },
  });
}
