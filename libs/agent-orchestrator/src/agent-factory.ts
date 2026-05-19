import { ChatBedrockConverse } from '@langchain/aws';
import type { z } from 'zod';
import type { AgentConfig } from './types';
import type { AgentNodeFn } from './with-validation';
import { DegradedStructuredOutputError } from './errors';

// Phase γ.4 (Spec 4, 2026-05-06): mirrors onboarding-bff's named-tool retry
// guard from Spec 3 (services/investor/onboarding-bff/src/agent/phase-node.ts,
// commit fa78514c). When the first structured.invoke returns an empty /
// shallow payload, retry once with tool_choice pinned to the schema and a
// REINFORCE_SUFFIX appended. Failure on the second attempt throws
// DegradedStructuredOutputError, which propagates to withFallback (which
// marks the wave entry ok:false per Phase β).

const REINFORCE_SUFFIX =
  '\n\nIMPORTANT: Your previous response had empty or missing required fields. Re-emit the structured-output tool call with EVERY required field populated. Returning empty fields again is a hard failure.';

export function looksDegraded(result: unknown, schema: z.ZodType): boolean {
  if (typeof result !== 'object' || result === null) return true;
  const keys = Object.keys(result as Record<string, unknown>);
  if (keys.length === 0) return true;
  // Shallow check (Q1 resolved 2026-05-06): pull the schema's top-level shape
  // when introspectable; if at least one populated value matches one of those
  // keys, the result is not degraded.
  const def = (schema as unknown as { _def?: { shape?: () => Record<string, unknown> } })._def;
  const fromDef = def?.shape ? def.shape() : undefined;
  const fromShape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
  const shape = fromDef ?? fromShape ?? {};
  const requiredKeys = Object.keys(shape);
  if (requiredKeys.length === 0) return false; // can't introspect — assume ok
  const r = result as Record<string, unknown>;
  for (const k of requiredKeys) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length > 0) return false;
    if (typeof v === 'object' && Object.keys(v as Record<string, unknown>).length > 0) return false;
    if (typeof v === 'string' && v.length > 0) return false;
    if (typeof v === 'number') return false;
    if (typeof v === 'boolean') return false;
  }
  return true;
}

export function createAgentNode<T extends z.ZodType>(config: AgentConfig<T>): AgentNodeFn {
  const { modelId, maxTokens, temperature, schema, promptTemplate } = config;

  return async (state, runnableConfig) => {
    const llm = new ChatBedrockConverse({
      model: modelId,
      maxTokens,
      temperature,
      region: 'us-east-1',
    });

    const structured = llm.withStructuredOutput(schema as any);
    const input = typeof state.input === 'string' ? state.input : JSON.stringify(state);
    const basePrompt = promptTemplate.replace('{input}', input);
    const feedback = state['__retryFeedback'] as string | undefined;
    const prompt = feedback
      ? `${basePrompt}\n\nPRIOR ATTEMPT FEEDBACK — your previous output was rejected. Correct it now:\n${feedback}`
      : basePrompt;
    // Forward RunnableConfig so LangChain propagates the AgentTracer's callbacks
    // (installed by invokeOrchestrator via graph.invoke(input, {callbacks: [...]}))
    // down to the LLM call. Without this, handleLLMStart/End never fire and
    // envelope.llmCalls stays empty.
    const result = await structured.invoke(prompt, runnableConfig);

    if (!looksDegraded(result, schema)) {
      return result as Record<string, unknown>;
    }

    // Attempt #2 with tool_choice pinned to the schema's tool name. Spec 3
    // (services/investor/onboarding-bff/src/agent/phase-node.ts) showed that
    // pinning tool_choice + reinforcing the prompt is enough to recover
    // Sonnet 4.6's intermittent zero-tool-call cases. Same callbacks flow
    // through so the AgentTracer captures both attempts.
    const schemaToolName =
      (schema as unknown as { _def?: { typeName?: string } })._def?.typeName ?? 'StructuredOutput';
    const pinned = llm.withStructuredOutput(schema as any, { name: schemaToolName, includeRaw: false } as any);
    const retried = await pinned.invoke(prompt + REINFORCE_SUFFIX, runnableConfig);

    if (looksDegraded(retried, schema)) {
      throw new DegradedStructuredOutputError({
        schemaName: schemaToolName,
        attempts: 2,
      });
    }

    return retried as Record<string, unknown>;
  };
}
