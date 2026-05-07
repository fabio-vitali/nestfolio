# Portfolio-engine mode-aware validation rule + retry-feedback loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the e2e gate `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` for CONSERVATIVE + AGGRESSIVE modes by extending the agent-orchestrator validation chain to (a) make `ValidationRule` context-aware and (b) feed validation diffs back into the next prompt attempt.

**Architecture:** Extend `ValidationRule.validate()` with an optional `ValidationContext` so rules can read invocation state (notably `operatingMode`); extend `ValidationResult` + `ValidationError` with an optional `feedback` string; `withRetry` writes `__retryFeedback` to state on `ValidationError`; `agent-factory` appends a "PRIOR ATTEMPT FEEDBACK" section to the prompt when present. Service-side, `portfolioValidationRule` becomes mode-aware (per-mode count band, equity weight band, largest-EQUITY-position cap) and emits a structured corrective `feedback` string. No code changes to the 3 sibling advisory services.

**Tech Stack:** TypeScript, Jest, LangGraph (`@langchain/langgraph`), `@langchain/aws` ChatBedrockConverse, Nx (`pnpm nx run …`), AWS Bedrock AgentCore Runtime.

**Spec:** `docs/superpowers/specs/2026-05-07-portfolio-engine-mode-aware-validation-design.md`.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `libs/agent-orchestrator/src/types.ts` | Modify | Add `ValidationContext`; extend `ValidationResult` with `feedback?`; extend `ValidationRule.validate` signature; extend `ValidationError` constructor with `{ feedback }` opts |
| `libs/agent-orchestrator/src/with-validation.ts` | Modify | Read `state.__retryAttempt`, build `ctx`, propagate `result.feedback` into thrown `ValidationError` |
| `libs/agent-orchestrator/src/with-retry.ts` | Modify | Write `state.__retryAttempt` on every attempt; on `ValidationError`, write `state.__retryFeedback` for the next iteration |
| `libs/agent-orchestrator/src/agent-factory.ts` | Modify | Inside `createAgentNode`, append "PRIOR ATTEMPT FEEDBACK …" section to prompt when `state.__retryFeedback` present |
| `libs/agent-orchestrator/src/index.ts` | Modify | Re-export `ValidationContext` |
| `libs/agent-orchestrator/test/types.test.ts` | Modify | Cover new `ValidationError` constructor overload + `ValidationResult.feedback` |
| `libs/agent-orchestrator/test/with-validation.test.ts` | Modify | Cover ctx threading + `result.feedback` → thrown error propagation |
| `libs/agent-orchestrator/test/with-retry.test.ts` | Modify | Cover `__retryAttempt` + `__retryFeedback` injection on retry |
| `libs/agent-orchestrator/test/agent-factory.test.ts` | Modify | Cover prompt augmentation when `state.__retryFeedback` present |
| `services/advisory/portfolio-engine-ctrl/src/agents/state.ts` | Modify | Add `operatingMode` channel (string \| undefined) to `PortfolioEngineState` |
| `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts` | Modify | Pass `operatingMode` alongside `input` in the `invokeOrchestrator` payload |
| `services/advisory/portfolio-engine-ctrl/src/agents/validation.ts` | Modify | Replace `portfolioValidationRule` body with mode-aware logic + `formatCorrectiveFeedback` helper. `rebalanceValidationRule` unchanged |
| `services/advisory/portfolio-engine-ctrl/test/unit/agents/validation.test.ts` | Modify | Replace existing 4 cases with mode × violation table; remove obsolete "50% / fewer-than-2" assertions |
| `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts` | Modify | Add a case asserting `operatingMode` is in the `invokeOrchestrator` payload |

---

## Task 1: Extend `ValidationContext`, `ValidationResult.feedback`, `ValidationError`

**Files:**
- Modify: `libs/agent-orchestrator/src/types.ts:21-37`
- Modify: `libs/agent-orchestrator/test/types.test.ts`

- [ ] **Step 1: Read existing `types.test.ts` to see current coverage, then add the failing tests**

Open `libs/agent-orchestrator/test/types.test.ts` and append the following block at the end of the file (inside the existing top-level scope; if the file has no top-level `describe`, add one):

```ts
import { ValidationError } from '../src/types';
import type { ValidationContext, ValidationResult, ValidationRule } from '../src/types';

describe('ValidationError feedback overload', () => {
  it('constructs with errors only (backward-compatible)', () => {
    const e = new ValidationError(['oops']);
    expect(e.errors).toEqual(['oops']);
    expect(e.feedback).toBeUndefined();
    expect(e.message).toContain('oops');
  });

  it('constructs with errors + opts.feedback', () => {
    const e = new ValidationError(['oops'], { feedback: 'try again differently' });
    expect(e.errors).toEqual(['oops']);
    expect(e.feedback).toBe('try again differently');
  });
});

describe('ValidationContext + ValidationRule signature', () => {
  it('ValidationRule accepts a single-arg validate (backward-compatible)', () => {
    const rule: ValidationRule<{ v: string }> = {
      validate: (output) => ({ valid: output.v.length > 0, errors: [] }),
    };
    expect(rule.validate({ v: 'x' }).valid).toBe(true);
  });

  it('ValidationRule accepts a (output, ctx) validate that reads ctx.state + ctx.attempt', () => {
    const rule: ValidationRule<{ v: string }> = {
      validate: (output, ctx) => {
        const mode = ctx?.state['operatingMode'] as string | undefined;
        const attempt = ctx?.attempt ?? -1;
        return {
          valid: output.v === mode,
          errors: output.v === mode ? [] : [`wrong mode at attempt ${attempt}`],
          feedback: output.v === mode ? undefined : `expected ${mode}, got ${output.v}`,
        };
      },
    };
    const ctx: ValidationContext = { state: { operatingMode: 'CONSERVATIVE' }, attempt: 1 };
    const result: ValidationResult = rule.validate({ v: 'BALANCED' }, ctx);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('attempt 1');
    expect(result.feedback).toBe('expected CONSERVATIVE, got BALANCED');
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```
pnpm nx run agent-orchestrator:test -- --testPathPatterns=types.test.ts
```
Expected: TypeScript errors / `feedback` does not exist on `ValidationResult`, and `ValidationError` constructor does not accept a second arg. Tests fail to compile.

- [ ] **Step 3: Update `libs/agent-orchestrator/src/types.ts` to extend the three shapes**

Replace lines 21-37 (the `ValidationResult`, `ValidationRule`, `ValidationError` block) with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```
pnpm nx run agent-orchestrator:test -- --testPathPatterns=types.test.ts
```
Expected: PASS for the new `ValidationError feedback overload` and `ValidationContext + ValidationRule signature` describes; existing tests in this file still PASS.

- [ ] **Step 5: Run the full agent-orchestrator suite to confirm no regression**

```
pnpm nx run agent-orchestrator:test
```
Expected: All tests PASS (existing `with-validation.test.ts` and `with-retry.test.ts` still green because the changes are additive — `ctx` is optional, `feedback` is optional, `opts` is optional).

- [ ] **Step 6: Commit**

```
git add libs/agent-orchestrator/src/types.ts libs/agent-orchestrator/test/types.test.ts
git commit -m "feat(agent-orchestrator): add ValidationContext + optional feedback on ValidationResult/Error

Extends ValidationRule.validate signature with optional ValidationContext
({ state, attempt }) and ValidationResult/ValidationError with optional
feedback string. Backward-compatible: existing single-arg rules and
single-arg ValidationError constructions still type-check.

Spec: docs/superpowers/specs/2026-05-07-portfolio-engine-mode-aware-validation-design.md"
```

---

## Task 2: Thread `ctx` + `feedback` through `withValidation`

**Files:**
- Modify: `libs/agent-orchestrator/src/with-validation.ts`
- Modify: `libs/agent-orchestrator/test/with-validation.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `libs/agent-orchestrator/test/with-validation.test.ts` (inside the existing `describe('withValidation', …)` scope):

```ts
  it('passes ctx={state, attempt} to the rule (attempt defaults to 0)', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'hello' });
    const validate = jest.fn().mockReturnValue({ valid: true, errors: [] });
    const rule = { validate };
    const validated = withValidation(node, rule);
    await validated({ input: 'test', operatingMode: 'CONSERVATIVE' });
    expect(validate).toHaveBeenCalledWith(
      { value: 'hello' },
      { state: { input: 'test', operatingMode: 'CONSERVATIVE' }, attempt: 0 },
    );
  });

  it('passes ctx.attempt from state.__retryAttempt when set', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'hello' });
    const validate = jest.fn().mockReturnValue({ valid: true, errors: [] });
    const rule = { validate };
    const validated = withValidation(node, rule);
    await validated({ input: 'test', __retryAttempt: 2 });
    expect(validate).toHaveBeenCalledWith(
      { value: 'hello' },
      { state: { input: 'test', __retryAttempt: 2 }, attempt: 2 },
    );
  });

  it('propagates result.feedback into the thrown ValidationError', async () => {
    const node = jest.fn().mockResolvedValue({ value: '' });
    const rule = {
      validate: () => ({
        valid: false,
        errors: ['empty value'],
        feedback: 'corrective: provide a non-empty value',
      }),
    };
    const validated = withValidation(node, rule);
    await expect(validated({ input: 'test' })).rejects.toMatchObject({
      name: 'ValidationError',
      errors: ['empty value'],
      feedback: 'corrective: provide a non-empty value',
    });
  });

  it('does not require result.feedback (backward-compatible)', async () => {
    const node = jest.fn().mockResolvedValue({ value: '' });
    const rule = {
      validate: () => ({ valid: false, errors: ['empty value'] }),
    };
    const validated = withValidation(node, rule);
    await expect(validated({ input: 'test' })).rejects.toMatchObject({
      name: 'ValidationError',
      errors: ['empty value'],
      feedback: undefined,
    });
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```
pnpm nx run agent-orchestrator:test -- --testPathPatterns=with-validation.test.ts
```
Expected: 4 new cases FAIL (current `withValidation` calls `rule.validate(output)` with no ctx arg; throws `new ValidationError(result.errors)` with no feedback).

- [ ] **Step 3: Replace `libs/agent-orchestrator/src/with-validation.ts`**

```ts
import type { RunnableConfig } from '@langchain/core/runnables';
import { ValidationError, type ValidationContext, type ValidationRule } from './types';

export type AgentNodeFn = (
  state: Record<string, unknown>,
  config?: RunnableConfig,
) => Promise<Record<string, unknown>>;

export function withValidation<T>(
  node: AgentNodeFn,
  rule: ValidationRule<T>,
): AgentNodeFn {
  return async (state, config) => {
    const output = await node(state, config);
    const attempt = (state['__retryAttempt'] as number | undefined) ?? 0;
    const ctx: ValidationContext = { state, attempt };
    const result = rule.validate(output as unknown as T, ctx);
    if (!result.valid) {
      throw new ValidationError(result.errors, { feedback: result.feedback });
    }
    return output;
  };
}
```

- [ ] **Step 4: Run the tests**

```
pnpm nx run agent-orchestrator:test -- --testPathPatterns=with-validation.test.ts
```
Expected: All cases PASS (3 existing + 4 new = 7 cases).

- [ ] **Step 5: Commit**

```
git add libs/agent-orchestrator/src/with-validation.ts libs/agent-orchestrator/test/with-validation.test.ts
git commit -m "feat(agent-orchestrator): thread ValidationContext + feedback through withValidation

Builds ValidationContext from state (reading __retryAttempt for the
attempt field) and propagates ValidationResult.feedback into the thrown
ValidationError so withRetry can pick it up downstream."
```

---

## Task 3: Inject `__retryAttempt` + `__retryFeedback` from `withRetry`

**Files:**
- Modify: `libs/agent-orchestrator/src/with-retry.ts`
- Modify: `libs/agent-orchestrator/test/with-retry.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `libs/agent-orchestrator/test/with-retry.test.ts` (inside the existing `describe('withRetry', …)` scope):

```ts
  it('writes __retryAttempt to state on every attempt (0, 1, 2, …)', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn().mockImplementation(async (state: Record<string, unknown>) => {
      calls.push({ ...state });
      throw new ValidationError(['fail']);
    });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    await expect(wrapped({ input: 'test' })).rejects.toThrow(ValidationError);
    expect(calls[0].__retryAttempt).toBe(0);
    expect(calls[1].__retryAttempt).toBe(1);
    expect(calls[2].__retryAttempt).toBe(2);
  });

  it('writes __retryFeedback from error.feedback after a failed attempt', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn()
      .mockImplementationOnce(async (state: Record<string, unknown>) => {
        calls.push({ ...state });
        throw new ValidationError(['bad'], { feedback: 'corrective text' });
      })
      .mockImplementationOnce(async (state: Record<string, unknown>) => {
        calls.push({ ...state });
        return { value: 'recovered' };
      });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'recovered' });
    expect(calls[0].__retryFeedback).toBeUndefined();
    expect(calls[1].__retryFeedback).toBe('corrective text');
  });

  it('falls back to errors.join when error.feedback is absent', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn()
      .mockImplementationOnce(async (state: Record<string, unknown>) => {
        calls.push({ ...state });
        throw new ValidationError(['err1', 'err2']);
      })
      .mockImplementationOnce(async (state: Record<string, unknown>) => {
        calls.push({ ...state });
        return { value: 'ok' };
      });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    await wrapped({ input: 'test' });
    expect(calls[1].__retryFeedback).toBe('err1\nerr2');
  });

  it('still does not retry on non-ValidationError', async () => {
    const node = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withRetry(node, { maxAttempts: 3 });
    await expect(wrapped({ input: 'test' })).rejects.toThrow('boom');
    expect(node).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```
pnpm nx run agent-orchestrator:test -- --testPathPatterns=with-retry.test.ts
```
Expected: First 3 new cases FAIL (current `withRetry` writes neither `__retryAttempt` nor `__retryFeedback`). The 4th case should already PASS (existing behavior preserved).

- [ ] **Step 3: Replace `libs/agent-orchestrator/src/with-retry.ts`**

```ts
import { ValidationError, type RetryOptions } from './types';
import type { AgentNodeFn } from './with-validation';

export function withRetry(
  node: AgentNodeFn,
  options: RetryOptions,
): AgentNodeFn {
  const { maxAttempts, escalationPath } = options;

  return async (state, config) => {
    let lastError: Error | undefined;
    let workingState: Record<string, unknown> = state;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const enriched: Record<string, unknown> = { ...workingState, __retryAttempt: attempt };
        if (escalationPath && attempt > 0 && attempt < escalationPath.length) {
          enriched['__escalationTier'] = escalationPath[attempt];
        }
        return await node(enriched, config);
      } catch (error) {
        if (error instanceof ValidationError) {
          lastError = error;
          workingState = {
            ...workingState,
            __retryFeedback: error.feedback ?? error.errors.join('\n'),
          };
          continue;
        }
        throw error;
      }
    }

    throw lastError!;
  };
}
```

- [ ] **Step 4: Run the tests**

```
pnpm nx run agent-orchestrator:test -- --testPathPatterns=with-retry.test.ts
```
Expected: All cases PASS (existing 6 + new 4 = 10 cases).

- [ ] **Step 5: Commit**

```
git add libs/agent-orchestrator/src/with-retry.ts libs/agent-orchestrator/test/with-retry.test.ts
git commit -m "feat(agent-orchestrator): inject __retryAttempt + __retryFeedback into retried state

withRetry now writes __retryAttempt on every attempt (0, 1, 2…) and, on
caught ValidationError, persists error.feedback (or errors.join fallback)
to state.__retryFeedback so the next attempt's prompt can include the
corrective text. Tier-escalation behavior unchanged."
```

---

## Task 4: Consume `__retryFeedback` in `agent-factory`

**Files:**
- Modify: `libs/agent-orchestrator/src/agent-factory.ts:96-103`
- Modify: `libs/agent-orchestrator/test/agent-factory.test.ts`

- [ ] **Step 1: Add the failing tests**

Append a new `describe` block to `libs/agent-orchestrator/test/agent-factory.test.ts`:

```ts
describe('createAgentNode — __retryFeedback prompt augmentation', () => {
  const testSchema = z.object({ value: z.string() });
  const config: AgentConfig<typeof testSchema> = {
    modelId: 'us.anthropic.claude-sonnet-4-6',
    maxTokens: 1024,
    temperature: 0.0,
    schema: testSchema,
    promptTemplate: 'Analyze: {input}',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env['AGENT_MODEL_OVERRIDE'];
  });

  it('appends PRIOR ATTEMPT FEEDBACK section when state.__retryFeedback is set', async () => {
    mockInvoke.mockResolvedValueOnce({ value: 'recovered' });
    const node = createAgentNode(config);
    await node({ input: 'something', __retryFeedback: 'previous output had X, must be Y' });
    const promptArg = mockInvoke.mock.calls[0][0] as string;
    expect(promptArg).toContain('Analyze: something');
    expect(promptArg).toContain('PRIOR ATTEMPT FEEDBACK — your previous output was rejected. Correct it now:');
    expect(promptArg).toContain('previous output had X, must be Y');
  });

  it('emits the bare prompt when state.__retryFeedback is absent', async () => {
    mockInvoke.mockResolvedValueOnce({ value: 'ok' });
    const node = createAgentNode(config);
    await node({ input: 'something' });
    const promptArg = mockInvoke.mock.calls[0][0] as string;
    expect(promptArg).toBe('Analyze: something');
    expect(promptArg).not.toContain('PRIOR ATTEMPT FEEDBACK');
  });

  it('feedback-augmented prompt is also used by the tool_choice-pinned retry inside agent-factory', async () => {
    mockInvoke.mockResolvedValueOnce({}); // degraded → triggers in-call retry
    mockInvoke.mockResolvedValueOnce({ value: 'recovered' });
    const node = createAgentNode(config);
    await node({ input: 'something', __retryFeedback: 'corrective hint' });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    const firstPrompt = mockInvoke.mock.calls[0][0] as string;
    const secondPrompt = mockInvoke.mock.calls[1][0] as string;
    expect(firstPrompt).toContain('PRIOR ATTEMPT FEEDBACK');
    expect(firstPrompt).toContain('corrective hint');
    // Second prompt carries BOTH the feedback and the existing REINFORCE_SUFFIX
    expect(secondPrompt).toContain('PRIOR ATTEMPT FEEDBACK');
    expect(secondPrompt).toContain('corrective hint');
    expect(secondPrompt).toContain('Re-emit the structured-output tool call with EVERY required field populated');
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```
pnpm nx run agent-orchestrator:test -- --testPathPatterns=agent-factory.test.ts
```
Expected: First and third new cases FAIL (`PRIOR ATTEMPT FEEDBACK` substring missing). Second case PASSES (existing behavior).

- [ ] **Step 3: Modify `libs/agent-orchestrator/src/agent-factory.ts` lines 96-103**

Replace these lines:

```ts
    const structured = llm.withStructuredOutput(schema as any);
    const input = typeof state.input === 'string' ? state.input : JSON.stringify(state);
    const prompt = promptTemplate.replace('{input}', input);
```

with:

```ts
    const structured = llm.withStructuredOutput(schema as any);
    const input = typeof state.input === 'string' ? state.input : JSON.stringify(state);
    const basePrompt = promptTemplate.replace('{input}', input);
    const feedback = state['__retryFeedback'] as string | undefined;
    const prompt = feedback
      ? `${basePrompt}\n\nPRIOR ATTEMPT FEEDBACK — your previous output was rejected. Correct it now:\n${feedback}`
      : basePrompt;
```

The pinned-retry block at lines 109-117 already references the `prompt` variable, so it picks up the augmented version automatically with no further change.

- [ ] **Step 4: Run the tests**

```
pnpm nx run agent-orchestrator:test -- --testPathPatterns=agent-factory.test.ts
```
Expected: All cases PASS — including the existing γ.4 retry cases (they don't set `__retryFeedback` so the bare prompt is unchanged) AND the 3 new cases.

- [ ] **Step 5: Commit**

```
git add libs/agent-orchestrator/src/agent-factory.ts libs/agent-orchestrator/test/agent-factory.test.ts
git commit -m "feat(agent-orchestrator): consume __retryFeedback in createAgentNode prompt

When state carries __retryFeedback (set by withRetry on a prior
ValidationError), createAgentNode appends a 'PRIOR ATTEMPT FEEDBACK'
section to the prompt. The existing tool_choice-pinned in-call retry
picks up the augmented prompt automatically since both invocations
build from the same prompt variable."
```

---

## Task 5: Re-export `ValidationContext` from `index.ts`

**Files:**
- Modify: `libs/agent-orchestrator/src/index.ts`

- [ ] **Step 1: Read the current index.ts and locate the existing types re-export line**

```
cat libs/agent-orchestrator/src/index.ts | grep -n 'ValidationRule\|ValidationResult\|ValidationError'
```

Expected: at least one line re-exporting `ValidationRule`, `ValidationResult`, `ValidationError` from `./types`.

- [ ] **Step 2: Add `ValidationContext` to the existing types re-export**

If the file has a line like:
```ts
export type { ValidationRule, ValidationResult, ... } from './types';
```
add `ValidationContext` to the brace list. If `ValidationRule` etc. are exported via a `export * from './types'` line, no change is needed (just verify).

If neither is true, add:
```ts
export type { ValidationContext } from './types';
```

- [ ] **Step 3: Verify by importing from a service-side file (typecheck only)**

```
pnpm nx run portfolio-engine-ctrl:test -- --testPathPatterns=agents/validation.test.ts --listTests
```
Expected: no compile error (the import path resolves; no test runs yet because we haven't touched validation.ts).

- [ ] **Step 4: Commit**

```
git add libs/agent-orchestrator/src/index.ts
git commit -m "feat(agent-orchestrator): re-export ValidationContext from public index"
```

---

## Task 6: Add `operatingMode` channel to `PortfolioEngineState`

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/agents/state.ts`

- [ ] **Step 1: Replace the file**

```ts
import { Annotation } from '@langchain/langgraph';

type AgentOutput = Record<string, unknown> | undefined;
const lastValue = (_prev: AgentOutput, next: AgentOutput): AgentOutput => next;
const lastString = (_prev: string | undefined, next: string | undefined): string | undefined => next;

export const PortfolioEngineState = Annotation.Root({
  input: Annotation<string | undefined>({ reducer: lastString }),
  operatingMode: Annotation<string | undefined>({ reducer: lastString }),
  'portfolio-construction': Annotation<AgentOutput>({ reducer: lastValue }),
  'rebalance-planner': Annotation<AgentOutput>({ reducer: lastValue }),
});

export type PortfolioEngineStateType = typeof PortfolioEngineState.State;
```

- [ ] **Step 2: Run the unit suite to confirm no regression**

```
pnpm nx run portfolio-engine-ctrl:test
```
Expected: all existing tests still PASS (the new channel is `undefined` by default and unread).

- [ ] **Step 3: Commit**

```
git add services/advisory/portfolio-engine-ctrl/src/agents/state.ts
git commit -m "feat(portfolio-engine): add operatingMode channel to PortfolioEngineState

Channel propagates the operating mode through LangGraph wave nodes so
the upcoming mode-aware portfolioValidationRule can read it via
ValidationContext.state.operatingMode."
```

---

## Task 7: Pass `operatingMode` through `invokeOrchestrator` in `graph.ts`

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:131-144`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts` (inside the existing `describe('portfolio-engine-ctrl orchestrator graph', …)` scope):

```ts
  it('passes operatingMode to invokeOrchestrator alongside input', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1',
      upstreamOutputs: { operatingMode: 'AGGRESSIVE' },
    });

    expect(mockInvokeOrchestrator).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ input: expect.any(String), operatingMode: 'AGGRESSIVE' }),
      undefined,
    );
  });

  it('defaults operatingMode to BALANCED when upstreamOutputs has none', async () => {
    mockKBRetrieve.mockResolvedValue([]);

    let invokePortfolioEngine: ((...args: unknown[]) => Promise<unknown>) | undefined;
    jest.isolateModules(() => {
      const mod = require('../../agents/portfolio-engine/graph');
      invokePortfolioEngine = mod.invokePortfolioEngine;
    });

    await invokePortfolioEngine!({
      tenantId: 't1', decisionId: 'd1',
      upstreamOutputs: {},
    });

    expect(mockInvokeOrchestrator).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ operatingMode: 'BALANCED' }),
      undefined,
    );
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

```
pnpm nx run portfolio-engine-ctrl:test -- --testPathPatterns=graph.test.ts
```
Expected: 2 new cases FAIL (current `invokeOrchestrator` payload is `{ input: enrichedInput }` only).

- [ ] **Step 3: Modify `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts` lines 131-144**

Replace:
```ts
  const graph = getGraphForMode(operatingMode);
  const enrichedInput = `Decision ${payload.decisionId} context: ${seed}` + modeContext + kbContext + upstreamContext + toolContext;
  const result = await invokeOrchestrator(
    graph,
    { input: enrichedInput },
    emitter
      ? {
          agent: 'portfolio-engine',
          correlationId: payload.decisionId,
          tenantId: payload.tenantId,
          emitter,
        }
      : undefined,
  );
```

with:
```ts
  const graph = getGraphForMode(operatingMode);
  const enrichedInput = `Decision ${payload.decisionId} context: ${seed}` + modeContext + kbContext + upstreamContext + toolContext;
  const result = await invokeOrchestrator(
    graph,
    { input: enrichedInput, operatingMode },
    emitter
      ? {
          agent: 'portfolio-engine',
          correlationId: payload.decisionId,
          tenantId: payload.tenantId,
          emitter,
        }
      : undefined,
  );
```

- [ ] **Step 4: Run the tests**

```
pnpm nx run portfolio-engine-ctrl:test -- --testPathPatterns=graph.test.ts
```
Expected: all PASS (existing 7 + new 2 = 9 cases).

- [ ] **Step 5: Commit**

```
git add services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts
git commit -m "feat(portfolio-engine): plumb operatingMode through invokeOrchestrator payload

invokePortfolioEngine now passes { input, operatingMode } to the
orchestrator so PortfolioEngineState carries the mode through wave nodes
and the upcoming mode-aware portfolioValidationRule can read it via
ValidationContext.state.operatingMode."
```

---

## Task 8: Replace `portfolioValidationRule` body with mode-aware logic

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/agents/validation.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/unit/agents/validation.test.ts`

- [ ] **Step 1: Replace the test file** (the existing 4 cases assert obsolete invariants — fewer-than-2 floor and 50% any-position cap — both subsumed/replaced by mode-aware logic)

Replace `services/advisory/portfolio-engine-ctrl/test/unit/agents/validation.test.ts` entirely with:

```ts
import { portfolioValidationRule, rebalanceValidationRule } from '../../../src/agents/validation';
import type { ValidationContext } from '@nestfolio/agent-orchestrator';

type Allocation = { instrument: string; assetClass: string; targetWeight: number; rationale: string };
type PortfolioOutput = {
  allocations: Allocation[];
  totalExposure: number;
  equityWeight: number;
  riskMetrics: { concentrationRisk: number; sectorDiversity: number; largestPositionWeight: number };
  confidence: number;
};

const ctxFor = (mode: string, attempt = 0): ValidationContext => ({
  state: { operatingMode: mode },
  attempt,
});

const conservativeValid: PortfolioOutput = {
  allocations: [
    { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.50, rationale: 'Aggregate bonds' },
    { instrument: 'SHY', assetClass: 'FIXED_INCOME', targetWeight: 0.30, rationale: 'Short treasuries' },
    { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.10, rationale: 'US broad market' },
    { instrument: 'IXUS', assetClass: 'EQUITY', targetWeight: 0.10, rationale: 'Ex-US broad market' },
  ],
  totalExposure: 1.0,
  equityWeight: 0.20,
  riskMetrics: { concentrationRisk: 0.10, sectorDiversity: 0.85, largestPositionWeight: 0.10 },
  confidence: 0.88,
};

const balancedValid: PortfolioOutput = {
  allocations: [
    { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.14, rationale: 'US equity' },
    { instrument: 'IXUS', assetClass: 'EQUITY', targetWeight: 0.14, rationale: 'Ex-US equity' },
    { instrument: 'QQQ', assetClass: 'EQUITY', targetWeight: 0.14, rationale: 'Tech tilt' },
    { instrument: 'VWO', assetClass: 'EQUITY', targetWeight: 0.13, rationale: 'EM equity' },
    { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.27, rationale: 'Aggregate bonds' },
    { instrument: 'SHY', assetClass: 'FIXED_INCOME', targetWeight: 0.18, rationale: 'Short treasuries' },
  ],
  totalExposure: 1.0,
  equityWeight: 0.55,
  riskMetrics: { concentrationRisk: 0.18, sectorDiversity: 0.72, largestPositionWeight: 0.14 },
  confidence: 0.86,
};

const aggressiveValid: PortfolioOutput = {
  allocations: [
    { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.20, rationale: 'US broad' },
    { instrument: 'VOO', assetClass: 'EQUITY', targetWeight: 0.18, rationale: 'S&P 500' },
    { instrument: 'QQQ', assetClass: 'EQUITY', targetWeight: 0.15, rationale: 'Tech tilt' },
    { instrument: 'IXUS', assetClass: 'EQUITY', targetWeight: 0.12, rationale: 'Ex-US broad' },
    { instrument: 'VWO', assetClass: 'EQUITY', targetWeight: 0.10, rationale: 'EM equity' },
    { instrument: 'ARKK', assetClass: 'EQUITY', targetWeight: 0.10, rationale: 'Innovation' },
    { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.10, rationale: 'Bond ballast' },
    { instrument: 'BIL', assetClass: 'CASH', targetWeight: 0.05, rationale: 'Cash sleeve' },
  ],
  totalExposure: 1.0,
  equityWeight: 0.85,
  riskMetrics: { concentrationRisk: 0.22, sectorDiversity: 0.65, largestPositionWeight: 0.20 },
  confidence: 0.84,
};

describe('portfolioValidationRule — happy path per mode', () => {
  it('CONSERVATIVE: in-envelope output passes', () => {
    const r = portfolioValidationRule.validate(conservativeValid, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.feedback).toBeUndefined();
  });

  it('BALANCED: in-envelope output passes', () => {
    const r = portfolioValidationRule.validate(balancedValid, ctxFor('BALANCED'));
    expect(r.valid).toBe(true);
  });

  it('AGGRESSIVE: in-envelope output passes', () => {
    const r = portfolioValidationRule.validate(aggressiveValid, ctxFor('AGGRESSIVE'));
    expect(r.valid).toBe(true);
  });

  it('defaults to BALANCED envelope when ctx is omitted', () => {
    // balancedValid sits inside the BALANCED envelope; rule should accept
    // when no ctx is passed (and therefore no operatingMode) by defaulting.
    const r = portfolioValidationRule.validate(balancedValid);
    expect(r.valid).toBe(true);
  });
});

describe('portfolioValidationRule — mass conservation (mode-orthogonal)', () => {
  it('rejects when allocations sum drifts beyond 0.01 of totalExposure', () => {
    const drifted: PortfolioOutput = {
      ...balancedValid,
      allocations: [...balancedValid.allocations, { instrument: 'X', assetClass: 'CASH', targetWeight: 0.05, rationale: 'extra' }],
    };
    const r = portfolioValidationRule.validate(drifted, ctxFor('BALANCED'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('sum') || e.toLowerCase().includes('totalexposure'))).toBe(true);
    expect(r.feedback).toContain('totalExposure');
  });
});

describe('portfolioValidationRule — count band per mode', () => {
  it('CONSERVATIVE rejects 7 positions (must be in [3, 5])', () => {
    const r = portfolioValidationRule.validate(balancedValid, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('allocations.length=6') || e.includes('allocations.length=7'))).toBe(true);
    expect(r.feedback).toContain('CONSOLIDATE');
  });

  it('AGGRESSIVE rejects 4 positions (must be in [6, 12])', () => {
    const r = portfolioValidationRule.validate(conservativeValid, ctxFor('AGGRESSIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('allocations.length=4'))).toBe(true);
    expect(r.feedback).toContain('ADD');
  });
});

describe('portfolioValidationRule — equity weight band per mode', () => {
  it('CONSERVATIVE rejects equityWeight=0.55 (must be in [0, 0.30])', () => {
    const r = portfolioValidationRule.validate(balancedValid, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('equityWeight=0.55'))).toBe(true);
    expect(r.feedback).toContain('REDUCE');
  });

  it('AGGRESSIVE rejects equityWeight=0.20 (must be in [0.70, 0.90])', () => {
    const r = portfolioValidationRule.validate(conservativeValid, ctxFor('AGGRESSIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('equityWeight=0.20'))).toBe(true);
    expect(r.feedback).toContain('INCREASE');
  });
});

describe('portfolioValidationRule — largest EQUITY position cap per mode', () => {
  it('CONSERVATIVE rejects QQQ at 0.14 (cap=0.10) but PERMITS BND at 0.50', () => {
    const offender: PortfolioOutput = {
      ...conservativeValid,
      allocations: [
        { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.50, rationale: 'aggregate' },
        { instrument: 'SHY', assetClass: 'FIXED_INCOME', targetWeight: 0.20, rationale: 'short' },
        { instrument: 'QQQ', assetClass: 'EQUITY', targetWeight: 0.14, rationale: 'tech tilt' },
        { instrument: 'IXUS', assetClass: 'EQUITY', targetWeight: 0.16, rationale: 'ex-US' },
      ],
      totalExposure: 1.0,
      equityWeight: 0.30,
    };
    const r = portfolioValidationRule.validate(offender, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /largest EQUITY position .*=0\.16/.test(e) || /largest EQUITY position .*0\.14/.test(e) || /largest EQUITY position/.test(e))).toBe(true);
    // BND at 0.50 must NOT be flagged
    expect(r.errors.every((e) => !e.includes('BND'))).toBe(true);
    expect(r.feedback).toContain('CAP');
    expect(r.feedback).toContain('FIXED_INCOME');
  });
});

describe('portfolioValidationRule — feedback structure', () => {
  it('multi-violation feedback lists each violation on its own line and ends with re-emit instruction', () => {
    // Force a 3-violation output: count too high, equity too high, single equity position too large.
    const r = portfolioValidationRule.validate(balancedValid, ctxFor('CONSERVATIVE'));
    expect(r.valid).toBe(false);
    expect(r.feedback).toContain('You returned a portfolio that violates CONSERVATIVE mode rules');
    expect(r.feedback).toContain('Re-emit the structured-output tool');
    // feedback contains ≥ 2 line-prefixed violations
    expect((r.feedback ?? '').split('\n').filter((l) => l.startsWith('- ')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Rebalance plan validation — unchanged', () => {
  const validPlan = {
    trades: [
      { action: 'BUY', instrument: 'VTI', targetWeight: 0.6, currentWeight: 0.5, quantity: 10, rationale: 'Increase' },
    ],
    estimatedTurnover: 0.1,
    confidence: 0.8,
  };

  it('passes valid plan', () => {
    expect(rebalanceValidationRule.validate(validPlan).valid).toBe(true);
  });

  it('fails with duplicate instruments', () => {
    const r = rebalanceValidationRule.validate({
      ...validPlan,
      trades: [
        { action: 'BUY', instrument: 'VTI', targetWeight: 0.6, currentWeight: 0.5, quantity: 10, rationale: 'A' },
        { action: 'SELL', instrument: 'VTI', targetWeight: 0.4, currentWeight: 0.5, quantity: 5, rationale: 'B' },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('Duplicate');
  });

  it('fails when estimatedTurnover exceeds 1.0', () => {
    const r = rebalanceValidationRule.validate({ ...validPlan, estimatedTurnover: 1.5 });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('turnover');
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```
pnpm nx run portfolio-engine-ctrl:test -- --testPathPatterns=agents/validation.test.ts
```
Expected: most new cases FAIL (the current rule has no `assetClass` knowledge, no mode awareness, and no `feedback` output). The 3 `Rebalance plan` cases still PASS unchanged.

- [ ] **Step 3: Replace `services/advisory/portfolio-engine-ctrl/src/agents/validation.ts`**

```ts
import type { ValidationContext, ValidationRule, ValidationResult } from '@nestfolio/agent-orchestrator';
import type { OperatingMode } from './prompts';

interface Allocation {
  instrument: string;
  assetClass: string;
  targetWeight: number;
  rationale: string;
}

interface PortfolioOutput {
  allocations: Allocation[];
  totalExposure: number;
  equityWeight: number;
  riskMetrics: { concentrationRisk: number; sectorDiversity: number; largestPositionWeight: number };
  confidence: number;
}

interface RebalanceOutput {
  trades: Array<{ action: string; instrument: string; targetWeight: number; currentWeight: number; quantity: number | null; rationale: string }>;
  estimatedTurnover: number;
  confidence: number;
}

interface ModeEnvelope {
  readonly equityRange: readonly [number, number];
  readonly largestEquityCap: number;
  readonly countRange: readonly [number, number];
}

interface Violation {
  readonly kind: 'mass' | 'count' | 'equity' | 'largestEquity';
  readonly observed: number | string;
  readonly expected: string;
}

const MODE_ENVELOPE: Record<OperatingMode, ModeEnvelope> = {
  CONSERVATIVE: { equityRange: [0, 0.30], largestEquityCap: 0.10, countRange: [3, 5] },
  BALANCED:     { equityRange: [0.50, 0.70], largestEquityCap: 0.15, countRange: [5, 8] },
  AGGRESSIVE:   { equityRange: [0.70, 0.90], largestEquityCap: 0.25, countRange: [6, 12] },
};

function ok(): ValidationResult { return { valid: true, errors: [] }; }
function fail(errors: string[], feedback: string): ValidationResult { return { valid: false, errors, feedback }; }

function resolveMode(ctx?: ValidationContext): OperatingMode {
  const raw = ctx?.state['operatingMode'];
  if (raw === 'CONSERVATIVE' || raw === 'AGGRESSIVE') return raw;
  return 'BALANCED';
}

function formatCorrectiveFeedback(
  mode: OperatingMode,
  env: ModeEnvelope,
  violations: Violation[],
  output: PortfolioOutput,
): string {
  const lines: string[] = [`You returned a portfolio that violates ${mode} mode rules. Specifically:`];
  for (const v of violations) {
    if (v.kind === 'mass') {
      lines.push(`- targetWeights sum to ${v.observed} but totalExposure is ${output.totalExposure}. Re-balance so the two match within 0.01.`);
    } else if (v.kind === 'count') {
      const [lo, hi] = env.countRange;
      const current = output.allocations.length;
      lines.push(current < lo
        ? `- allocations.length=${current} — must be in [${lo}, ${hi}]. ADD ${lo - current} more positions.`
        : `- allocations.length=${current} — must be in [${lo}, ${hi}]. CONSOLIDATE ${current - hi} positions into broader ETFs (e.g. one VTI instead of VTI+VOO+QQQ).`);
    } else if (v.kind === 'equity') {
      const [lo, hi] = env.equityRange;
      const eq = Number(v.observed);
      lines.push(eq > hi
        ? `- equityWeight=${eq.toFixed(2)} — must be in [${lo}, ${hi}]. REDUCE equity sleeve by ~${(eq - hi).toFixed(2)} by trimming individual EQUITY targetWeights or reallocating to FIXED_INCOME / CASH.`
        : `- equityWeight=${eq.toFixed(2)} — must be in [${lo}, ${hi}]. INCREASE equity sleeve by ~${(lo - eq).toFixed(2)} by adding EQUITY positions or raising existing EQUITY targetWeights.`);
    } else if (v.kind === 'largestEquity') {
      lines.push(`- largest EQUITY position is ${v.observed} — must be ≤ ${env.largestEquityCap}. CAP individual EQUITY positions at ${env.largestEquityCap} each (FIXED_INCOME / CASH positions are exempt from this cap).`);
    }
  }
  lines.push(`Re-emit the structured-output tool with corrected allocations.`);
  return lines.join('\n');
}

export const portfolioValidationRule: ValidationRule<PortfolioOutput> = {
  validate(output: PortfolioOutput, ctx?: ValidationContext): ValidationResult {
    const mode = resolveMode(ctx);
    const env = MODE_ENVELOPE[mode];
    const errors: string[] = [];
    const violations: Violation[] = [];

    // 1. Mass conservation (mode-orthogonal)
    const weightSum = output.allocations.reduce((s, a) => s + a.targetWeight, 0);
    if (Math.abs(weightSum - output.totalExposure) > 0.01) {
      errors.push(`Weights sum to ${weightSum.toFixed(4)}, totalExposure=${output.totalExposure}`);
      violations.push({ kind: 'mass', observed: weightSum.toFixed(4), expected: `≈${output.totalExposure}` });
    }

    // 2. Count band
    const count = output.allocations.length;
    const [countMin, countMax] = env.countRange;
    if (count < countMin || count > countMax) {
      errors.push(`allocations.length=${count}, must be in [${countMin}, ${countMax}] for ${mode}`);
      violations.push({ kind: 'count', observed: count, expected: `[${countMin}, ${countMax}]` });
    }

    // 3. Equity weight band (computed from allocations, not the model-reported field)
    const equityPositions = output.allocations.filter((a) => a.assetClass === 'EQUITY');
    const equitySum = equityPositions.reduce((s, a) => s + a.targetWeight, 0);
    const [eqMin, eqMax] = env.equityRange;
    if (equitySum < eqMin || equitySum > eqMax) {
      errors.push(`equityWeight=${equitySum.toFixed(2)}, must be in [${eqMin}, ${eqMax}] for ${mode}`);
      violations.push({ kind: 'equity', observed: equitySum, expected: `[${eqMin}, ${eqMax}]` });
    }

    // 4. Largest EQUITY position cap
    const largestEquity = equityPositions.length > 0
      ? Math.max(...equityPositions.map((a) => a.targetWeight))
      : 0;
    if (largestEquity > env.largestEquityCap) {
      const offender = equityPositions.find((a) => a.targetWeight === largestEquity)?.instrument ?? '?';
      errors.push(`largest EQUITY position ${offender}=${largestEquity.toFixed(2)}, must be ≤ ${env.largestEquityCap} for ${mode}`);
      violations.push({ kind: 'largestEquity', observed: `${offender}=${largestEquity.toFixed(2)}`, expected: `≤ ${env.largestEquityCap}` });
    }

    if (errors.length === 0) return ok();
    return fail(errors, formatCorrectiveFeedback(mode, env, violations, output));
  },
};

export const rebalanceValidationRule: ValidationRule<RebalanceOutput> = {
  validate(output: RebalanceOutput): ValidationResult {
    const errors: string[] = [];
    const instruments = output.trades.map((t) => t.instrument);
    const unique = new Set(instruments);

    if (unique.size !== instruments.length) {
      errors.push('Duplicate instruments found in trades');
    }

    if (output.estimatedTurnover > 1.0) {
      errors.push(`estimatedTurnover ${output.estimatedTurnover} exceeds 100% — excessive turnover`);
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true, errors: [] };
  },
};
```

- [ ] **Step 4: Run the validation tests**

```
pnpm nx run portfolio-engine-ctrl:test -- --testPathPatterns=agents/validation.test.ts
```
Expected: all PASS (10 portfolio cases + 3 rebalance cases).

- [ ] **Step 5: Run the full portfolio-engine-ctrl unit suite**

```
pnpm nx run portfolio-engine-ctrl:test
```
Expected: all PASS. The graph.test.ts cases from Task 7 still green; existing prompts.test.ts, schemas.test.ts, fallbacks.test.ts, golden-fixtures.test.ts, format-context.test.ts, agent-service.test.ts, event-listener.test.ts, portfolio-lookup.test.ts, kb-ingestion-handler.test.ts, service.stack.test.ts unaffected.

- [ ] **Step 6: Commit**

```
git add services/advisory/portfolio-engine-ctrl/src/agents/validation.ts services/advisory/portfolio-engine-ctrl/test/unit/agents/validation.test.ts
git commit -m "feat(portfolio-engine): mode-aware portfolioValidationRule with corrective feedback

Rule now reads operatingMode from ValidationContext.state and enforces
the per-mode envelope: count band, equityWeight band, and largest-EQUITY
position cap. Drops the now-incorrect global 50%-any-position cap (which
would false-reject CONSERVATIVE outputs holding BND at 0.50 by design).
Emits a structured corrective feedback string with per-violation
remediation hints (REDUCE / INCREASE / CAP / CONSOLIDATE / ADD) consumed
by withRetry → agent-factory on the next prompt attempt."
```

---

## Task 9: Validation gate

**Files:** none modified — verifies the end-to-end behavior.

- [ ] **Step 1: Lint both touched projects**

```
pnpm nx run agent-orchestrator:lint
pnpm nx run portfolio-engine-ctrl:lint
```
Expected: zero new violations in either.

- [ ] **Step 2: Run the full unit suites**

```
pnpm nx run agent-orchestrator:test
pnpm nx run portfolio-engine-ctrl:test
```
Expected: all PASS. If any other library/service that imports `ValidationRule` / `ValidationResult` / `ValidationError` fails to typecheck, treat as a regression — the changes are designed backward-compatible. Likely culprits if a regression appears: tests that mock `withValidation` or `withRetry` and pin to the old in-memory shapes.

- [ ] **Step 3: Run integration smoke against deployed dev**

```
pnpm nx run portfolio-engine-ctrl:test-integration
```
Expected: green. The mode-aware rule + retry loop kicks in against real Bedrock; CONSERVATIVE / AGGRESSIVE recovery is the new dominant pathway. If the integration suite specifically asserts old `errors` content for portfolioValidationRule, update those assertions to match the new mode-aware error strings (search: `grep -rn "portfolioValidationRule" services/advisory/portfolio-engine-ctrl/test/integration/`).

- [ ] **Step 4: Deploy AgentRuntime to dev**

```
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl
```
Expected: deployment succeeds; CloudFormation stack `dev-portfolio-engine-ctrl` updates without errors. The AgentRuntime esbuild → bundle.js → ARM64 Docker → Bedrock AgentCore Runtime path is unchanged; only the Lambda + AgentRuntime bundle content changes.

- [ ] **Step 5: Run the e2e gate**

```
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=operating-mode-recommendation-shape
```
Expected: CONSERVATIVE PASS, AGGRESSIVE PASS, BALANCED times out (separately-filed Vestigial MemoryStrategy bug — acceptable per spec § Done-when).

- [ ] **Step 6: If a tail-mode flake on first run, re-run once**

LLM nondeterminism can cause one-off failures. Per the spec § Validation gate item 9: **two consecutive failures of CONSERVATIVE or AGGRESSIVE → escalation**. Do not declare failure on a single flake.

```
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=operating-mode-recommendation-shape
```

- [ ] **Step 7: On full success, update `docs/BACKLOG.md`**

The BACKLOG ACTIVE → SHIPPED block should be added to the Recently Completed table at the top of `docs/BACKLOG.md`. Include the commit range from this implementation plan and the e2e gate result. Move the QUEUED slot 1 entry off the queue.

```
git add docs/BACKLOG.md
git commit -m "docs(backlog): ship Approach B mode-aware validation rule + retry-feedback loop

E2E gate operating-mode-recommendation-shape: CONSERVATIVE GREEN +
AGGRESSIVE GREEN against deployed dev. BALANCED still blocked on
separately-filed Vestigial MemoryStrategy."
```

- [ ] **Step 8: On failure of step 5 + step 6 (two consecutive runs failing CONSERVATIVE or AGGRESSIVE)**

Do NOT keep retrying. Per the spec § Validation gate item 9, escalation options are:
1. Raise `RetryOptions.maxAttempts` from 3 to 5 in `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:47` and re-run.
2. Raise the per-attempt `maxTokens` for portfolio-construction to give the model more headroom for the corrected output.
3. Promote a new design workstream rather than continuing to iterate inside this one.

File the outcome in `docs/BACKLOG.md` as ACTIVE → SHIPPED-NOT-VALIDATED (mirroring the predecessor α-tune entry's pattern). Surface the analysis in a new BACKLOG entry under PARKING LOT.

---

## Self-Review Notes

**Spec coverage (each spec section → task that implements it):**
- Spec § Lib change 1 (ValidationContext + feedback) → Task 1.
- Spec § Lib change 2 (withRetry feedback injection) → Task 3.
- Spec § Lib change 3 (agent-factory consumes feedback) → Task 4.
- Spec § Lib change 4 (index re-export) → Task 5.
- Spec § Service change 1 (state.ts + graph.ts) → Tasks 6, 7.
- Spec § Service change 2 (mode-aware portfolioValidationRule) → Task 8.
- Spec § Validation gate (lint + unit + integration smoke + deploy + e2e) → Task 9.
- Spec § "withValidation reads __retryAttempt to populate ctx" → Task 2 (this is the missing-link task between the type extension in Task 1 and the retry injection in Task 3).

**Type consistency:** `ValidationContext`, `ValidationResult.feedback`, `ValidationError.feedback`, `__retryAttempt`, `__retryFeedback`, `Violation`, `ModeEnvelope`, `MODE_ENVELOPE`, `formatCorrectiveFeedback`, `resolveMode` — all introduced in earlier tasks before being referenced in later tasks. `OperatingMode` reused from existing `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts`.

**No-placeholder check:** every task contains exact file paths, exact code, exact commands, expected output. No "TODO", "TBD", "implement later", "similar to Task N" markers.
