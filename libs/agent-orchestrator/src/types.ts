import type { z } from 'zod';
import type { Logger } from '@aws-lambda-powertools/logger';
import type { Metrics } from '@aws-lambda-powertools/metrics';
import type { TraceEmitter } from './emitters/types';

export interface AgentConfig<T extends z.ZodType> {
  readonly modelId: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly schema: T;
  readonly promptTemplate: string;
}

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly escalationPath?: ModelTier[];
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly feedback?: string;
}

export interface ValidationContext {
  readonly state: Record<string, unknown>;
  readonly attempt: number;
}

export interface ValidationRule<T> {
  readonly validate: (output: T, ctx?: ValidationContext) => ValidationResult;
}

export class ValidationError extends Error {
  readonly errors: string[];
  readonly feedback?: string;
  constructor(errors: string[], opts?: { feedback?: string }) {
    super(`Validation failed: ${errors.join('; ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
    this.feedback = opts?.feedback;
  }
}

export type WaveDefinition<K extends string> = ReadonlyArray<{
  readonly agents: K[];
  readonly dependsOn?: K[];
}>;

export interface OrchestratorConfig<K extends string, TState> {
  readonly waves: WaveDefinition<K>;
  readonly stateAnnotation: unknown;
  readonly agents: Record<K, AgentConfig<any>>;
  readonly fallbacks?: Record<K, (input: TState) => Partial<TState>>;
  readonly validationRules?: Record<K, ValidationRule<any>>;
  readonly retryOptions?: RetryOptions;
}

export interface ServiceUnavailableResponse {
  readonly serviceUnavailable: true;
  readonly reason: string;
}

interface BaseInvokeOptions {
  readonly logger?: Logger;
  readonly metrics?: Metrics;
}

interface InvokeOptionsWithoutEmitter extends BaseInvokeOptions {
  readonly emitter?: undefined;
  readonly agent?: string;
  readonly correlationId?: string;
  readonly tenantId?: string;
}

interface InvokeOptionsWithEmitter extends BaseInvokeOptions {
  readonly emitter: TraceEmitter;
  readonly agent: string;
  readonly correlationId: string;
  readonly tenantId?: string;
}

export type InvokeOptions = InvokeOptionsWithoutEmitter | InvokeOptionsWithEmitter;

/**
 * Structured envelope every caller sends to an agent runtime — whether
 * the runtime is AgentCore (real) or an HTTPS mock URL (integration tests).
 *
 * `upstreamOutputs` is an opaque per-agent shape; each agent's graph.ts
 * decides how to consume it.
 */
export interface AgentInvocation {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly upstreamOutputs: Record<string, unknown>;
}
