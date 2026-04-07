import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent that returns canned callback payloads for each agent type.
 * Used by decision-workflow-ctrl integration tests.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? '{}');
  const agentType = body.agentType ?? 'unknown';

  const responses: Record<string, unknown> = {
    InvestorProfile: {
      status: 'COMPLETED',
      output: {
        riskTolerance: 'MODERATE',
        investmentHorizon: 'LONG_TERM',
        financialGoals: ['GROWTH', 'RETIREMENT'],
        constraints: [],
      },
    },
    MarketAnalysis: {
      status: 'COMPLETED',
      output: {
        marketOutlook: 'NEUTRAL',
        sectorRecommendations: ['TECHNOLOGY', 'HEALTHCARE'],
        riskFactors: ['INFLATION', 'INTEREST_RATES'],
        confidenceScore: 0.78,
      },
    },
    Portfolio: {
      status: 'COMPLETED',
      output: {
        proposedTrades: [
          { symbol: 'VTI', side: 'BUY', quantity: 10, targetWeight: 0.6 },
          { symbol: 'BND', side: 'BUY', quantity: 20, targetWeight: 0.4 },
        ],
        expectedReturn: 0.08,
        expectedRisk: 0.12,
      },
    },
    Narrative: {
      status: 'COMPLETED',
      output: {
        explanation: 'Mock portfolio recommendation based on your moderate risk tolerance and long-term growth goals.',
        keyPoints: ['Diversified allocation', 'Low-cost index funds', 'Bond cushion for stability'],
      },
    },
  };

  return json(200, responses[agentType] ?? { status: 'COMPLETED', output: {} });
}
