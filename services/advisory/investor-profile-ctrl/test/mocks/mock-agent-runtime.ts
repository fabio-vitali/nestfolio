import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for investor-profile-ctrl.
 *
 * Mirrors the real container's contract:
 * - Body is `{ tenantId, decisionId, upstreamOutputs }` (AgentInvocation envelope).
 * - Response is the orchestrator result JSON directly: `{[agentKey]: AgentNodeResult}`
 *   where AgentNodeResult is the Phase β discriminated union
 *   { ok: true; output } | { ok: false; reason; fallback }.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const _payload = event.body ? JSON.parse(event.body) : {}; // parse to validate shape
  void _payload;
  return json(200, {
    'user-goals': {
      ok: true,
      output: {
        goals: [{ description: 'Mock retirement goal', priority: 'HIGH', timeHorizon: 'LONG_TERM' }],
        investmentStyle: 'BALANCED',
        confidence: 0.9,
      },
    },
    'risk-assessment': {
      ok: true,
      output: {
        riskScore: 6,
        riskBand: 'MODERATE',
        maxDrawdownTolerance: 0.12,
        confidence: 0.85,
      },
    },
  });
}
