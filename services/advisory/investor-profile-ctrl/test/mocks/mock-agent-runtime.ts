import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for investor-profile-ctrl.
 * Returns canned orchestrator output keyed by agent name.
 */
export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    'user-goals': {
      goals: [{ description: 'Mock retirement goal', priority: 'HIGH', timeHorizon: 'LONG_TERM' }],
      investmentStyle: 'BALANCED',
      confidence: 0.9,
    },
    'risk-assessment': {
      riskScore: 6,
      riskBand: 'MODERATE',
      maxDrawdownTolerance: 0.12,
      confidence: 0.85,
    },
  });
}
