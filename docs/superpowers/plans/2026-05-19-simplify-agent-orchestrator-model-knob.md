# Simplify agent-orchestrator model knob — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove runtime tier-escalation and the `AGENT_MODEL_OVERRIDE` cost-cap downgrade from `libs/agent-orchestrator`, leaving each `*.config.ts`'s `modelId: string` as the only model knob. Behaviour-preserving (no production model changes today).

**Architecture:** Bottom-up deletion — strip the consumers of the symbols first (so the tree compiles cleanly at every commit), then drop the now-unused symbols and the `tier-escalation.ts` file, then the CDK wiring, then comment cleanups. Each task ends with a focused `nx` gate (type-check or test) so regressions surface immediately.

**Tech Stack:** TypeScript, Jest, LangChain.js (`@langchain/aws`, `@langchain/langgraph`), AWS CDK (Bedrock AgentCore Runtime), Nx, pnpm.

**Backlog:** `docs/backlog/simplify-agent-orchestrator-model-knob.md` (`status: active`).
**Spec:** `docs/superpowers/specs/2026-05-19-simplify-agent-orchestrator-model-knob-design.md`.
**Worktree branch:** `worktree-simplify-agent-orchestrator-model-knob`.

---

## Out of scope (mirrors backlog `out_of_scope:`)

- The benchmark skill itself (`agent-benchmark-skill`, separate workstream).
- The `looksDegraded` / `REINFORCE_SUFFIX` schema-degraded retry path in agent-factory (stays as-is).
- The `withValidation` validation-rule retry path and `__retryFeedback` prompt augmentation (stays as-is).
- Replacing haiku/sonnet/opus tier vocabulary with a different vocabulary — there is no replacement; the unit is now `modelId: string` everywhere.
- Changing the production `modelId` of any AgentConfig — strictly behaviour-preserving.
- Adding a per-deploy override mechanism (env var, SSM, etc.).
- Onboarding-bff agent's OWN model wiring (`services/investor/onboarding-bff/agents/onboarding/graph.ts:33-34` reads its own `AGENT_MODEL_OVERRIDE` and uses `ONBOARDING_OVERRIDE_MAP` — independent of advisory). The `services/investor/onboarding-bff/src/service.stack.ts:127` comment about onboarding's own override stays.

---

## File map

**Modify (libs):**
- `libs/agent-orchestrator/src/types.ts` — drop `ModelTier`, drop `RetryOptions.escalationPath`.
- `libs/agent-orchestrator/src/with-retry.ts` — drop `escalationPath` destructure and `__escalationTier` enrichment.
- `libs/agent-orchestrator/src/agent-factory.ts` — drop `MODEL_ID_MAP`, `TIER_ORDER`, `detectTier`, `applyOverride`, `__escalationTier` branch.
- `libs/agent-orchestrator/src/create-orchestrator.ts` — drop `buildEscalationPath` import + usage.
- `libs/agent-orchestrator/src/agent-tracer.ts` — rename `extractModelTier` → `extractModelId`; drop `TIER_RANK`, `classifyTier`, `lastTier`, `escalatedFromTier` envelope field, rank-comparison block in `handleLLMEnd`.
- `libs/agent-orchestrator/src/invoke-orchestrator.ts` — drop `escalatedFromTier` projection in the structured-log summary.
- `libs/agent-orchestrator/src/index.ts` — drop `ModelTier` and `buildEscalationPath` re-exports.
- `libs/cdk-constructs/src/extensions/agent-runtime.ts` — drop `overrideContext` block (lines 55-63) + `overrideEnv` spread on line 78.

**Modify (services):**
- `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:24` — drop `escalationPath: ['sonnet', 'opus']`.
- `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts:25` — drop `escalationPath: ['sonnet']`.
- `services/investor/onboarding-bff/agents/onboarding/graph.ts:39` — replace stale `MODEL_ID_MAP.sonnet` comment with one referencing the explicit `deps.modelId` binding.

**Modify (tests):**
- `libs/agent-orchestrator/test/with-retry.test.ts` — delete 2 escalation tests; add 1 regression test for `__retryFeedback` propagation.
- `libs/agent-orchestrator/test/agent-factory.test.ts` — delete entire `AGENT_MODEL_OVERRIDE` describe + 2 `__escalationTier` tests.
- `libs/agent-orchestrator/test/agent-tracer.test.ts` — rename `extractModelTier` references; assert raw IDs; flip Nova case from `'unknown'` to raw ID; delete 4 `escalatedFromTier` tests; remove the `escalatedFromTier` assertion from the surviving "records LLM call" test.

**Delete (libs):**
- `libs/agent-orchestrator/src/tier-escalation.ts`
- `libs/agent-orchestrator/test/tier-escalation.test.ts`

---

## Task 1: Pre-flight blast-radius diligence

**Files:**
- No edits. Read-only checks: CloudWatch Logs Insights, `aws lambda get-function-configuration`, repo grep.

- [ ] **Step 1: Verify escalation isn't firing in dev — CloudWatch Logs Insights.**

  Query each advisory AgentCore Runtime log group (last 30 days) for any envelope with non-null `escalatedFromTier`. Use the AWS CLI:

  ```bash
  AWS_PROFILE=nestfolio-dev aws logs describe-log-groups \
    --log-group-name-prefix '/aws/bedrock-agentcore/runtime/dev-' \
    --query 'logGroups[].logGroupName' --output text
  ```

  For each of the 4 advisory log groups returned (`dev-investor-profile-ctrl-*`, `dev-market-intelligence-ctrl-*`, `dev-portfolio-engine-ctrl-*`, `dev-advisory-narrative-ctrl-*`), run:

  ```bash
  AWS_PROFILE=nestfolio-dev aws logs start-query \
    --log-group-name '<log-group-name>' \
    --start-time $(date -v-30d +%s) \
    --end-time $(date +%s) \
    --query-string 'fields @timestamp, escalatedFromTier, nodeName | filter ispresent(escalatedFromTier) | stats count() by nodeName, escalatedFromTier'
  ```

  Then `aws logs get-query-results --query-id <returned-id>` after a few seconds.

  Expected: zero rows OR rows whose `escalatedFromTier` value is `null`/`undefined`-equivalent. Any node with non-zero non-null count → STOP and surface to user. The escalation path is load-bearing for that node and removing it would regress.

- [ ] **Step 2: Verify `AGENT_MODEL_OVERRIDE` env var is unset on deployed advisory runtimes.**

  ```bash
  for fn in $(AWS_PROFILE=nestfolio-dev aws lambda list-functions \
    --query "Functions[?contains(FunctionName, 'agentcore-runtime') && contains(FunctionName, 'dev-')].FunctionName" \
    --output text); do
    echo "=== $fn ==="
    AWS_PROFILE=nestfolio-dev aws lambda get-function-configuration --function-name "$fn" \
      --query 'Environment.Variables.AGENT_MODEL_OVERRIDE' --output text
  done
  ```

  Expected: every line prints `None`. Any non-empty value → today's deployed model differs from `*.config.ts modelId`; STOP and surface to user before proceeding.

  Note: this targets AgentCore Runtime containers (advisory). Onboarding-bff's separate `AGENT_MODEL_OVERRIDE` env var (Lambda BFF, out of scope) lives elsewhere and is untouched by this workstream.

- [ ] **Step 3: Repo grep for orphan wiring or downstream consumers.**

  ```bash
  # CDK wiring sites
  grep -rn 'AGENT_MODEL_OVERRIDE\|agentModelOverride' infrastructure/ libs/cdk-constructs/ services/ 2>/dev/null \
    | grep -v dist | grep -v node_modules

  # envelope-field consumers
  grep -rn 'escalatedFromTier' services/ libs/ infrastructure/ tools/ 2>/dev/null \
    | grep -v dist | grep -v node_modules

  # agent-trace contract tests that may assert the closed-set tier vocabulary
  grep -rn "gen_ai\.request\.model" services/ libs/ apps/ 2>/dev/null \
    | grep -i 'test\|spec' | grep -v dist | grep -v node_modules
  ```

  Expected at plan time:
  - First grep: `libs/cdk-constructs/src/extensions/agent-runtime.ts:56,60,62` (handled in Task 11), plus `services/investor/onboarding-bff/agents/onboarding/graph.ts:33` (onboarding-bff's own var — out of scope, leave alone) and `services/investor/onboarding-bff/src/service.stack.ts:127` (comment about onboarding-bff's own override — out of scope, leave alone). Any OTHER site → STOP and surface to user.
  - Second grep: only `libs/agent-orchestrator/src/agent-tracer.ts` + `libs/agent-orchestrator/src/invoke-orchestrator.ts:60` + `libs/agent-orchestrator/test/agent-tracer.test.ts`. Any OTHER hit → STOP and surface to user.
  - Third grep: contract tests in `apps/e2e-feature-tests` or `libs/event-types` that assert `gen_ai.request.model === 'haiku' | 'sonnet' | 'opus'`. If any test compares against the closed-set literals → flag and add to scope of this plan (assertion must flip to raw model ID).

- [ ] **Step 4: No commit.** This task is read-only diligence; no files change.

---

## Task 2: Strip escalationPath from `with-retry.ts` + tests

**Files:**
- Modify: `libs/agent-orchestrator/src/with-retry.ts`
- Modify: `libs/agent-orchestrator/test/with-retry.test.ts`

- [ ] **Step 1: Edit `libs/agent-orchestrator/src/with-retry.ts`** — replace entire file with:

  ```typescript
  import { ValidationError, type RetryOptions } from './types';
  import type { AgentNodeFn } from './with-validation';

  export function withRetry(
    node: AgentNodeFn,
    options: RetryOptions,
  ): AgentNodeFn {
    const { maxAttempts } = options;

    return async (state, config) => {
      let lastError: Error | undefined;
      let workingState: Record<string, unknown> = state;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const enriched: Record<string, unknown> = { ...workingState, __retryAttempt: attempt };
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

- [ ] **Step 2: Edit `libs/agent-orchestrator/test/with-retry.test.ts`** — delete the 2 escalation tests (the `it('applies escalation path …')` block at lines 39-53 and the `it('reverts to original model when escalation path is shorter …')` block at lines 55-71). Add a regression test for `__retryFeedback` propagation immediately after the existing `'falls back to errors.join when error.feedback is absent'` test (keeps the file's existing locality), BEFORE the closing `});`:

  ```typescript
    it('regression: __retryFeedback survives the retry loop when ValidationError carries feedback (withValidation → withRetry contract)', async () => {
      // Spec §4.10 — preserves the withValidation feedback path so future
      // cleanups cannot silently sever the loop.
      const seen: Array<{ feedback: unknown; attempt: unknown }> = [];
      const node = jest.fn()
        .mockImplementationOnce(async (state: Record<string, unknown>) => {
          seen.push({ feedback: state['__retryFeedback'], attempt: state['__retryAttempt'] });
          throw new ValidationError(['bad'], { feedback: 'fix field X' });
        })
        .mockImplementationOnce(async (state: Record<string, unknown>) => {
          seen.push({ feedback: state['__retryFeedback'], attempt: state['__retryAttempt'] });
          return { value: 'recovered' };
        });
      const wrapped = withRetry(node, { maxAttempts: 2 });
      await wrapped({ input: 'go' });
      expect(seen[0]).toEqual({ feedback: undefined, attempt: 0 });
      expect(seen[1]).toEqual({ feedback: 'fix field X', attempt: 1 });
    });
  ```

  At this point `RetryOptions.escalationPath` is still defined in `types.ts`, so callers in `create-orchestrator.ts`, `advisory-narrative/graph.ts`, and `market-intelligence/graph.ts` still pass `escalationPath` — TypeScript still accepts those passes because the runtime simply ignores the now-deleted destructured key. The tree stays compile-clean.

- [ ] **Step 3: Run `with-retry` tests in isolation.**

  ```bash
  pnpm nx run agent-orchestrator:test --testPathPatterns=with-retry.test.ts
  ```

  Expected: PASS. The 2 deleted tests no longer run; the new regression test passes; the remaining 6 tests still pass.

- [ ] **Step 4: Run full agent-orchestrator test target.**

  ```bash
  pnpm nx run agent-orchestrator:test
  ```

  Expected: PASS. `agent-factory.test.ts` and `agent-tracer.test.ts` still rely on `__escalationTier`/`escalatedFromTier` behavior — they should still pass because that code is untouched at this point. If any other test fails, STOP and diagnose.

- [ ] **Step 5: Commit.**

  ```bash
  git add libs/agent-orchestrator/src/with-retry.ts libs/agent-orchestrator/test/with-retry.test.ts
  git commit -m "refactor(agent-orchestrator): drop escalationPath from withRetry"
  ```

---

## Task 3: Strip escalation + override from `agent-factory.ts` + tests

**Files:**
- Modify: `libs/agent-orchestrator/src/agent-factory.ts`
- Modify: `libs/agent-orchestrator/test/agent-factory.test.ts`

- [ ] **Step 1: Edit `libs/agent-orchestrator/src/agent-factory.ts`.** Apply these edits in order:

  - Line 3: change `import type { AgentConfig, ModelTier } from './types';` → `import type { AgentConfig } from './types';`.
  - Delete the entire block from line 7 (the `// US cross-region inference profile IDs.` comment) through line 42 (closing `}` of `applyOverride`).
  - Inside `createAgentNode` (around lines 84-87), replace the `effectiveModelId` derivation block with a direct pass-through. The body should read:

  ```typescript
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
  ```

  The `looksDegraded`, `REINFORCE_SUFFIX`, and Phase γ.4 comment block (originally lines 44-53) stay in place above `createAgentNode`.

- [ ] **Step 2: Edit `libs/agent-orchestrator/test/agent-factory.test.ts`.** Apply these deletions:

  - Delete the `it('uses __escalationTier to override model when present in state', …)` block at lines 55-63.
  - Delete the entire `describe('createAgentNode — AGENT_MODEL_OVERRIDE (cost-cap downgrade)', () => { … });` block at lines 95-204 (including the `ORIGINAL_OVERRIDE` capture, `beforeEach`/`afterAll`, all 8 `it()` cases AND the nested `__escalationTier` test at line 196-203).
  - In the `describe('createAgentNode — Phase γ.4 structured-output retry', …)` block at line 206, the `beforeEach` currently calls `delete process.env['AGENT_MODEL_OVERRIDE']`. Remove that line; the env var no longer affects anything.
  - In the `describe('createAgentNode — __retryFeedback prompt augmentation', …)` block at line 275, do the same: remove the `delete process.env['AGENT_MODEL_OVERRIDE']` line from its `beforeEach`.

- [ ] **Step 3: Run `agent-factory` tests in isolation.**

  ```bash
  pnpm nx run agent-orchestrator:test --testPathPatterns=agent-factory.test.ts
  ```

  Expected: PASS. The 3 generic + 2 RunnableConfig + 4 Phase γ.4 + 3 retry-feedback tests still pass; the 2 + 8 deleted tests are gone.

- [ ] **Step 4: Run full agent-orchestrator test target.**

  ```bash
  pnpm nx run agent-orchestrator:test
  ```

  Expected: PASS. `agent-tracer.test.ts` is still untouched and still relies on `escalatedFromTier`/`extractModelTier` — keep working. `with-retry.test.ts` (from Task 2) keeps passing.

- [ ] **Step 5: Commit.**

  ```bash
  git add libs/agent-orchestrator/src/agent-factory.ts libs/agent-orchestrator/test/agent-factory.test.ts
  git commit -m "refactor(agent-orchestrator): drop MODEL_ID_MAP + AGENT_MODEL_OVERRIDE from agent-factory"
  ```

---

## Task 4: Strip `buildEscalationPath` usage from `create-orchestrator.ts`

**Files:**
- Modify: `libs/agent-orchestrator/src/create-orchestrator.ts`
- Read-only: `libs/agent-orchestrator/test/create-orchestrator.test.ts` (verify no edits needed)

- [ ] **Step 1: Edit `libs/agent-orchestrator/src/create-orchestrator.ts`.** Two changes:

  - Delete line 8: `import { buildEscalationPath } from './tier-escalation';`.
  - Inside the agent loop (lines 44-49), delete the tier detection + escalation path wiring. Replace:

  ```typescript
      // Determine escalation path from model ID
      const tier = agentConfig.modelId.includes('haiku') ? 'haiku'
        : agentConfig.modelId.includes('opus') ? 'opus' : 'sonnet';
      const escalationPath = buildEscalationPath(tier as any);

      bareNode = withRetry(bareNode, { ...defaultRetry, escalationPath });
  ```

  with:

  ```typescript
      bareNode = withRetry(bareNode, defaultRetry);
  ```

- [ ] **Step 2: Verify the create-orchestrator test file has no escalation references.**

  ```bash
  grep -n 'escalationPath\|buildEscalationPath\|__escalationTier\|ModelTier' libs/agent-orchestrator/test/create-orchestrator.test.ts
  ```

  Expected: zero lines. (Plan-time grep returned no hits.) If any line returns, replace inline assertions and rerun.

- [ ] **Step 3: Run create-orchestrator tests.**

  ```bash
  pnpm nx run agent-orchestrator:test --testPathPatterns=create-orchestrator.test.ts
  ```

  Expected: PASS.

- [ ] **Step 4: Run full lib test + type-check.**

  ```bash
  pnpm nx run agent-orchestrator:test
  pnpm nx run agent-orchestrator:type-check
  ```

  Expected: both PASS. `tier-escalation.ts` still exists (only its lone caller in `create-orchestrator.ts` is gone); type-check passes because the file still exports `buildEscalationPath` and `index.ts` still re-exports it.

- [ ] **Step 5: Commit.**

  ```bash
  git add libs/agent-orchestrator/src/create-orchestrator.ts
  git commit -m "refactor(agent-orchestrator): drop buildEscalationPath wiring from createOrchestrator"
  ```

---

## Task 5: Strip `escalationPath` from advisory-narrative graph

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`

- [ ] **Step 1: Edit `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:24`.** Change:

  ```typescript
      { maxAttempts: 2, escalationPath: ['sonnet', 'opus'] },
  ```

  to:

  ```typescript
      { maxAttempts: 2 },
  ```

- [ ] **Step 2: Type-check the service.**

  ```bash
  pnpm nx run advisory-narrative-ctrl:type-check
  ```

  Expected: PASS.

- [ ] **Step 3: Run service tests.**

  ```bash
  pnpm nx run advisory-narrative-ctrl:test
  ```

  Expected: PASS.

- [ ] **Step 4: Commit.**

  ```bash
  git add services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts
  git commit -m "refactor(advisory-narrative-ctrl): drop escalationPath from retry options"
  ```

---

## Task 6: Strip `escalationPath` from market-intelligence graph

**Files:**
- Modify: `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts`

- [ ] **Step 1: Edit `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts:25`.** Change:

  ```typescript
      { maxAttempts: 3, escalationPath: ['sonnet'] },
  ```

  to:

  ```typescript
      { maxAttempts: 3 },
  ```

- [ ] **Step 2: Type-check the service.**

  ```bash
  pnpm nx run market-intelligence-ctrl:type-check
  ```

  Expected: PASS.

- [ ] **Step 3: Run service tests.**

  ```bash
  pnpm nx run market-intelligence-ctrl:test
  ```

  Expected: PASS.

- [ ] **Step 4: Commit.**

  ```bash
  git add services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts
  git commit -m "refactor(market-intelligence-ctrl): drop escalationPath from retry options"
  ```

---

## Task 7: Rename `extractModelTier` → `extractModelId` in agent-tracer (keep `escalatedFromTier` intact)

**Files:**
- Modify: `libs/agent-orchestrator/src/agent-tracer.ts`
- Modify: `libs/agent-orchestrator/test/agent-tracer.test.ts`

Note: This task ONLY renames + refactors the extractor. The `escalatedFromTier` envelope field, `TIER_RANK`, `lastTier`, and the rank-comparison block in `handleLLMEnd` stay — they're removed in Task 8. Splitting the rename from the field removal keeps each commit small and the tree green.

- [ ] **Step 1: Edit `libs/agent-orchestrator/src/agent-tracer.ts`.** Apply these changes:

  - Line 107 (`handleLLMStart`): change `const model = extractModelTier(llm, extraParams, metadata);` → `const model = extractModelId(llm, extraParams, metadata);`.
  - Lines 222-242: replace the entire `extractModelTier` function with `extractModelId`:

  ```typescript
  export function extractModelId(
    llm: Serialized | undefined,
    extraParams?: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): string {
    if (!llm) return 'unknown';
    const kwargs = (llm as { kwargs?: { model?: string; modelName?: string; model_id?: string } }).kwargs;
    const kwargsModelId = kwargs?.model ?? kwargs?.modelName ?? kwargs?.model_id ?? '';
    if (kwargsModelId) return kwargsModelId;
    // Secondary: LangChain's tracing metadata often carries the model id under
    // ls_model_name (LangSmith convention) or invocation_params.model.
    const fromExtra = pickModelIdFromBag(extraParams);
    if (fromExtra) return fromExtra;
    const fromMeta = pickModelIdFromBag(metadata);
    if (fromMeta) return fromMeta;
    return 'unknown';
  }

  function pickModelIdFromBag(bag: Record<string, unknown> | undefined): string | undefined {
    if (!bag) return undefined;
    const direct = (bag as { model?: string; ls_model_name?: string }).model
      ?? (bag as { ls_model_name?: string }).ls_model_name;
    if (typeof direct === 'string' && direct) return direct;
    const invocation = (bag as { invocation_params?: { model?: string } }).invocation_params;
    if (invocation?.model) return invocation.model;
    return undefined;
  }
  ```

  - Lines 244-249: delete the entire `classifyTier` function.

  Leave intact for now: the `ModelTier` import on line 4, the envelope field on lines 15 and 23, `TIER_RANK` on line 47, `pendingLlm` value type on line 57, `lastTier` field on line 64, the rank-comparison block in `handleLLMEnd` on lines 118-127, and the `escalatedFromTier` field in `this.llmCalls.push({...})` on line 135. Those are Task 8.

  **However**, the envelope field type and `pendingLlm` value type both reference `ModelTier | 'unknown'`. After this task, `extractModelId` returns `string`, but `pendingLlm.model` is still typed `ModelTier | 'unknown'` and `'gen_ai.request.model'` likewise. The `this.pendingLlm.set(runId, { model, … })` on line 108 will trigger a type error: `string` is not assignable to `ModelTier | 'unknown'`.

  To bridge cleanly without growing this task: widen the `pendingLlm` value type and the `'gen_ai.request.model'` envelope field to `string` in this task, but KEEP `escalatedFromTier?: ModelTier` and `TIER_RANK`/`lastTier` for now. Specifically:

  - Line 15: change `'gen_ai.request.model': ModelTier | 'unknown';` → `'gen_ai.request.model': string;`. Update the surrounding comment from the closed-set framing to "raw Bedrock model id; `'unknown'` when extraction fails."
  - Line 57: change `private readonly pendingLlm = new Map<string, { model: ModelTier | 'unknown'; startedAtMs: number; node?: string }>();` → `… { model: string; startedAtMs: number; node?: string };`.
  - Line 64: change `private lastTier?: ModelTier | 'unknown';` → `private lastTier?: string;`.
  - In `handleLLMEnd` (lines 122-127), the rank comparison uses `TIER_RANK[cur]` where `cur` is now `string`. Change the comparison to bail out for non-tier strings:

  ```typescript
      // Rank-based escalation: only set when BOTH ids parse to a known tier AND
      // the new tier strictly outranks the previous one. Until escalatedFromTier
      // is removed entirely in the next task, this gate keeps the feature
      // working for tier-named models and gracefully degrades to `undefined`
      // for non-tier ids (Nova/Llama/etc).
      const prev = this.lastTier;
      const cur = pending.model;
      const prevTier = prev && prev !== 'unknown' ? tierOf(prev) : undefined;
      const curTier = cur && cur !== 'unknown' ? tierOf(cur) : undefined;
      const escalatedFromTier =
        prevTier && curTier && TIER_RANK[curTier] > TIER_RANK[prevTier]
          ? prevTier
          : undefined;
  ```

  Add a small helper at file scope (e.g. just above `TIER_RANK`):

  ```typescript
  function tierOf(modelId: string): ModelTier | undefined {
    if (modelId.includes('haiku')) return 'haiku';
    if (modelId.includes('sonnet')) return 'sonnet';
    if (modelId.includes('opus')) return 'opus';
    return undefined;
  }
  ```

  This helper exists ONLY for the duration of this task; Task 8 removes it along with `TIER_RANK` and `lastTier`.

- [ ] **Step 2: Edit `libs/agent-orchestrator/test/agent-tracer.test.ts`.** Apply these changes (the `escalatedFromTier` tests at lines 117-152 stay until Task 8):

  - Line 1: change `import { AgentTracer, extractNodeName, extractModelTier, extractToolName } from '../src/agent-tracer';` → `import { AgentTracer, extractNodeName, extractModelId, extractToolName } from '../src/agent-tracer';`.
  - Replace the entire `it('extractModelTier maps Bedrock inference profile ids to tier names', …)` block at lines 30-37 with:

  ```typescript
    it('extractModelId returns the raw Bedrock inference profile id (kwargs.model path)', () => {
      expect(extractModelId({ kwargs: { model: 'us.anthropic.claude-haiku-4-5' } } as any))
        .toBe('us.anthropic.claude-haiku-4-5');
      expect(extractModelId({ kwargs: { model: 'us.anthropic.claude-opus-4-7' } } as any))
        .toBe('us.anthropic.claude-opus-4-7');
      expect(extractModelId({ kwargs: { model: 'us.anthropic.claude-sonnet-4-6' } } as any))
        .toBe('us.anthropic.claude-sonnet-4-6');
      expect(extractModelId({ kwargs: {} } as any)).toBe('unknown');
      // Non-Claude models: previously classified as 'unknown'; now returned raw.
      expect(extractModelId({ kwargs: { model: 'us.amazon.nova-pro-v1:0' } } as any))
        .toBe('us.amazon.nova-pro-v1:0');
    });
  ```

  - Replace the `it('extractModelTier falls back to extraParams and metadata …', …)` block at lines 38-55 with:

  ```typescript
    it('extractModelId falls back to extraParams.invocation_params.model and metadata.ls_model_name when kwargs.model is absent', () => {
      // ChatBedrockConverse invoked via withStructuredOutput omits kwargs.model;
      // LangChain surfaces the id via extraParams.invocation_params.model and
      // metadata.ls_model_name. Both paths must return the raw id verbatim.
      expect(
        extractModelId(
          { id: ['langchain', 'chat_models', 'RunnableSequence'] } as any,
          { invocation_params: { model: 'us.anthropic.claude-opus-4-6-v1' } },
        ),
      ).toBe('us.anthropic.claude-opus-4-6-v1');
      expect(
        extractModelId(
          { kwargs: {} } as any,
          undefined,
          { ls_model_name: 'us.anthropic.claude-sonnet-4-6' },
        ),
      ).toBe('us.anthropic.claude-sonnet-4-6');
    });
  ```

  - Inside `'records an LLM call with token usage from tokenUsage'` (line 100): change `expect(env.llmCalls[0]['gen_ai.request.model']).toBe('sonnet');` → `expect(env.llmCalls[0]['gen_ai.request.model']).toBe('us.anthropic.claude-sonnet-4-6');`. The `escalatedFromTier` assertion on line 117 STAYS (Task 8 removes it).
  - In `'records escalatedFromTier when successive LLM calls escalate upward'` (line 120-129) and `'leaves escalatedFromTier undefined when tier de-escalates …'` (line 131-141) and `'leaves escalatedFromTier undefined when either tier is unknown'` (line 143-152): keep the model fixtures as `'haiku-x'`, `'sonnet-x'`, `'opus-x'`, `'nova-pro'` (they still match the `includes('haiku')` etc. helper) — only Task 8 deletes these blocks.
  - In `'attributes LLM calls to the correct node when two nodes run in parallel'` (lines 154-173): change `expect(byNode['nodeA']['gen_ai.request.model']).toBe('sonnet');` → `expect(byNode['nodeA']['gen_ai.request.model']).toBe('sonnet-x');` and `expect(byNode['nodeB']['gen_ai.request.model']).toBe('haiku');` → `expect(byNode['nodeB']['gen_ai.request.model']).toBe('haiku-x');`. The fixtures use the suffixed strings — assertions now check the raw value, not the classified tier.
  - In `'leaves escalatedFromTier undefined when either tier is unknown'` at line 150: change `expect(env.llmCalls[0]['gen_ai.request.model']).toBe('unknown');` → `expect(env.llmCalls[0]['gen_ai.request.model']).toBe('nova-pro');` (raw id now flows through). The trailing `expect(env.llmCalls[1].escalatedFromTier).toBeUndefined();` on line 151 STAYS — the escalation gate's `tierOf('nova-pro')` returns `undefined`, so `escalatedFromTier` is still undefined.

- [ ] **Step 3: Run agent-tracer tests.**

  ```bash
  pnpm nx run agent-orchestrator:test --testPathPatterns=agent-tracer.test.ts
  ```

  Expected: PASS.

- [ ] **Step 4: Run full lib test + type-check.**

  ```bash
  pnpm nx run agent-orchestrator:test
  pnpm nx run agent-orchestrator:type-check
  ```

  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add libs/agent-orchestrator/src/agent-tracer.ts libs/agent-orchestrator/test/agent-tracer.test.ts
  git commit -m "refactor(agent-orchestrator): rename extractModelTier → extractModelId; envelope carries raw model id"
  ```

---

## Task 8: Remove `escalatedFromTier` end-to-end (agent-tracer + invoke-orchestrator + tests)

**Files:**
- Modify: `libs/agent-orchestrator/src/agent-tracer.ts`
- Modify: `libs/agent-orchestrator/src/invoke-orchestrator.ts`
- Modify: `libs/agent-orchestrator/test/agent-tracer.test.ts`

- [ ] **Step 1: Edit `libs/agent-orchestrator/src/agent-tracer.ts`.** Apply these deletions and edits:

  - Line 4: delete `import type { ModelTier } from './types';` (the `ModelTier` symbol is no longer referenced after this task; this removes the last consumer).
  - Lines 20-23: delete the `escalatedFromTier?: ModelTier;` field and its 4-line comment from the `llmCalls` array element type.
  - Line ~46 (depending on whether Task 7 added the `tierOf` helper above or below `TIER_RANK`): delete the `tierOf(modelId)` helper added in Task 7.
  - Line 47: delete `const TIER_RANK: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };` and its preceding 2-line comment.
  - Line 64: delete `private lastTier?: string;`.
  - In `handleLLMEnd` (lines 118-127 of the original file, lines after Task 7 may have drifted — match by content): delete the `// Rank-based escalation: …` comment block AND the `const prev = …; const cur = …; const prevTier = …; const curTier = …; const escalatedFromTier = …;` derivation (everything from the comment down to but not including the `this.llmCalls.push({...})` call).
  - In the `this.llmCalls.push({...})` call: drop the `escalatedFromTier,` field from the object literal.
  - Right after `this.llmCalls.push({...})`: delete `this.lastTier = pending.model;`.

  After these edits, `agent-tracer.ts` has no remaining reference to `ModelTier`, `TIER_RANK`, `lastTier`, `tierOf`, or `escalatedFromTier`.

- [ ] **Step 2: Edit `libs/agent-orchestrator/src/invoke-orchestrator.ts`.** In the `perCall` array map at lines 54-61, delete the `escalatedFromTier: call.escalatedFromTier,` line:

  ```typescript
        perCall: envelope.llmCalls.map((call) => ({
          node: call.nodeName,
          model: call['gen_ai.request.model'],
          inputTokens: call['gen_ai.usage.input_tokens'],
          outputTokens: call['gen_ai.usage.output_tokens'],
          latencyMs: call.latencyMs,
        })),
  ```

- [ ] **Step 3: Edit `libs/agent-orchestrator/test/agent-tracer.test.ts`.** Apply these changes:

  - Delete the `expect(env.llmCalls[0].escalatedFromTier).toBeUndefined();` line inside the `'records an LLM call with token usage from tokenUsage'` test (was line 117 in the original).
  - Delete the entire `it('records escalatedFromTier when successive LLM calls escalate upward', …)` block (was lines 120-129).
  - Delete the entire `it('leaves escalatedFromTier undefined when tier de-escalates …', …)` block (was lines 131-141).
  - Delete the entire `it('leaves escalatedFromTier undefined when either tier is unknown', …)` block (was lines 143-152).

- [ ] **Step 4: Run agent-tracer tests.**

  ```bash
  pnpm nx run agent-orchestrator:test --testPathPatterns=agent-tracer.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Run invoke-orchestrator tests.**

  ```bash
  pnpm nx run agent-orchestrator:test --testPathPatterns=invoke-orchestrator.test.ts
  ```

  Expected: PASS (plan-time grep confirmed no `escalatedFromTier` references in that test file; if a spillover exists, delete the assertion inline).

- [ ] **Step 6: Run full lib test + type-check.**

  ```bash
  pnpm nx run agent-orchestrator:test
  pnpm nx run agent-orchestrator:type-check
  ```

  Expected: PASS.

- [ ] **Step 7: Commit.**

  ```bash
  git add libs/agent-orchestrator/src/agent-tracer.ts libs/agent-orchestrator/src/invoke-orchestrator.ts libs/agent-orchestrator/test/agent-tracer.test.ts
  git commit -m "refactor(agent-orchestrator): remove escalatedFromTier envelope field + projection"
  ```

---

## Task 9: Delete `tier-escalation.ts` + its test + remove from `index.ts`

**Files:**
- Delete: `libs/agent-orchestrator/src/tier-escalation.ts`
- Delete: `libs/agent-orchestrator/test/tier-escalation.test.ts`
- Modify: `libs/agent-orchestrator/src/index.ts`

- [ ] **Step 1: Delete the source and test files.**

  ```bash
  git rm libs/agent-orchestrator/src/tier-escalation.ts libs/agent-orchestrator/test/tier-escalation.test.ts
  ```

- [ ] **Step 2: Edit `libs/agent-orchestrator/src/index.ts`** — delete line 27: `export { buildEscalationPath } from './tier-escalation';`.

- [ ] **Step 3: Run full lib test + type-check.**

  ```bash
  pnpm nx run agent-orchestrator:test
  pnpm nx run agent-orchestrator:type-check
  ```

  Expected: PASS. Plan-time grep confirmed `buildEscalationPath` has no callers outside the now-edited `create-orchestrator.ts`.

- [ ] **Step 4: Commit.**

  ```bash
  git add libs/agent-orchestrator/src/index.ts
  git commit -m "refactor(agent-orchestrator): delete tier-escalation.ts and its test"
  ```

  The `git rm` from Step 1 already staged the deletes; this commit includes them along with the index.ts edit.

---

## Task 10: Drop `ModelTier` type + `RetryOptions.escalationPath` from `types.ts` and `index.ts`

**Files:**
- Modify: `libs/agent-orchestrator/src/types.ts`
- Modify: `libs/agent-orchestrator/src/index.ts`

- [ ] **Step 1: Edit `libs/agent-orchestrator/src/types.ts`.** Two changes:

  - Delete line 14: `export type ModelTier = 'haiku' | 'sonnet' | 'opus';`.
  - In `RetryOptions` (lines 16-19), delete the `readonly escalationPath?: ModelTier[];` field:

  ```typescript
  export interface RetryOptions {
    readonly maxAttempts: number;
  }
  ```

- [ ] **Step 2: Edit `libs/agent-orchestrator/src/index.ts`** — delete `type ModelTier,` from the `export { … } from './types';` block (was line 6).

- [ ] **Step 3: Full lib type-check.**

  ```bash
  pnpm nx run agent-orchestrator:type-check
  ```

  Expected: PASS. At this point no source file in the lib or in services references `ModelTier` or `escalationPath`.

- [ ] **Step 4: Full lib test target.**

  ```bash
  pnpm nx run agent-orchestrator:test
  ```

  Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git add libs/agent-orchestrator/src/types.ts libs/agent-orchestrator/src/index.ts
  git commit -m "refactor(agent-orchestrator): drop ModelTier type + RetryOptions.escalationPath"
  ```

---

## Task 11: Delete CDK wiring for `AGENT_MODEL_OVERRIDE` in `agent-runtime.ts`

**Files:**
- Modify: `libs/cdk-constructs/src/extensions/agent-runtime.ts`

- [ ] **Step 1: Edit `libs/cdk-constructs/src/extensions/agent-runtime.ts`.**

  - Delete lines 55-63 (the 5-line doc comment + the `overrideContext` lookup + the `overrideEnv` ternary):

  ```typescript
      // Temporary cost-cap downgrade override. Read once at synth time from CDK
      // context (`--context agentModelOverride=haiku`) and merged into the
      // runtime container's env. Consumed by libs/agent-orchestrator's
      // applyOverride() helper. Unset = no-op. Per-AgentRuntime overrides via
      // props.environmentVariables win over the context value.
      const overrideContext = scope.node.tryGetContext('agentModelOverride');
      const overrideEnv: Record<string, string> = overrideContext
        ? { AGENT_MODEL_OVERRIDE: String(overrideContext) }
        : {};
  ```

  - On line 78, change `environmentVariables: { ...overrideEnv, ...props.environmentVariables },` → `environmentVariables: { ...props.environmentVariables },`.

- [ ] **Step 2: Type-check + lint cdk-constructs.**

  ```bash
  pnpm nx run cdk-constructs:type-check
  pnpm nx run cdk-constructs:lint
  ```

  Expected: both PASS. Per spec §4.9: if lint trips on `scope` being unused inside the constructor body, leave `scope` as-is (it's still received as a ctor arg and passed to `super(scope, id)`); the lint rules should not flag a parameter used in `super()`. If lint DOES flag it, add a one-line `// scope used by super()` comment rather than refactoring further.

- [ ] **Step 3: Run cdk-constructs tests.**

  ```bash
  pnpm nx run cdk-constructs:test
  ```

  Expected: PASS.

- [ ] **Step 4: Commit.**

  ```bash
  git add libs/cdk-constructs/src/extensions/agent-runtime.ts
  git commit -m "refactor(cdk-constructs): drop AGENT_MODEL_OVERRIDE CDK wiring from AgentRuntime"
  ```

---

## Task 12: Update stale `MODEL_ID_MAP.sonnet` comment in onboarding-bff

**Files:**
- Modify: `services/investor/onboarding-bff/agents/onboarding/graph.ts`

- [ ] **Step 1: Edit `services/investor/onboarding-bff/agents/onboarding/graph.ts`.** Find the comment at line 39 referencing `MODEL_ID_MAP.sonnet` in `libs/agent-orchestrator/src/agent-factory.ts`. Replace the multi-line comment block (lines 36-39) with an updated version that points at the per-service binding instead:

  ```typescript
      // Bedrock requires inference profile IDs (the `us.` prefix) for Claude
      // Sonnet 4.x in us-east-1; passing a base model id returns
      // `ValidationException` with no message body. The default below mirrors
      // the explicit `modelId` strings used by the advisory AgentConfigs in
      // services/advisory/*/src/agents/*.config.ts.
  ```

  This task does NOT touch the `overrideTier`/`ONBOARDING_OVERRIDE_MAP` logic on lines 33-34 — onboarding-bff's own model override is out of scope.

- [ ] **Step 2: Type-check onboarding-bff.**

  ```bash
  pnpm nx run onboarding-bff:type-check
  ```

  Expected: PASS (comment-only change).

- [ ] **Step 3: Commit.**

  ```bash
  git add services/investor/onboarding-bff/agents/onboarding/graph.ts
  git commit -m "docs(onboarding-bff): update stale MODEL_ID_MAP.sonnet comment reference"
  ```

---

## Task 13: Update closed-set tier assertions in advisory e2e tests

**Files:**
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts`

Surfaced during Task 1 diligence: two e2e files assert `gen_ai.request.model` against the closed-set tier literals (`'haiku'`, `'sonnet'`, `'opus'`). After this refactor the envelope field carries the raw Bedrock model id. The `/backlog-next` closing-phase scoped e2e gate would fail unless these flip in the same PR. See spec §7 step 1c.

- [ ] **Step 1: Edit `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts:78`.**

  The narrative agent uses `explainabilityConfig` (haiku). Change:

  ```typescript
      expect(narrative.llmCalls[0]['gen_ai.request.model']).toBe('haiku');
  ```

  to (raw inference-profile id, must match the `modelId` value in `services/advisory/advisory-narrative-ctrl/src/agents/explainability.config.ts`):

  ```typescript
      expect(narrative.llmCalls[0]['gen_ai.request.model']).toBe(
        'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      );
  ```

  Verify the config's `modelId` before committing. If `explainability.config.ts` has been edited since this plan was written, use the string IS in the config — assertion must mirror production, not a hardcoded guess.

- [ ] **Step 2: Edit `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts:95-96`.**

  The portfolio-engine trap captures both portfolio-engine agents (`portfolio-construction` = opus, `rebalance-planner` = sonnet). Change:

  ```typescript
      const models = new Set(envelope.llmCalls.map((l) => l['gen_ai.request.model']));
      expect(models.has('opus') || models.has('sonnet')).toBe(true);
  ```

  to:

  ```typescript
      const models = new Set(envelope.llmCalls.map((l) => l['gen_ai.request.model']));
      expect(
        models.has('us.anthropic.claude-opus-4-6-v1') ||
          models.has('us.anthropic.claude-sonnet-4-6'),
      ).toBe(true);
  ```

  Verify each agent's actual `modelId` in `services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts` and `…/rebalance-planner.config.ts`. The intent is "either of the portfolio-engine agents' models shows up in the trace" — it must still pass with the production strings.

- [ ] **Step 3: Confirm no other e2e test asserts on the closed-set tier vocabulary.**

  ```bash
  grep -rn "gen_ai\.request\.model" apps/ services/ libs/ 2>/dev/null \
    | grep -v dist | grep -v node_modules | grep -v test/agent-tracer
  ```

  Expected after Steps 1-2: only the two e2e files just updated + production usage in `libs/agent-orchestrator/src/agent-tracer.ts` and `libs/agent-orchestrator/src/invoke-orchestrator.ts`. Any other test asserting on the closed-set literals → flag and apply the same flip.

- [ ] **Step 4: Type-check the e2e project.**

  ```bash
  pnpm nx run e2e-feature-tests:type-check
  ```

  Expected: PASS. E2E tests do not run locally — they fire in the closing-phase scoped gate against deployed dev.

- [ ] **Step 5: Commit.**

  ```bash
  git add apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts
  git commit -m "test(e2e): flip advisory gen_ai.request.model assertions to raw model ids"
  ```

---

## Task 14: Final CI gates — `nx affected` across the workstream

**Files:** none modified.

- [ ] **Step 1: Affected test target.**

  ```bash
  pnpm nx affected -t test --base=origin/main
  ```

  Expected: PASS. The affected set should include `agent-orchestrator`, `cdk-constructs`, `advisory-narrative-ctrl`, `market-intelligence-ctrl`, `onboarding-bff`, and any transitive consumers of `agent-orchestrator` (investor-profile-ctrl, portfolio-engine-ctrl) plus any consumers of `cdk-constructs`. Each project's test target must finish green.

- [ ] **Step 2: Affected lint target.**

  ```bash
  pnpm nx affected -t lint --base=origin/main
  ```

  Expected: PASS.

- [ ] **Step 3: Affected type-check target.**

  ```bash
  pnpm nx affected -t type-check --base=origin/main
  ```

  Expected: PASS.

- [ ] **Step 4: Spot-check that no orphan reference remains.**

  ```bash
  grep -rn "ModelTier\|escalationPath\|buildEscalationPath\|escalatedFromTier\|MODEL_ID_MAP\|extractModelTier\|tier-escalation" services/ libs/ infrastructure/ apps/ 2>/dev/null \
    | grep -v node_modules | grep -v dist
  ```

  Expected hits (allowed): only `services/investor/onboarding-bff/agents/onboarding/graph.ts:33-34` (onboarding-bff's `AGENT_MODEL_OVERRIDE` reader — out of scope) and `services/investor/onboarding-bff/src/service.stack.ts:127` (comment about onboarding-bff's own override — out of scope). Note: `AGENT_MODEL_OVERRIDE` is itself in scope for the advisory side and was deleted; this grep does not look for it.

  Run a separate grep for advisory-side `AGENT_MODEL_OVERRIDE`:

  ```bash
  grep -rn 'AGENT_MODEL_OVERRIDE\|agentModelOverride' libs/agent-orchestrator/ libs/cdk-constructs/ services/advisory/ 2>/dev/null \
    | grep -v node_modules | grep -v dist
  ```

  Expected: zero lines.

- [ ] **Step 5: No commit.** This task is verification only. If everything passes, the implementation is complete and the next phase (closing phase per `/backlog-next` §6: doc-derivation detection → deploy → scoped e2e → ship → branch finish) takes over.

---

## Self-review checklist (run before handing off to execution)

1. **Spec coverage.** Walk through `docs/superpowers/specs/2026-05-19-simplify-agent-orchestrator-model-knob-design.md`:
   - §4.1 (agent-factory.ts) — Task 3 ✓
   - §4.2 (types.ts) — Task 10 ✓
   - §4.3 (with-retry.ts) — Task 2 ✓
   - §4.4 (create-orchestrator.ts) — Task 4 ✓
   - §4.5 (tier-escalation.ts deletion) — Task 9 ✓
   - §4.6 (index.ts re-export cleanup) — Task 9 + Task 10 ✓
   - §4.7 (agent-tracer.ts) — Task 7 (rename half) + Task 8 (field-removal half) ✓
   - §4.7.1 (invoke-orchestrator.ts projection) — Task 8 ✓
   - §4.8 (service-side updates) — Tasks 5, 6, 12 ✓
   - §4.9 (CDK wiring deletion) — Task 11 ✓
   - §4.10 (tests) — split across Tasks 2, 3, 7, 8, 9 ✓
   - §5 (Validation) — `nx affected` covered by Task 14; e2e assertion flips covered by Task 13; deploy + scoped e2e run covered by `/backlog-next` closing phase
   - §7 (Implementation order) — followed bottom-up (consumers first, then symbols, then CDK, then comments) so every commit leaves the tree compile-clean
   - §7 step 1c (e2e closed-set tier assertions) — Task 13 (added after Task 1 diligence surfaced 2 e2e files asserting `'haiku'`/`'opus'`/`'sonnet'` literals)

2. **Placeholder scan.** Grep this plan file for placeholder patterns:

   ```bash
   grep -nE 'TODO|TBD|implement later|fill in details|appropriate error handling|edge cases|similar to task|describe what to do' docs/superpowers/plans/2026-05-19-simplify-agent-orchestrator-model-knob.md
   ```

   Expected: zero hits (other than this self-review section itself if a literal match shows up).

3. **Type consistency.** Names used across tasks:
   - `extractModelId` — introduced Task 7, used in Task 8 commit cleanup. ✓
   - `tierOf` — introduced Task 7 as a temporary bridge, removed in Task 8. ✓
   - `RetryOptions.escalationPath` — referenced as still-present in Tasks 2-9; dropped in Task 10. ✓
   - `extractModelTier` test import — updated to `extractModelId` in Task 7. ✓
   - `escalatedFromTier` envelope field — kept in Task 7; removed in Task 8. ✓

---

## Execution handoff

Plan complete. Next step inside the worktree is to execute via either:

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development`. Fresh subagent per task, review between tasks, fast iteration. Suits this plan well because tasks are small and largely independent after the first three.
2. **Inline Execution** — `superpowers:executing-plans`. Batch through the tasks in this session with checkpoints.

After the plan is executed and Task 13's `nx affected` passes, control returns to `/backlog-next` closing phase (§6.1 onward): doc-derivation detection → deploy + scoped e2e on dev → ship → regen index → finishing-a-development-branch → ExitWorktree → postflight.
