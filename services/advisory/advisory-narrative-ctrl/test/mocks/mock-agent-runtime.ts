import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for advisory-narrative-ctrl integration tests.
 *
 * Mirrors the real container's contract:
 * - Body is `{ tenantId, decisionId, upstreamOutputs }`.
 * - Response is the orchestrator result JSON directly: `{[agentKey]: AgentNodeResult}`
 *   where AgentNodeResult is the Phase β discriminated union
 *   { ok: true; output } | { ok: false; reason; fallback }.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const _payload = event.body ? JSON.parse(event.body) : {}; // parse to validate shape
  void _payload;
  return json(200, {
    explainability: {
      ok: true,
      output: {
        summary: 'Mock: Your portfolio has been rebalanced to align with your growth objectives.',
        rationale: 'Mock rationale: Market conditions support increased equity exposure.',
        keyFactors: ['Moderate risk tolerance', 'Long-term growth goal', 'Low volatility environment'],
        tone: 'confident',
        wordCount: 18,
        confidence: 0.88,
      },
    },
  });
}
