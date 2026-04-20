import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for portfolio-engine-ctrl integration tests.
 *
 * Mirrors the real container's contract:
 * - Body is `{ tenantId, decisionId, upstreamOutputs }` (AgentInvocation envelope).
 * - Response is the agent result JSON directly (no `{response, status}` envelope).
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const payload = event.body ? JSON.parse(event.body) : {};
  if (!payload.tenantId || !payload.decisionId) {
    return json(400, { error: 'Missing required AgentInvocation fields: tenantId, decisionId' });
  }
  return json(200, {
    'portfolio-construction': {
      allocations: [
        { ticker: 'VTI', weight: 0.6, assetClass: 'US_EQUITY' },
        { ticker: 'VXUS', weight: 0.2, assetClass: 'INTL_EQUITY' },
        { ticker: 'BND', weight: 0.2, assetClass: 'FIXED_INCOME' },
      ],
      confidence: 0.88,
    },
    'rebalance-planner': {
      trades: [
        { ticker: 'VTI', action: 'buy', quantity: 3 },
        { ticker: 'VXUS', action: 'buy', quantity: 2 },
      ],
      urgency: 'NORMAL',
      confidence: 0.85,
    },
  });
}
