/* invoke-model.ts — single Bedrock structured-output call. Returns latency,
 * token counts (read from raw.usage_metadata — NOT the broken
 * output.llmOutput.tokenUsage path the production AgentTracer uses; see
 * backlog agent-tracer-bedrock-converse-token-extraction), parsed result,
 * schema-pass boolean, and the raw error string on failure.
 *
 * The production agent-factory.ts retry path (looksDegraded → REINFORCE_SUFFIX
 * → second attempt) is intentionally NOT replicated here — the benchmark
 * measures per-call behaviour. The benchmark records `notDegraded` separately
 * so Claude can still reason about whether the production retry would have
 * been triggered.
 */

import { ChatBedrockConverse } from '@langchain/aws';
import type { z } from 'zod';
import { hrtimeMsAround } from './timings';

export interface InvokeArgs<T extends z.ZodType> {
  readonly modelId: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly schema: T;
  readonly prompt: string;
}

export interface InvokeOutcome {
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly schemaPass: boolean;
  readonly parsed: Record<string, unknown> | null;
  readonly error: string | null;
}

export async function invokeStructured<T extends z.ZodType>(
  args: InvokeArgs<T>,
): Promise<InvokeOutcome> {
  const llm = new ChatBedrockConverse({
    model: args.modelId,
    maxTokens: args.maxTokens,
    temperature: args.temperature,
    region: 'us-east-1',
  });
  // includeRaw: true returns { raw: AIMessage, parsed: T }. usage_metadata
  // hangs off raw and carries Converse's token counts correctly.
  const structured = llm.withStructuredOutput(args.schema as never, { includeRaw: true });
  try {
    const { ms, value } = await hrtimeMsAround(async () => structured.invoke(args.prompt));
    const v = value as unknown as {
      raw?: {
        usage_metadata?: { input_tokens?: number; output_tokens?: number };
      };
      parsed?: Record<string, unknown>;
    };
    const inputTokens = v.raw?.usage_metadata?.input_tokens ?? 0;
    const outputTokens = v.raw?.usage_metadata?.output_tokens ?? 0;
    return {
      latencyMs: Math.round(ms),
      inputTokens,
      outputTokens,
      schemaPass: true,
      parsed: v.parsed ?? null,
      error: null,
    };
  } catch (err) {
    return {
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      schemaPass: false,
      parsed: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
