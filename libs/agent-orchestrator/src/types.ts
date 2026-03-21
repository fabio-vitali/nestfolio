import type { z } from 'zod';

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
}

export interface ValidationRule<T> {
  readonly validate: (output: T) => ValidationResult;
}

export class ValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Validation failed: ${errors.join('; ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
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

export interface InvokeOptions {
  readonly logger?: unknown;
  readonly metrics?: unknown;
}
