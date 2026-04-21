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
  // Log shape of the response so degraded/empty replies are diagnosable.
  // Preview is truncated to keep log volume bounded; full body recoverable
  // from downstream AgentInvocation DDB row or re-invocation with X-Ray.
  // Using console.log (Lambda-native JSON capture) to avoid taking a
  // logger dependency from this foundational lib.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    level: 'INFO',
    message: 'invokeAgentCoreRuntime response',
    runtimeSessionId,
    sessionIdLength: runtimeSessionId.length,
    responseBytes: text.length,
    responsePreview: text.length > 256 ? `${text.slice(0, 256)}…` : text,
  }));
  return JSON.parse(text) as T;
}
