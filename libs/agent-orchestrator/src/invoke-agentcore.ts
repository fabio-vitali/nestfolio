import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type { AgentInvocation } from './types';

let cachedClient: BedrockAgentCoreClient | undefined;

function getClient(): BedrockAgentCoreClient {
  if (!cachedClient) {
    cachedClient = new BedrockAgentCoreClient({});
  }
  return cachedClient;
}

async function streamToString(body: unknown): Promise<string> {
  if (!body) throw new Error('AgentCore runtime returned no response body');
  // SDK stream types expose transformToString() via the smithy stream mixin.
  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === 'function') {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }
  // Fallback for raw Node streams.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Invoke an AgentCore Runtime via the Bedrock data-plane API.
 *
 * `runtimeSessionId` is set to `${tenantId}/${decisionId}` so memory scopes
 * per-decision and downstream trace traps can correlate without parsing the body.
 *
 * Streaming responses are intentionally unsupported here — the five advisory
 * agents are batch. A future streaming variant should live in a sibling file
 * (`invoke-agentcore-streaming.ts`) so this function stays request/response.
 */
export async function invokeAgentCoreRuntime<T>(
  agentRuntimeArn: string,
  payload: AgentInvocation,
): Promise<T> {
  const client = getClient();
  const runtimeSessionId = `${payload.tenantId}/${payload.decisionId}`;
  const body = new TextEncoder().encode(JSON.stringify(payload));

  const result = await client.send(new InvokeAgentRuntimeCommand({
    agentRuntimeArn,
    runtimeSessionId,
    payload: body,
  }));

  const text = await streamToString(result.response);
  return JSON.parse(text) as T;
}
