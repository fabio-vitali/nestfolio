# Agent-Core Generic Refactor — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform `libs/agent-core` from a domain-coupled library into a fully generic LangGraph+Bedrock orchestration toolkit, moving all decision lifecycle domain code to `services/advisory/advisory-ctrl/src/agents/`.

**Architecture:** The current agent-core mixes generic orchestration infrastructure (node creation, retry/escalation, wave orchestration) with domain-specific code (6 agent schemas, model configs, fallback outputs, validation rules, prompt templates, golden fixtures). This plan separates those concerns: agent-core becomes a reusable toolkit with generic types (`AgentConfig<T>`, `WaveDefinition<K>`, `OrchestratorConfig<K,TState>`), while advisory-ctrl owns its domain config. The monolithic `createRetryableAgentNode()` is decomposed into `withValidation()` + `withRetry()` + `withFallback()` decorators.

**Tech Stack:** TypeScript, LangGraph.js, Bedrock (ChatBedrockConverse), Zod, AWS Lambda Powertools, Jest

**Spec:** `docs/superpowers/specs/2026-03-17-agent-core-split-design.md`

---

## File Structure

### agent-core (generic lib) — files to CREATE or REWRITE

| File | Responsibility |
|---|---|
| `libs/agent-core/src/types.ts` | All generic types: `AgentConfig<T>`, `WaveDefinition<K>`, `OrchestratorConfig<K,TState>`, `ValidationRule<T>`, `ValidationResult`, `RetryOptions`, `ModelTier`, `ValidationError` |
| `libs/agent-core/src/agent-factory.ts` | `createAgentNode<T>(config: AgentConfig<T>)` — generic, no type lookup |
| `libs/agent-core/src/with-validation.ts` | `withValidation<T>(node, rule: ValidationRule<T>)` decorator |
| `libs/agent-core/src/with-retry.ts` | `withRetry(node, options: RetryOptions)` decorator — catches `ValidationError`, escalates tier |
| `libs/agent-core/src/with-fallback.ts` | `withFallback(node, fallbackFn)` decorator |
| `libs/agent-core/src/tier-escalation.ts` | `buildEscalationPath(startTier: ModelTier)` — keep, already generic |
| `libs/agent-core/src/create-orchestrator.ts` | `createOrchestrator<K,TState>(config)` — builds StateGraph from WaveDefinition, composes decorators per node |
| `libs/agent-core/src/invoke-orchestrator.ts` | `invokeOrchestrator(graph, input, options?)` — logging, metrics, primary→fallback, `ServiceUnavailableResponse` |
| `libs/agent-core/src/index.ts` | Barrel — exports only generic types + functions |

### agent-core — files to DELETE

| File | Reason |
|---|---|
| `libs/agent-core/src/model-config.ts` | Domain-specific `AgentType` + `AGENT_CONFIGS` → moves to advisory-ctrl |
| `libs/agent-core/src/output-validation.ts` | Domain-specific business rules → moves to advisory-ctrl |
| `libs/agent-core/src/fallback-agents.ts` | Domain-specific fallback outputs → moves to advisory-ctrl |
| `libs/agent-core/src/graph-orchestrator.ts` | Hardcoded 3-wave graph → replaced by generic `create-orchestrator.ts` |
| `libs/agent-core/src/agent-invoker.ts` | Hardcoded invocation → replaced by generic `invoke-orchestrator.ts` |
| `libs/agent-core/src/invoke-with-retry.ts` | Monolithic → decomposed into with-validation + with-retry + with-fallback |
| `libs/agent-core/src/output-schemas/` | All 7 files → moves to advisory-ctrl |
| `libs/agent-core/src/prompt-templates/` | All 7 files → moves to advisory-ctrl |
| `libs/agent-core/src/test-fixtures/` | All files → moves to advisory-ctrl |

### advisory-ctrl — files to CREATE (domain code destination)

| File | Responsibility |
|---|---|
| `services/advisory/advisory-ctrl/src/agents/schemas/user-goals.schema.ts` | GoalInterpretation Zod schema (moved from agent-core) |
| `services/advisory/advisory-ctrl/src/agents/schemas/risk-assessment.schema.ts` | RiskAssessment Zod schema |
| `services/advisory/advisory-ctrl/src/agents/schemas/market-research.schema.ts` | MarketResearch Zod schema |
| `services/advisory/advisory-ctrl/src/agents/schemas/portfolio-construction.schema.ts` | PortfolioConstruction Zod schema |
| `services/advisory/advisory-ctrl/src/agents/schemas/rebalance-planner.schema.ts` | RebalancePlan Zod schema |
| `services/advisory/advisory-ctrl/src/agents/schemas/explainability.schema.ts` | Explanation Zod schema |
| `services/advisory/advisory-ctrl/src/agents/schemas/index.ts` | Schema barrel exports |
| `services/advisory/advisory-ctrl/src/agents/config.ts` | `AgentType` union, `AGENT_CONFIGS` map, `DECISION_LIFECYCLE_WAVES` |
| `services/advisory/advisory-ctrl/src/agents/state.ts` | `DecisionLifecycleState` LangGraph annotation |
| `services/advisory/advisory-ctrl/src/agents/validation.ts` | Business rules for all 6 agents |
| `services/advisory/advisory-ctrl/src/agents/fallbacks.ts` | Deterministic fallback outputs (risk-profile-aware) |
| `services/advisory/advisory-ctrl/src/agents/prompts/loader.ts` | `loadPrompt(agentType)` — local readFileSync with cache |
| `services/advisory/advisory-ctrl/src/agents/prompts/*.txt` | 6 prompt template files (moved from agent-core) |
| `services/advisory/advisory-ctrl/src/agents/fixtures/golden-contexts.ts` | Golden test contexts (moved) |
| `services/advisory/advisory-ctrl/src/agents/fixtures/golden-outputs.ts` | Golden test outputs (moved) |

### advisory-ctrl — files to DELETE

| File | Reason |
|---|---|
| `services/advisory/advisory-ctrl/agents/decision-lifecycle/` | Entire directory (Nx project `decision-lifecycle-agent`) — absorbed into src/agents/ |

### Test files

| File | Responsibility |
|---|---|
| `libs/agent-core/test/types.test.ts` | Type exports exist, ValidationError is throwable |
| `libs/agent-core/test/agent-factory.test.ts` | REWRITE: generic config, no AgentType |
| `libs/agent-core/test/with-validation.test.ts` | CREATE: passes valid, throws ValidationError on invalid |
| `libs/agent-core/test/with-retry.test.ts` | CREATE: retry on ValidationError, escalation, max attempts |
| `libs/agent-core/test/with-fallback.test.ts` | CREATE: calls fallback on failure, passes input through |
| `libs/agent-core/test/tier-escalation.test.ts` | KEEP: already generic |
| `libs/agent-core/test/create-orchestrator.test.ts` | CREATE: wave wiring, parallel within wave, decorator composition |
| `libs/agent-core/test/invoke-orchestrator.test.ts` | CREATE: logging, metrics, fallback flow, ServiceUnavailableResponse |
| `services/advisory/advisory-ctrl/test/agents/schemas.test.ts` | CREATE: all 6 Zod schemas validation |
| `services/advisory/advisory-ctrl/test/agents/validation.test.ts` | CREATE: business rules for all 6 agents |
| `services/advisory/advisory-ctrl/test/agents/fallbacks.test.ts` | CREATE: deterministic outputs, schema compliance |
| `services/advisory/advisory-ctrl/test/agents/config.test.ts` | CREATE: all configs valid, wave deps correct |
| `services/advisory/advisory-ctrl/test/agents/golden-fixtures.test.ts` | CREATE: golden outputs pass schema + business validation |

### Test files to DELETE from agent-core

| File | Reason |
|---|---|
| `libs/agent-core/test/model-config.test.ts` | Tests domain-specific configs → replaced by advisory-ctrl config.test.ts |
| `libs/agent-core/test/output-schemas.test.ts` | Tests domain schemas → replaced by advisory-ctrl schemas.test.ts |
| `libs/agent-core/test/output-validation.test.ts` | Tests domain rules → replaced by advisory-ctrl validation.test.ts |
| `libs/agent-core/test/fallback-agents.test.ts` | Tests domain fallbacks → replaced by advisory-ctrl fallbacks.test.ts |
| `libs/agent-core/test/golden-fixtures.test.ts` | Tests domain fixtures → replaced by advisory-ctrl golden-fixtures.test.ts |
| `libs/agent-core/test/graph-orchestrator.test.ts` | Tests hardcoded graph → replaced by create-orchestrator.test.ts |
| `libs/agent-core/test/agent-invoker.test.ts` | Tests hardcoded invoker → replaced by invoke-orchestrator.test.ts |
| `libs/agent-core/test/invoke-with-retry.test.ts` | Tests monolithic retry → replaced by with-validation + with-retry + with-fallback tests |

---

## Chunk 1: Generic Types + Decorators (agent-core)

### Task 1: Create generic types module

**Files:**
- Create: `libs/agent-core/src/types.ts`
- Test: `libs/agent-core/test/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/agent-core/test/types.test.ts
import { ValidationError } from '../src/types';

describe('types', () => {
  describe('ValidationError', () => {
    it('is an instance of Error', () => {
      const err = new ValidationError(['field required']);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ValidationError');
      expect(err.errors).toEqual(['field required']);
      expect(err.message).toBe('Validation failed: field required');
    });

    it('joins multiple errors', () => {
      const err = new ValidationError(['err1', 'err2']);
      expect(err.message).toBe('Validation failed: err1; err2');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test agent-core -- --testPathPattern=types.test`
Expected: FAIL — cannot find module '../src/types'

- [ ] **Step 3: Write the types module**

```ts
// libs/agent-core/src/types.ts
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
  readonly stateAnnotation: unknown; // LangGraph Annotation — typed as unknown to avoid deep generic issues
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test agent-core -- --testPathPattern=types.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/agent-core/src/types.ts libs/agent-core/test/types.test.ts
git commit -m "feat(agent-core): add generic types module"
```

---

### Task 2: Create withValidation decorator

**Files:**
- Create: `libs/agent-core/src/with-validation.ts`
- Test: `libs/agent-core/test/with-validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/agent-core/test/with-validation.test.ts
import { withValidation } from '../src/with-validation';
import { ValidationError, type ValidationRule } from '../src/types';

describe('withValidation', () => {
  const passingRule: ValidationRule<{ value: string }> = {
    validate: (output) => ({ valid: true, errors: [] }),
  };

  const failingRule: ValidationRule<{ value: string }> = {
    validate: (output) => ({
      valid: output.value.length > 0,
      errors: output.value.length > 0 ? [] : ['value must not be empty'],
    }),
  };

  it('passes output through when validation succeeds', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'hello' });
    const validated = withValidation(node, passingRule);
    const result = await validated({ input: 'test' });
    expect(result).toEqual({ value: 'hello' });
  });

  it('throws ValidationError when validation fails', async () => {
    const node = jest.fn().mockResolvedValue({ value: '' });
    const validated = withValidation(node, failingRule);
    await expect(validated({ input: 'test' })).rejects.toThrow(ValidationError);
    await expect(validated({ input: 'test' })).rejects.toThrow('value must not be empty');
  });

  it('calls the underlying node with the input', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'ok' });
    const validated = withValidation(node, passingRule);
    await validated({ some: 'state' });
    expect(node).toHaveBeenCalledWith({ some: 'state' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test agent-core -- --testPathPattern=with-validation.test`
Expected: FAIL — cannot find module '../src/with-validation'

- [ ] **Step 3: Write the implementation**

```ts
// libs/agent-core/src/with-validation.ts
import { ValidationError, type ValidationRule } from './types';

export type AgentNodeFn = (state: Record<string, unknown>) => Promise<Record<string, unknown>>;

export function withValidation<T>(
  node: AgentNodeFn,
  rule: ValidationRule<T>,
): AgentNodeFn {
  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const output = await node(state);
    const result = rule.validate(output as unknown as T);
    if (!result.valid) {
      throw new ValidationError(result.errors);
    }
    return output;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test agent-core -- --testPathPattern=with-validation.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/agent-core/src/with-validation.ts libs/agent-core/test/with-validation.test.ts
git commit -m "feat(agent-core): add withValidation decorator"
```

---

### Task 3: Create withFallback decorator

**Files:**
- Create: `libs/agent-core/src/with-fallback.ts`
- Test: `libs/agent-core/test/with-fallback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/agent-core/test/with-fallback.test.ts
import { withFallback } from '../src/with-fallback';

describe('withFallback', () => {
  it('returns node output when node succeeds', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'primary' });
    const fallbackFn = jest.fn().mockReturnValue({ value: 'fallback' });
    const wrapped = withFallback(node, fallbackFn);
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'primary' });
    expect(fallbackFn).not.toHaveBeenCalled();
  });

  it('calls fallback function when node throws', async () => {
    const node = jest.fn().mockRejectedValue(new Error('boom'));
    const fallbackFn = jest.fn().mockReturnValue({ value: 'fallback' });
    const wrapped = withFallback(node, fallbackFn);
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'fallback' });
    expect(fallbackFn).toHaveBeenCalledWith({ input: 'test' });
  });

  it('propagates fallback error if fallback also throws', async () => {
    const node = jest.fn().mockRejectedValue(new Error('primary fail'));
    const fallbackFn = jest.fn().mockImplementation(() => { throw new Error('fallback fail'); });
    const wrapped = withFallback(node, fallbackFn);
    await expect(wrapped({ input: 'test' })).rejects.toThrow('fallback fail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test agent-core -- --testPathPattern=with-fallback.test`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```ts
// libs/agent-core/src/with-fallback.ts
import type { AgentNodeFn } from './with-validation';

export function withFallback(
  node: AgentNodeFn,
  fallbackFn: (input: Record<string, unknown>) => Record<string, unknown>,
): AgentNodeFn {
  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    try {
      return await node(state);
    } catch {
      return fallbackFn(state);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test agent-core -- --testPathPattern=with-fallback.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/agent-core/src/with-fallback.ts libs/agent-core/test/with-fallback.test.ts
git commit -m "feat(agent-core): add withFallback decorator"
```

---

### Task 4: Create withRetry decorator

**Files:**
- Create: `libs/agent-core/src/with-retry.ts`
- Test: `libs/agent-core/test/with-retry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/agent-core/test/with-retry.test.ts
import { withRetry } from '../src/with-retry';
import { ValidationError } from '../src/types';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'ok' });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'ok' });
    expect(node).toHaveBeenCalledTimes(1);
  });

  it('retries on ValidationError up to maxAttempts', async () => {
    const node = jest.fn()
      .mockRejectedValueOnce(new ValidationError(['bad1']))
      .mockRejectedValueOnce(new ValidationError(['bad2']))
      .mockResolvedValue({ value: 'ok' });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'ok' });
    expect(node).toHaveBeenCalledTimes(3);
  });

  it('throws after maxAttempts exhausted', async () => {
    const node = jest.fn().mockRejectedValue(new ValidationError(['always bad']));
    const wrapped = withRetry(node, { maxAttempts: 2 });
    await expect(wrapped({ input: 'test' })).rejects.toThrow(ValidationError);
    expect(node).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-ValidationError', async () => {
    const node = jest.fn().mockRejectedValue(new Error('unexpected'));
    const wrapped = withRetry(node, { maxAttempts: 3 });
    await expect(wrapped({ input: 'test' })).rejects.toThrow('unexpected');
    expect(node).toHaveBeenCalledTimes(1);
  });

  it('applies escalation path by modifying state __escalationTier', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn().mockImplementation(async (state: Record<string, unknown>) => {
      calls.push({ ...state });
      throw new ValidationError(['fail']);
    });
    const wrapped = withRetry(node, {
      maxAttempts: 3,
      escalationPath: ['haiku', 'sonnet', 'opus'],
    });
    await expect(wrapped({ input: 'test' })).rejects.toThrow(ValidationError);
    expect(calls[0].__escalationTier).toBeUndefined(); // first attempt: no override
    expect(calls[1].__escalationTier).toBe('sonnet');   // second: escalated
    expect(calls[2].__escalationTier).toBe('opus');      // third: escalated again
  });

  it('reverts to original model when escalation path is shorter than maxAttempts', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn().mockImplementation(async (state: Record<string, unknown>) => {
      calls.push({ ...state });
      throw new ValidationError(['fail']);
    });
    const wrapped = withRetry(node, {
      maxAttempts: 4,
      escalationPath: ['haiku', 'sonnet'],
    });
    await expect(wrapped({ input: 'test' })).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(4);
    expect(calls[0].__escalationTier).toBeUndefined();
    expect(calls[1].__escalationTier).toBe('sonnet');
    expect(calls[2].__escalationTier).toBeUndefined(); // beyond path length
    expect(calls[3].__escalationTier).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test agent-core -- --testPathPattern=with-retry.test`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```ts
// libs/agent-core/src/with-retry.ts
import { ValidationError, type RetryOptions } from './types';
import type { AgentNodeFn } from './with-validation';

export function withRetry(
  node: AgentNodeFn,
  options: RetryOptions,
): AgentNodeFn {
  const { maxAttempts, escalationPath } = options;

  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const escalatedState = { ...state };
        if (escalationPath && attempt > 0 && attempt < escalationPath.length) {
          escalatedState.__escalationTier = escalationPath[attempt];
        }
        return await node(escalatedState);
      } catch (error) {
        if (error instanceof ValidationError) {
          lastError = error;
          continue;
        }
        throw error; // non-validation errors are not retried
      }
    }

    throw lastError!;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test agent-core -- --testPathPattern=with-retry.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/agent-core/src/with-retry.ts libs/agent-core/test/with-retry.test.ts
git commit -m "feat(agent-core): add withRetry decorator with tier escalation"
```

---

### Task 5: Rewrite agent-factory as generic

**Files:**
- Modify: `libs/agent-core/src/agent-factory.ts`
- Rewrite: `libs/agent-core/test/agent-factory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/agent-core/test/agent-factory.test.ts
import { z } from 'zod';
import type { AgentConfig } from '../src/types';

// Mock ChatBedrockConverse before importing
const mockWithStructuredOutput = jest.fn().mockReturnValue({
  invoke: jest.fn().mockResolvedValue({ value: 'test-output' }),
});
const MockChatBedrockConverse = jest.fn().mockImplementation(() => ({
  withStructuredOutput: mockWithStructuredOutput,
}));
jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: MockChatBedrockConverse,
}));

import { createAgentNode } from '../src/agent-factory';

describe('createAgentNode (generic)', () => {
  const testSchema = z.object({ value: z.string() });

  const config: AgentConfig<typeof testSchema> = {
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    maxTokens: 1024,
    temperature: 0.0,
    schema: testSchema,
    promptTemplate: 'You are a test agent. Analyze: {input}',
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates ChatBedrockConverse with correct model params', () => {
    createAgentNode(config);
    expect(MockChatBedrockConverse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic.claude-3-haiku-20240307-v1:0',
        maxTokens: 1024,
        temperature: 0.0,
      }),
    );
  });

  it('calls withStructuredOutput with the provided schema', () => {
    createAgentNode(config);
    expect(mockWithStructuredOutput).toHaveBeenCalledWith(testSchema);
  });

  it('returns a callable node function', async () => {
    const node = createAgentNode(config);
    expect(typeof node).toBe('function');
  });

  it('uses __escalationTier to override model when present in state', async () => {
    const node = createAgentNode(config);
    await node({ input: 'test', __escalationTier: 'opus' });
    // Second call to constructor should use opus model ID
    expect(MockChatBedrockConverse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'anthropic.claude-3-opus-20240229-v1:0',
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test agent-core -- --testPathPattern=agent-factory.test`
Expected: FAIL — import errors (new signature doesn't match)

- [ ] **Step 3: Rewrite agent-factory.ts**

Note: the old `AgentNodeFn` type that lived in this file is now defined in `with-validation.ts`. This rewrite removes it from here and imports from the new location.

```ts
// libs/agent-core/src/agent-factory.ts
import { ChatBedrockConverse } from '@langchain/aws';
import type { AgentConfig } from './types';
import type { AgentNodeFn } from './with-validation';

const MODEL_ID_MAP: Record<string, string> = {
  haiku: 'anthropic.claude-3-haiku-20240307-v1:0',
  sonnet: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  opus: 'anthropic.claude-3-opus-20240229-v1:0',
};

export function createAgentNode<T>(config: AgentConfig<T>): AgentNodeFn {
  const { modelId, maxTokens, temperature, schema, promptTemplate } = config;

  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
    // Allow tier escalation to override the model
    const effectiveModelId = state.__escalationTier
      ? MODEL_ID_MAP[state.__escalationTier as string] ?? modelId
      : modelId;

    const llm = new ChatBedrockConverse({
      model: effectiveModelId,
      maxTokens,
      temperature,
      region: 'us-east-1',
    });

    const structured = llm.withStructuredOutput(schema as any);
    const input = typeof state.input === 'string' ? state.input : JSON.stringify(state);
    const prompt = promptTemplate.replace('{input}', input);
    const result = await structured.invoke(prompt);
    return result as Record<string, unknown>;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test agent-core -- --testPathPattern=agent-factory.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/agent-core/src/agent-factory.ts libs/agent-core/test/agent-factory.test.ts
git commit -m "refactor(agent-core): make agent-factory generic — config-driven, no AgentType"
```

---

### Task 6: Rewrite tier-escalation as fully generic

The current `tier-escalation.ts` uses domain-coupled `AgentType` and `getModelConfig()`. Rewrite to accept a generic `ModelTier` and return an escalation path.

**Files:**
- Rewrite: `libs/agent-core/src/tier-escalation.ts`
- Rewrite: `libs/agent-core/test/tier-escalation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/agent-core/test/tier-escalation.test.ts
import { buildEscalationPath } from '../src/tier-escalation';

describe('buildEscalationPath', () => {
  it('returns haiku → sonnet → opus for haiku start', () => {
    expect(buildEscalationPath('haiku')).toEqual(['haiku', 'sonnet', 'opus']);
  });

  it('returns sonnet → opus for sonnet start', () => {
    expect(buildEscalationPath('sonnet')).toEqual(['sonnet', 'opus']);
  });

  it('returns opus only for opus start', () => {
    expect(buildEscalationPath('opus')).toEqual(['opus']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test agent-core -- --testPathPattern=tier-escalation.test`
Expected: FAIL — old function signature doesn't match

- [ ] **Step 3: Rewrite tier-escalation.ts**

```ts
// libs/agent-core/src/tier-escalation.ts
import type { ModelTier } from './types';

const ESCALATION_ORDER: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];

export function buildEscalationPath(startTier: ModelTier): ModelTier[] {
  const startIndex = ESCALATION_ORDER.indexOf(startTier);
  if (startIndex === -1) return [startTier];
  return [...ESCALATION_ORDER.slice(startIndex)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test agent-core -- --testPathPattern=tier-escalation.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/agent-core/src/tier-escalation.ts libs/agent-core/test/tier-escalation.test.ts
git commit -m "refactor(agent-core): rewrite tier-escalation as generic — ModelTier input, no AgentType"
```

---

### Task 7: Update barrel export (index.ts)

**Files:**
- Modify: `libs/agent-core/src/index.ts`

- [ ] **Step 1: Rewrite index.ts to export only generic modules**

```ts
// libs/agent-core/src/index.ts
export {
  type AgentConfig,
  type ModelTier,
  type RetryOptions,
  type ValidationResult,
  type ValidationRule,
  type WaveDefinition,
  type OrchestratorConfig,
  type ServiceUnavailableResponse,
  type InvokeOptions,
  ValidationError,
} from './types';

export { type AgentNodeFn } from './with-validation';
export { createAgentNode } from './agent-factory';
export { withValidation } from './with-validation';
export { withRetry } from './with-retry';
export { withFallback } from './with-fallback';
export { buildEscalationPath } from './tier-escalation';
// createOrchestrator and invokeOrchestrator will be added in Tasks 8-9
```

- [ ] **Step 2: Run all new agent-core tests**

Run: `npx nx test agent-core -- --testPathPattern="(types|with-validation|with-fallback|with-retry|agent-factory|tier-escalation)"`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add libs/agent-core/src/index.ts
git commit -m "refactor(agent-core): update barrel to export only generic modules"
```

---

## Chunk 2: Orchestrator + Invoker (agent-core)

### Task 8: Create createOrchestrator

**Files:**
- Create: `libs/agent-core/src/create-orchestrator.ts`
- Test: `libs/agent-core/test/create-orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/agent-core/test/create-orchestrator.test.ts
import { z } from 'zod';
import { Annotation } from '@langchain/langgraph';
import type { AgentConfig, OrchestratorConfig, ValidationRule } from '../src/types';

// Mock ChatBedrockConverse to prevent real Bedrock calls
const mockInvoke = jest.fn().mockResolvedValue({ result: 'mock-output' });
jest.mock('@langchain/aws', () => ({
  ChatBedrockConverse: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue({ invoke: mockInvoke }),
  })),
}));

import { createOrchestrator } from '../src/create-orchestrator';

describe('createOrchestrator', () => {
  beforeEach(() => jest.clearAllMocks());
  const testSchema = z.object({ result: z.string() });

  const TestState = Annotation.Root({
    input: Annotation<string | undefined>,
    alpha: Annotation<Record<string, unknown> | undefined>,
    beta: Annotation<Record<string, unknown> | undefined>,
  });

  type TestAgentKey = 'alpha' | 'beta';

  const makeConfig = (overrides?: Partial<AgentConfig<typeof testSchema>>): AgentConfig<typeof testSchema> => ({
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    maxTokens: 1024,
    temperature: 0.0,
    schema: testSchema,
    promptTemplate: 'test: {input}',
    ...overrides,
  });

  it('returns a compiled graph with an invoke method', () => {
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [{ agents: ['alpha', 'beta'] }],
      stateAnnotation: TestState,
      agents: {
        alpha: makeConfig(),
        beta: makeConfig(),
      },
    };
    const graph = createOrchestrator(config);
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
  });

  it('creates sequential edges between waves', () => {
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [
        { agents: ['alpha'] },
        { agents: ['beta'], dependsOn: ['alpha'] },
      ],
      stateAnnotation: TestState,
      agents: {
        alpha: makeConfig(),
        beta: makeConfig(),
      },
    };
    // Should not throw — valid wave dependency
    const graph = createOrchestrator(config);
    expect(graph).toBeDefined();
  });

  it('throws if wave references unknown agent key', () => {
    const config: OrchestratorConfig<TestAgentKey, typeof TestState.State> = {
      waves: [{ agents: ['alpha', 'unknown' as any] }],
      stateAnnotation: TestState,
      agents: { alpha: makeConfig(), beta: makeConfig() },
    };
    expect(() => createOrchestrator(config)).toThrow(/unknown agent/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test agent-core -- --testPathPattern=create-orchestrator.test`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```ts
// libs/agent-core/src/create-orchestrator.ts
import { StateGraph } from '@langchain/langgraph';
import type { OrchestratorConfig } from './types';
import { createAgentNode } from './agent-factory';
import { withValidation, type AgentNodeFn } from './with-validation';
import { withRetry } from './with-retry';
import { withFallback } from './with-fallback';
import { buildEscalationPath } from './tier-escalation';

export interface CompiledGraph {
  invoke(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export function createOrchestrator<K extends string, TState>(
  config: OrchestratorConfig<K, TState>,
): CompiledGraph {
  const { waves, stateAnnotation, agents, fallbacks, validationRules, retryOptions } = config;
  const defaultRetry = retryOptions ?? { maxAttempts: 3 };

  // Validate all wave agent keys exist in agents config
  for (const wave of waves) {
    for (const agentKey of wave.agents) {
      if (!(agentKey in agents)) {
        throw new Error(`Unknown agent key "${agentKey}" in wave definition`);
      }
    }
  }

  // Build decorated node for each agent
  const nodeMap: Record<string, AgentNodeFn> = {};
  for (const [key, agentConfig] of Object.entries(agents) as [K, typeof agents[K]][]) {
    let node: AgentNodeFn = createAgentNode(agentConfig);

    if (validationRules?.[key]) {
      node = withValidation(node, validationRules[key]);
    }

    // Determine escalation path from model ID
    const tier = agentConfig.modelId.includes('haiku') ? 'haiku'
      : agentConfig.modelId.includes('opus') ? 'opus' : 'sonnet';
    const escalationPath = buildEscalationPath(tier as any);

    node = withRetry(node, { ...defaultRetry, escalationPath });

    if (fallbacks?.[key]) {
      node = withFallback(node, fallbacks[key] as any);
    }

    nodeMap[key] = node;
  }

  // Build wave nodes (parallel agents within each wave)
  const waveNodes: Array<{ name: string; fn: AgentNodeFn }> = waves.map((wave, idx) => ({
    name: `wave${idx}`,
    fn: async (state: Record<string, unknown>) => {
      const results = await Promise.all(
        wave.agents.map(async (agentKey) => {
          const output = await nodeMap[agentKey](state);
          return { [agentKey]: output };
        }),
      );
      return Object.assign({}, ...results);
    },
  }));

  // Build the StateGraph
  const graph = new StateGraph(stateAnnotation as any);

  for (const waveNode of waveNodes) {
    graph.addNode(waveNode.name, waveNode.fn);
  }

  // Wire edges: __start__ → wave0 → wave1 → ... → waveN → __end__
  graph.addEdge('__start__' as any, waveNodes[0].name);
  for (let i = 0; i < waveNodes.length - 1; i++) {
    graph.addEdge(waveNodes[i].name, waveNodes[i + 1].name);
  }
  graph.addEdge(waveNodes[waveNodes.length - 1].name, '__end__' as any);

  return graph.compile() as unknown as CompiledGraph;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test agent-core -- --testPathPattern=create-orchestrator.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/agent-core/src/create-orchestrator.ts libs/agent-core/test/create-orchestrator.test.ts
git commit -m "feat(agent-core): add createOrchestrator — config-driven wave graph builder"
```

---

### Task 9: Create invokeOrchestrator

**Files:**
- Create: `libs/agent-core/src/invoke-orchestrator.ts`
- Test: `libs/agent-core/test/invoke-orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/agent-core/test/invoke-orchestrator.test.ts
jest.mock('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
  })),
}));
jest.mock('@aws-lambda-powertools/metrics', () => ({
  Metrics: jest.fn().mockImplementation(() => ({
    addMetric: jest.fn(),
  })),
  MetricUnit: { Count: 'Count', Milliseconds: 'Milliseconds' },
}));

import { invokeOrchestrator } from '../src/invoke-orchestrator';
import type { CompiledGraph } from '../src/create-orchestrator';

describe('invokeOrchestrator', () => {
  const mockGraph: CompiledGraph = {
    invoke: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns graph result on success', async () => {
    (mockGraph.invoke as jest.Mock).mockResolvedValue({ alpha: { result: 'ok' } });
    const result = await invokeOrchestrator(mockGraph, { input: 'test' });
    expect(result).toEqual({ alpha: { result: 'ok' } });
  });

  it('passes input to graph.invoke', async () => {
    (mockGraph.invoke as jest.Mock).mockResolvedValue({});
    await invokeOrchestrator(mockGraph, { input: 'hello' });
    expect(mockGraph.invoke).toHaveBeenCalledWith({ input: 'hello' });
  });

  it('returns ServiceUnavailableResponse on graph failure', async () => {
    (mockGraph.invoke as jest.Mock).mockRejectedValue(new Error('graph exploded'));
    const result = await invokeOrchestrator(mockGraph, { input: 'test' });
    expect(result).toEqual({
      serviceUnavailable: true,
      reason: 'graph exploded',
    });
  });

  it('returns ServiceUnavailableResponse with fallback message for non-Error throws', async () => {
    (mockGraph.invoke as jest.Mock).mockRejectedValue('string error');
    const result = await invokeOrchestrator(mockGraph, { input: 'test' });
    expect(result).toEqual({
      serviceUnavailable: true,
      reason: 'Unknown error',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test agent-core -- --testPathPattern=invoke-orchestrator.test`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```ts
// libs/agent-core/src/invoke-orchestrator.ts
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type { CompiledGraph } from './create-orchestrator';
import type { ServiceUnavailableResponse, InvokeOptions } from './types';

const defaultLogger = new Logger({ serviceName: 'agent-orchestrator' });
const defaultMetrics = new Metrics({ namespace: 'AgentOrchestrator' });

export async function invokeOrchestrator(
  graph: CompiledGraph,
  input: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<Record<string, unknown> | ServiceUnavailableResponse> {
  const logger = (options?.logger as Logger) ?? defaultLogger;
  const metrics = (options?.metrics as Metrics) ?? defaultMetrics;
  const startTime = Date.now();

  logger.info('Orchestrator invocation started', { inputKeys: Object.keys(input) });

  try {
    const result = await graph.invoke(input);
    const duration = Date.now() - startTime;

    logger.info('Orchestrator invocation completed', { duration });
    metrics.addMetric('OrchestratorSuccess', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, duration);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const reason = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Orchestrator invocation failed', { duration, reason });
    metrics.addMetric('OrchestratorFailure', MetricUnit.Count, 1);
    metrics.addMetric('OrchestratorLatency', MetricUnit.Milliseconds, duration);

    return { serviceUnavailable: true, reason };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test agent-core -- --testPathPattern=invoke-orchestrator.test`
Expected: PASS

- [ ] **Step 5: Update barrel export**

Add to `libs/agent-core/src/index.ts`:
```ts
export { createOrchestrator, type CompiledGraph } from './create-orchestrator';
export { invokeOrchestrator } from './invoke-orchestrator';
```

- [ ] **Step 6: Run all agent-core tests**

Run: `npx nx test agent-core`
Expected: ALL PASS (new tests pass, old tests may fail — that's expected, they'll be removed in Chunk 4)

- [ ] **Step 7: Commit**

```bash
git add libs/agent-core/src/invoke-orchestrator.ts libs/agent-core/test/invoke-orchestrator.test.ts libs/agent-core/src/index.ts
git commit -m "feat(agent-core): add invokeOrchestrator with logging, metrics, and fallback"
```

---

## Chunk 3: Move Domain Code to advisory-ctrl

### Task 10: Move schemas to advisory-ctrl

**Files:**
- Create: `services/advisory/advisory-ctrl/src/agents/schemas/*.ts` (7 files)

- [ ] **Step 1: Create the schemas directory and copy files**

Copy each schema file from `libs/agent-core/src/output-schemas/` to `services/advisory/advisory-ctrl/src/agents/schemas/`, updating imports. The schemas are self-contained Zod definitions with no agent-core imports, so the file content stays identical except for the barrel `index.ts` which drops `getOutputSchema()`.

```bash
mkdir -p services/advisory/advisory-ctrl/src/agents/schemas
cp libs/agent-core/src/output-schemas/user-goals.schema.ts services/advisory/advisory-ctrl/src/agents/schemas/
cp libs/agent-core/src/output-schemas/risk-assessment.schema.ts services/advisory/advisory-ctrl/src/agents/schemas/
cp libs/agent-core/src/output-schemas/market-research.schema.ts services/advisory/advisory-ctrl/src/agents/schemas/
cp libs/agent-core/src/output-schemas/portfolio-construction.schema.ts services/advisory/advisory-ctrl/src/agents/schemas/
cp libs/agent-core/src/output-schemas/rebalance-planner.schema.ts services/advisory/advisory-ctrl/src/agents/schemas/
cp libs/agent-core/src/output-schemas/explainability.schema.ts services/advisory/advisory-ctrl/src/agents/schemas/
```

- [ ] **Step 2: Create schemas barrel**

**Important:** Verify the actual export names in each copied schema file. The current agent-core exports are `RebalancePlanSchema` (not `RebalancePlannerSchema`) and `ExplanationSchema` (not `ExplainabilitySchema`). Use the actual names from the source files:

```ts
// services/advisory/advisory-ctrl/src/agents/schemas/index.ts
export { UserGoalsSchema, type GoalInterpretation } from './user-goals.schema';
export { RiskAssessmentSchema, type RiskAssessment } from './risk-assessment.schema';
export { MarketResearchSchema, type MarketResearch } from './market-research.schema';
export { PortfolioConstructionSchema, type PortfolioConstruction } from './portfolio-construction.schema';
export { RebalancePlanSchema, type RebalancePlan } from './rebalance-planner.schema';
export { ExplanationSchema, type Explanation } from './explainability.schema';
```

**Note:** Read each source file to confirm exact export names before writing the barrel. Update `config.ts` (Task 12) to use the same names.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-ctrl/src/agents/schemas/
git commit -m "feat(advisory-ctrl): move agent schemas from agent-core"
```

---

### Task 11: Move prompts, fallbacks, validation, fixtures to advisory-ctrl

**Files:**
- Create: `services/advisory/advisory-ctrl/src/agents/prompts/` (7 files)
- Create: `services/advisory/advisory-ctrl/src/agents/validation.ts`
- Create: `services/advisory/advisory-ctrl/src/agents/fallbacks.ts`
- Create: `services/advisory/advisory-ctrl/src/agents/fixtures/` (2 files)

- [ ] **Step 1: Copy prompt templates**

```bash
mkdir -p services/advisory/advisory-ctrl/src/agents/prompts
cp libs/agent-core/src/prompt-templates/*.txt services/advisory/advisory-ctrl/src/agents/prompts/
```

- [ ] **Step 2: Create prompt loader**

**Important:** CDK's `NodejsFunction` uses esbuild which does NOT bundle `.txt` files. Two options:
- (a) Inline prompts as template literals in `loader.ts` (simplest, no bundling issues)
- (b) Use `readFileSync` + add `commandHooks.afterBundling` in CDK to copy `.txt` files

Option (a) is recommended for POC — prompts are small (~1KB each):

```ts
// services/advisory/advisory-ctrl/src/agents/prompts/loader.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const cache = new Map<string, string>();

/**
 * Loads a prompt template from a .txt file.
 *
 * NOTE: This works in test (Jest) and local execution because .txt files are
 * co-located with the .ts source. For Lambda deployment, the CDK stack must
 * include commandHooks to copy .txt files into the bundle, OR prompts must
 * be inlined as template literals. See service.stack.ts for bundling config.
 */
export function loadPrompt(agentType: string): string {
  const cached = cache.get(agentType);
  if (cached) return cached;
  const filePath = join(__dirname, `${agentType}.txt`);
  const content = readFileSync(filePath, 'utf-8');
  cache.set(agentType, content);
  return content;
}
```

**Also update advisory-ctrl CDK stack** to copy prompt files during bundling. In the Lambda definition's `bundling` options, add:
```ts
commandHooks: {
  afterBundling(inputDir: string, outputDir: string): string[] {
    return [`cp ${inputDir}/src/agents/prompts/*.txt ${outputDir}/`];
  },
  beforeBundling: () => [],
  beforeInstall: () => [],
},
```

Note: `prompt-templates/index.ts` from agent-core is NOT copied — it's replaced by this `loader.ts`.

- [ ] **Step 3: Move validation.ts**

Copy `libs/agent-core/src/output-validation.ts` to `services/advisory/advisory-ctrl/src/agents/validation.ts`. Update imports: replace `import { AgentType } from './model-config'` with local types. Change the export to expose a `VALIDATION_RULES` record keyed by `AgentType` that returns `ValidationRule<T>` objects (from `@nestfolio/agent-core`).

- [ ] **Step 4: Move fallbacks.ts**

Copy `libs/agent-core/src/fallback-agents.ts` to `services/advisory/advisory-ctrl/src/agents/fallbacks.ts`. Update imports: replace agent-core schema imports with local `./schemas` imports. Export a `FALLBACK_MAP` record.

- [ ] **Step 5: Move test fixtures**

```bash
mkdir -p services/advisory/advisory-ctrl/src/agents/fixtures
cp libs/agent-core/src/test-fixtures/golden-contexts.ts services/advisory/advisory-ctrl/src/agents/fixtures/
cp libs/agent-core/src/test-fixtures/golden-outputs.ts services/advisory/advisory-ctrl/src/agents/fixtures/
```

Update imports in golden-outputs.ts to reference local schema types instead of agent-core.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-ctrl/src/agents/
git commit -m "feat(advisory-ctrl): move prompts, validation, fallbacks, fixtures from agent-core"
```

---

### Task 12: Create config.ts and state.ts

**Files:**
- Create: `services/advisory/advisory-ctrl/src/agents/config.ts`
- Create: `services/advisory/advisory-ctrl/src/agents/state.ts`

- [ ] **Step 1: Create state annotation**

```ts
// services/advisory/advisory-ctrl/src/agents/state.ts
import { Annotation } from '@langchain/langgraph';
import type { GoalInterpretation, RiskAssessment, MarketResearch, PortfolioConstruction, RebalancePlan, Explanation } from './schemas';

type AgentOutput = Record<string, unknown> | undefined;
const lastValue = (_prev: AgentOutput, next: AgentOutput): AgentOutput => next;
const lastString = (_prev: string | undefined, next: string | undefined): string | undefined => next;

export const DecisionLifecycleState = Annotation.Root({
  input: Annotation<string | undefined>({ reducer: lastString }),
  'user-goals': Annotation<AgentOutput>({ reducer: lastValue }),
  'risk-assessment': Annotation<AgentOutput>({ reducer: lastValue }),
  'market-research': Annotation<AgentOutput>({ reducer: lastValue }),
  'portfolio-construction': Annotation<AgentOutput>({ reducer: lastValue }),
  'rebalance-planner': Annotation<AgentOutput>({ reducer: lastValue }),
  explainability: Annotation<AgentOutput>({ reducer: lastValue }),
});

export type DecisionLifecycleStateType = typeof DecisionLifecycleState.State;
```

- [ ] **Step 2: Create config with agent configs and wave definition**

```ts
// services/advisory/advisory-ctrl/src/agents/config.ts
import type { AgentConfig, WaveDefinition } from '@nestfolio/agent-core';
import {
  UserGoalsSchema, RiskAssessmentSchema, MarketResearchSchema,
  PortfolioConstructionSchema, RebalancePlannerSchema, ExplainabilitySchema,
} from './schemas';
import { loadPrompt } from './prompts/loader';

export type AgentType =
  | 'user-goals'
  | 'risk-assessment'
  | 'market-research'
  | 'portfolio-construction'
  | 'rebalance-planner'
  | 'explainability';

export const AGENT_TYPES: readonly AgentType[] = [
  'user-goals', 'risk-assessment', 'market-research',
  'portfolio-construction', 'rebalance-planner', 'explainability',
] as const;

export const AGENT_CONFIGS: Record<AgentType, AgentConfig<any>> = {
  'user-goals':             { modelId: 'anthropic.claude-3-haiku-20240307-v1:0',     maxTokens: 2048, temperature: 0.0, schema: UserGoalsSchema,            promptTemplate: loadPrompt('user-goals') },
  'risk-assessment':        { modelId: 'anthropic.claude-3-opus-20240229-v1:0',       maxTokens: 4096, temperature: 0.1, schema: RiskAssessmentSchema,        promptTemplate: loadPrompt('risk-assessment') },
  'market-research':        { modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',   maxTokens: 4096, temperature: 0.2, schema: MarketResearchSchema,        promptTemplate: loadPrompt('market-research') },
  'portfolio-construction': { modelId: 'anthropic.claude-3-opus-20240229-v1:0',       maxTokens: 4096, temperature: 0.1, schema: PortfolioConstructionSchema, promptTemplate: loadPrompt('portfolio-construction') },
  'rebalance-planner':      { modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',   maxTokens: 4096, temperature: 0.1, schema: RebalancePlannerSchema,      promptTemplate: loadPrompt('rebalance-planner') },
  explainability:           { modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',   maxTokens: 8192, temperature: 0.3, schema: ExplainabilitySchema,        promptTemplate: loadPrompt('explainability') },
};

export const DECISION_LIFECYCLE_WAVES: WaveDefinition<AgentType> = [
  { agents: ['user-goals', 'risk-assessment', 'market-research'] },
  { agents: ['portfolio-construction', 'rebalance-planner'], dependsOn: ['user-goals', 'risk-assessment', 'market-research'] },
  { agents: ['explainability'], dependsOn: ['portfolio-construction', 'rebalance-planner'] },
];
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-ctrl/src/agents/config.ts services/advisory/advisory-ctrl/src/agents/state.ts
git commit -m "feat(advisory-ctrl): add agent config, state annotation, and wave definition"
```

---

### Task 13: Update DecisionLifecycleService to use new wiring

**Files:**
- Modify: `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts`

- [ ] **Step 1: Rewrite imports and runAgentPipeline**

Replace ALL current imports from `@nestfolio/agent-core`. The following type replacements apply throughout the file:
- `DecisionStateType` → `DecisionLifecycleStateType` (from `../agents/state`)
- `AgentNodeMap` → removed (no longer needed — orchestrator builds nodes internally)
- `AGENT_TYPES` → import from `../agents/config` (same name, local source)
- `createAgentNode`, `invokeGraph`, `createFallbackNodeMap` → removed (replaced by `createOrchestrator`, `invokeOrchestrator`)
- `ServiceUnavailableResponse` → still from `@nestfolio/agent-core`

The `extractTrades` and `composeExplanation` methods use `DecisionStateType` — replace with `DecisionLifecycleStateType`.

Replace the current imports with:
```ts
import { createOrchestrator, invokeOrchestrator, type ServiceUnavailableResponse } from '@nestfolio/agent-core';
import { AGENT_CONFIGS, DECISION_LIFECYCLE_WAVES, AGENT_TYPES, type AgentType } from '../agents/config';
import { DecisionLifecycleState, type DecisionLifecycleStateType } from '../agents/state';
import { FALLBACK_MAP } from '../agents/fallbacks';
import { VALIDATION_RULES } from '../agents/validation';
```

Replace `runAgentPipeline` method:
```ts
private readonly graph = createOrchestrator({
  waves: DECISION_LIFECYCLE_WAVES,
  stateAnnotation: DecisionLifecycleState,
  agents: AGENT_CONFIGS,
  fallbacks: FALLBACK_MAP,
  validationRules: VALIDATION_RULES,
});

private async runAgentPipeline(context: DecisionContext): Promise<DecisionLifecycleStateType> {
  const result = await invokeOrchestrator(this.graph, { input: JSON.stringify(context) });

  if ('serviceUnavailable' in result && (result as ServiceUnavailableResponse).serviceUnavailable) {
    const unavailable = result as ServiceUnavailableResponse;
    throw new Error(`Agent pipeline unavailable: ${unavailable.reason}`);
  }

  return result as DecisionLifecycleStateType;
}
```

- [ ] **Step 2: Run advisory-ctrl tests**

Run: `npx nx test advisory-ctrl`
Expected: PASS (existing tests should still work with new wiring)

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts
git commit -m "refactor(advisory-ctrl): wire DecisionLifecycleService to new generic agent-core"
```

---

## Chunk 4: Cleanup + Domain Tests

### Task 14: Delete domain code from agent-core

**Files:**
- Delete: `libs/agent-core/src/model-config.ts`
- Delete: `libs/agent-core/src/output-validation.ts`
- Delete: `libs/agent-core/src/fallback-agents.ts`
- Delete: `libs/agent-core/src/graph-orchestrator.ts`
- Delete: `libs/agent-core/src/agent-invoker.ts`
- Delete: `libs/agent-core/src/invoke-with-retry.ts`
- Delete: `libs/agent-core/src/output-schemas/` (entire directory)
- Delete: `libs/agent-core/src/prompt-templates/` (entire directory)
- Delete: `libs/agent-core/src/test-fixtures/` (entire directory)
- Delete: `libs/agent-core/test/model-config.test.ts`
- Delete: `libs/agent-core/test/output-schemas.test.ts`
- Delete: `libs/agent-core/test/output-validation.test.ts`
- Delete: `libs/agent-core/test/fallback-agents.test.ts`
- Delete: `libs/agent-core/test/golden-fixtures.test.ts`
- Delete: `libs/agent-core/test/graph-orchestrator.test.ts`
- Delete: `libs/agent-core/test/agent-invoker.test.ts`
- Delete: `libs/agent-core/test/invoke-with-retry.test.ts`

- [ ] **Step 1: Delete all domain source files**

```bash
rm libs/agent-core/src/model-config.ts
rm libs/agent-core/src/output-validation.ts
rm libs/agent-core/src/fallback-agents.ts
rm libs/agent-core/src/graph-orchestrator.ts
rm libs/agent-core/src/agent-invoker.ts
rm libs/agent-core/src/invoke-with-retry.ts
rm -rf libs/agent-core/src/output-schemas
rm -rf libs/agent-core/src/prompt-templates
rm -rf libs/agent-core/src/test-fixtures
```

- [ ] **Step 2: Delete old test files**

```bash
rm libs/agent-core/test/model-config.test.ts
rm libs/agent-core/test/output-schemas.test.ts
rm libs/agent-core/test/output-validation.test.ts
rm libs/agent-core/test/fallback-agents.test.ts
rm libs/agent-core/test/golden-fixtures.test.ts
rm libs/agent-core/test/graph-orchestrator.test.ts
rm libs/agent-core/test/agent-invoker.test.ts
rm libs/agent-core/test/invoke-with-retry.test.ts
```

- [ ] **Step 3: Run agent-core tests (only new generic tests should remain)**

Run: `npx nx test agent-core`
Expected: PASS — 7 test suites (types, agent-factory, with-validation, with-retry, with-fallback, tier-escalation, create-orchestrator, invoke-orchestrator)

- [ ] **Step 4: Commit**

```bash
git add -A libs/agent-core/
git commit -m "refactor(agent-core): remove all domain-specific code — now fully generic"
```

---

### Task 15: Delete decision-lifecycle-agent Nx project

**Files:**
- Delete: `services/advisory/advisory-ctrl/agents/decision-lifecycle/` (entire directory)
- Modify: workspace config if needed (check if project is registered)

- [ ] **Step 1: Delete the directory**

```bash
rm -rf services/advisory/advisory-ctrl/agents/decision-lifecycle
```

- [ ] **Step 2: Check if project is registered anywhere**

```bash
grep -r "decision-lifecycle-agent" . --include="*.json" -l
grep -r "decision-lifecycle" tsconfig.base.json
```

Remove any references found in `tsconfig.base.json` paths (e.g., `@nestfolio/decision-lifecycle-agent`), workspace config, or any project reference files. Nx auto-discovers projects by `project.json` — deleting the directory should deregister it, but verify with `npx nx show projects | grep decision`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: delete decision-lifecycle-agent project — absorbed into advisory-ctrl/src/agents"
```

---

### Task 16: Write domain tests for advisory-ctrl

**Files:**
- Create: `services/advisory/advisory-ctrl/test/agents/schemas.test.ts`
- Create: `services/advisory/advisory-ctrl/test/agents/validation.test.ts`
- Create: `services/advisory/advisory-ctrl/test/agents/fallbacks.test.ts`
- Create: `services/advisory/advisory-ctrl/test/agents/config.test.ts`
- Create: `services/advisory/advisory-ctrl/test/agents/golden-fixtures.test.ts`

- [ ] **Step 1: Create schemas test**

Port the content from the deleted `libs/agent-core/test/output-schemas.test.ts`, applying these import transformations:

| Old import | New import |
|---|---|
| `from '@nestfolio/agent-core'` | `from '../../src/agents/schemas'` |
| `getOutputSchema(type)` | Direct schema import (e.g., `UserGoalsSchema`) — `getOutputSchema` no longer exists |
| `GoalInterpretation`, `RiskAssessment`, etc. | Same names, from `'../../src/agents/schemas'` |

All test cases stay the same — they test Zod schema validation for all 6 agent output types.

- [ ] **Step 2: Create validation test**

Port from deleted `libs/agent-core/test/output-validation.test.ts`. Import transformations:

| Old import | New import |
|---|---|
| `AGENT_VALIDATORS` / validator functions from `@nestfolio/agent-core` | `VALIDATION_RULES` from `'../../src/agents/validation'` |
| `AgentType` from `@nestfolio/agent-core` | `AgentType` from `'../../src/agents/config'` |

- [ ] **Step 3: Create fallbacks test**

Port from deleted `libs/agent-core/test/fallback-agents.test.ts`. Import transformations:

| Old import | New import |
|---|---|
| `createFallbackNode`, `createFallbackNodeMap` from `@nestfolio/agent-core` | `FALLBACK_MAP` from `'../../src/agents/fallbacks'` |
| Schema types from `@nestfolio/agent-core` | From `'../../src/agents/schemas'` |

- [ ] **Step 4: Create config test**

```ts
// services/advisory/advisory-ctrl/test/agents/config.test.ts
import { AGENT_CONFIGS, AGENT_TYPES, DECISION_LIFECYCLE_WAVES } from '../../src/agents/config';

describe('agent config', () => {
  it('has configs for all 6 agent types', () => {
    expect(Object.keys(AGENT_CONFIGS)).toHaveLength(6);
    for (const type of AGENT_TYPES) {
      expect(AGENT_CONFIGS[type]).toBeDefined();
      expect(AGENT_CONFIGS[type].modelId).toBeTruthy();
      expect(AGENT_CONFIGS[type].schema).toBeDefined();
      expect(AGENT_CONFIGS[type].promptTemplate).toBeTruthy();
    }
  });

  it('has 3 waves with correct dependencies', () => {
    expect(DECISION_LIFECYCLE_WAVES).toHaveLength(3);
    expect(DECISION_LIFECYCLE_WAVES[0].agents).toEqual(['user-goals', 'risk-assessment', 'market-research']);
    expect(DECISION_LIFECYCLE_WAVES[0].dependsOn).toBeUndefined();
    expect(DECISION_LIFECYCLE_WAVES[1].dependsOn).toEqual(['user-goals', 'risk-assessment', 'market-research']);
    expect(DECISION_LIFECYCLE_WAVES[2].dependsOn).toEqual(['portfolio-construction', 'rebalance-planner']);
  });
});
```

- [ ] **Step 5: Create golden fixtures test**

Port from deleted `libs/agent-core/test/golden-fixtures.test.ts`, updating imports.

- [ ] **Step 6: Run all advisory-ctrl tests**

Run: `npx nx test advisory-ctrl`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add services/advisory/advisory-ctrl/test/agents/
git commit -m "test(advisory-ctrl): add domain agent tests — schemas, validation, fallbacks, config, fixtures"
```

---

### Task 17: Run full workspace test suite

- [ ] **Step 1: Run all projects**

Run: `npx nx run-many -t test --all`
Expected: ALL projects pass. If any project imported domain types from `@nestfolio/agent-core` that no longer exist, fix those imports.

- [ ] **Step 2: Run lint**

Run: `npx nx run-many -t lint --all`
Expected: PASS

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve remaining import references after agent-core split"
```
