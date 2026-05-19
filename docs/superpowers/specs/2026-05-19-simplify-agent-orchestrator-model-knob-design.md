# Simplify agent-orchestrator model knob — design spec

**Date**: 2026-05-19
**Backlog**: `docs/backlog/simplify-agent-orchestrator-model-knob.md`
**Type**: design
**Follow-up**: implementation plan filed separately at writing-plans handoff. Unblocks `agent-benchmark-skill` (currently `status: parking`).

## 1. Context

`libs/agent-orchestrator/src/agent-factory.ts` carries two features that the user does not exercise in practice:

1. **Runtime tier escalation.** `withRetry` enriches state with `__escalationTier: 'haiku' | 'sonnet' | 'opus'`. `createAgentNode` reads that key and looks up a different model in `MODEL_ID_MAP`:

   ```typescript
   const effectiveModelId = state.__escalationTier
     ? MODEL_ID_MAP[state.__escalationTier] ?? modelId
     : applyOverride(modelId);
   ```

   Wired up in production through **two distinct paths**:

   **(a) Explicit `escalationPath` passed to manual `withRetry()` calls** in the 2 services whose `graph.ts` wires the retry stack by hand:
   - `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:24` — `escalationPath: ['sonnet', 'opus']`.
   - `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts:25` — `escalationPath: ['sonnet']`.

   **(b) Auto-computed `escalationPath` inside `createOrchestrator`** for the 2 services that go through it (`investor-profile-ctrl`, `portfolio-engine-ctrl`). At `libs/agent-orchestrator/src/create-orchestrator.ts:44-49`, for **every** agent the orchestrator infers a tier from the agent's `modelId` string and calls `buildEscalationPath(tier)` to produce a default escalationPath, then passes it to `withRetry` — overriding whatever the caller's `retryOptions.escalationPath` was. This means escalation fires implicitly for all 4 AgentConfigs across investor-profile-ctrl + portfolio-engine-ctrl:
   - `user-goals` (haiku) → auto-path `['haiku','sonnet','opus']`
   - `risk-assessment` (sonnet) → auto-path `['sonnet','opus']`
   - `portfolio-construction` (opus) → auto-path `['opus']` (no escalation possible — already at top)
   - `rebalance-planner` (sonnet) → auto-path `['sonnet','opus']`

   Net: escalation is wired up for **all 4 advisory services** (2 explicitly, 2 implicitly), covering all 6 AgentConfigs. Removing it touches every advisory pipeline.

2. **`AGENT_MODEL_OVERRIDE` cost-cap downgrade.** `applyOverride()` reads the env var and downgrades the resolved model with a smart-skip rule (opus sites exempt, never raises a tier). The doc-comment claims the var is set per-deploy via `cdk deploy --context agentModelOverride=haiku`. The wiring is **real, not stale** — `libs/cdk-constructs/src/extensions/agent-runtime.ts:55-63` reads `scope.node.tryGetContext('agentModelOverride')` at synth time and merges `AGENT_MODEL_OVERRIDE=<value>` into the AgentRuntime container's `environmentVariables` block (line 78). The feature is plumbed end-to-end. What we don't know yet is whether any deployed Lambda actually has the env var *set* today; verification step in §7.1 nails that down via `aws lambda get-function-configuration` on the 4 advisory runtimes. Expectation: no caller passes `--context agentModelOverride=` in `deploy.sh` so the dev value is empty — but this needs confirming, not assuming.

Together these force `MODEL_ID_MAP` to look like the source of model truth when it isn't — production defaults already live in each `*.config.ts`'s `modelId: string`. The `ModelTier` closed-set vocabulary (`'haiku'|'sonnet'|'opus'`) also doesn't compose with Nova/Llama/Mistral, which the upcoming `agent-benchmark-skill` workstream will surface as viable candidates for some tasks.

After this refactor: `*.config.ts modelId` is the only model knob. Full Bedrock model ID, used verbatim at runtime, no enrichment, no downgrade. Behaviour-preserving — every config keeps the model it has today.

## 2. Goals

1. Remove runtime tier escalation (`__escalationTier`, `escalationPath`, `buildEscalationPath`, `tier-escalation.ts`).
2. Remove the `AGENT_MODEL_OVERRIDE` machinery (`applyOverride`, `MODEL_ID_MAP`, `TIER_ORDER`, `detectTier`) and the `ModelTier` closed-set type.
3. Keep `withRetry`'s `maxAttempts` retry loop. Validation errors still trigger retries — just without changing the model.
4. Refactor `extractModelTier(...)` → `extractModelId(...)` so the AgentTracer's `gen_ai.request.model` field carries the raw model ID instead of mapping it to `'haiku' | 'sonnet' | 'opus' | 'unknown'`. Better observability for non-Claude models.
5. Preserve every other agent-orchestrator behaviour: `withValidation`, `createOrchestrator`, the `looksDegraded → REINFORCE_SUFFIX` retry guard, the `__retryFeedback` prompt augmentation, `RetryOptions.maxAttempts`, the `RunnableConfig` callback propagation, the full `WaveDefinition`/`OrchestratorConfig` API.

## 3. Out of scope

(Mirrors backlog `out_of_scope:`.)

- The benchmark skill itself (filed separately as `agent-benchmark-skill`).
- The `looksDegraded` / `REINFORCE_SUFFIX` schema-degraded retry path.
- The `withValidation` validation-rule retry path (`__retryFeedback` prompt augmentation).
- Replacing the haiku/sonnet/opus tier vocabulary with a different vocabulary. There is no replacement — the unit is `modelId: string` everywhere.
- Changing the production `modelId` of any AgentConfig. This refactor is strictly behaviour-preserving. Model-choice decisions land in the follow-on benchmark workstream.
- Adding a per-deploy override mechanism (env var, SSM, etc.). If a future need arises, design it then.
- Onboarding-bff's own model wiring.

## 4. Changes

### 4.1 `libs/agent-orchestrator/src/agent-factory.ts`

Before:

```typescript
import type { AgentConfig, ModelTier } from './types';
// ...
const MODEL_ID_MAP: Record<ModelTier, string> = { haiku: '...', sonnet: '...', opus: '...' };
const TIER_ORDER: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];
function detectTier(modelId: string): ModelTier | null { /* ... */ }
function applyOverride(modelId: string): string { /* AGENT_MODEL_OVERRIDE logic */ }

export function createAgentNode<T extends z.ZodType>(config: AgentConfig<T>): AgentNodeFn {
  const { modelId, maxTokens, temperature, schema, promptTemplate } = config;
  return async (state, runnableConfig) => {
    const effectiveModelId = state.__escalationTier
      ? MODEL_ID_MAP[state.__escalationTier as ModelTier] ?? modelId
      : applyOverride(modelId);
    const llm = new ChatBedrockConverse({ model: effectiveModelId, ... });
    // ... rest unchanged: structured output, looksDegraded, REINFORCE_SUFFIX retry ...
  };
}
```

After:

```typescript
import type { AgentConfig } from './types';
// no ModelTier import, no MODEL_ID_MAP, no TIER_ORDER, no detectTier, no applyOverride

export function createAgentNode<T extends z.ZodType>(config: AgentConfig<T>): AgentNodeFn {
  const { modelId, maxTokens, temperature, schema, promptTemplate } = config;
  return async (state, runnableConfig) => {
    const llm = new ChatBedrockConverse({ model: modelId, maxTokens, temperature, region: 'us-east-1' });
    // ... rest unchanged ...
  };
}
```

Net deletion: lines 3 (drop `ModelTier` from the type-import), 7-42 (the MODEL_ID_MAP block, TIER_ORDER, detectTier, applyOverride + its multi-line comment at lines 26-31 that explicitly references `__escalationTier`), plus the `state.__escalationTier`/`applyOverride` block at lines 85-87 which collapses to just `model: modelId`.

### 4.2 `libs/agent-orchestrator/src/types.ts`

Delete:

```typescript
export type ModelTier = 'haiku' | 'sonnet' | 'opus';
```

Update `RetryOptions`:

```typescript
// before
export interface RetryOptions {
  readonly maxAttempts: number;
  readonly escalationPath?: ModelTier[];
}

// after
export interface RetryOptions {
  readonly maxAttempts: number;
}
```

### 4.3 `libs/agent-orchestrator/src/with-retry.ts`

Before (relevant lines):

```typescript
const { maxAttempts, escalationPath } = options;
// ...
if (escalationPath && attempt > 0 && attempt < escalationPath.length) {
  enriched['__escalationTier'] = escalationPath[attempt];
}
```

After: drop `escalationPath` destructure and the `enriched['__escalationTier']` injection. `withRetry` becomes a pure retry-on-error loop bounded by `maxAttempts`. The `__retryFeedback` enrichment (set by `withValidation` via `ValidationError.feedback`) is independent and stays.

### 4.4 `libs/agent-orchestrator/src/create-orchestrator.ts`

Before (around line 47-49):

```typescript
const escalationPath = buildEscalationPath(tier as any);
// ...
bareNode = withRetry(bareNode, { ...defaultRetry, escalationPath });
```

After: drop both lines. `withRetry` is called with just `{ ...defaultRetry }` (which is `{ maxAttempts }`).

### 4.5 `libs/agent-orchestrator/src/tier-escalation.ts`

Delete the entire file. `buildEscalationPath` has no other callers.

### 4.6 `libs/agent-orchestrator/src/index.ts`

Drop `ModelTier` from the type re-exports.

### 4.7 `libs/agent-orchestrator/src/agent-tracer.ts`

The AgentTracer emits envelopes with a model field. Public-surface change:

```typescript
// before
'gen_ai.request.model': ModelTier | 'unknown';
escalatedFromTier?: ModelTier;
const TIER_RANK: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };
export function extractModelTier(llm, extraParams?, metadata?): ModelTier | 'unknown' { ... }
function classifyTier(text: string): ModelTier | 'unknown' { ... }

// after
'gen_ai.request.model': string;  // raw model ID, e.g. 'us.anthropic.claude-sonnet-4-6' or 'unknown'
// escalatedFromTier removed entirely — escalation no longer exists
// TIER_RANK removed entirely
// classifyTier removed entirely
export function extractModelId(llm, extraParams?, metadata?): string {
  // same extraction logic (kwargs.model → extraParams → metadata.ls_model_name)
  // but returns the raw model id string. Returns 'unknown' only when no candidate found.
}
```

**Internal cleanup inside the class** (also required — not just the exported symbols). Line refs below are spec-time anchors; during implementation match by content, not by line number, since unrelated edits may have drifted the file:

- Line 4: drop `import type { ModelTier } from './types';`.
- Line 47: delete `const TIER_RANK: Record<ModelTier, number> = { ... };`.
- Line 57 (`pendingLlm`): change the value type from `{ model: ModelTier | 'unknown'; … }` to `{ model: string; … }`.
- Line 64: delete `private lastTier?: ModelTier | 'unknown';` entirely — it exists ONLY to power the rank comparison and has no other readers.
- Line 107: `extractModelTier(...)` → `extractModelId(...)`.
- Lines 118-127 (`handleLLMEnd`): delete the entire `// Rank-based escalation: …` comment block AND the `const prev = this.lastTier; const cur = pending.model; const escalatedFromTier = ...` derivation.
- Line 135: drop the `escalatedFromTier,` field from the `this.llmCalls.push({...})` literal.
- Line 137: delete `this.lastTier = pending.model;`.
- Lines 222-244: `extractModelTier` and `classifyTier` function bodies — rename `extractModelTier` → `extractModelId`, delete `classifyTier`, and have `extractModelId` return the raw string directly (the candidate text) or `'unknown'` only when no candidate is found.

### 4.7.1 `libs/agent-orchestrator/src/invoke-orchestrator.ts`

`invoke-orchestrator.ts:60` projects the now-deleted `escalatedFromTier` field into the per-call summary written to the structured log:

```typescript
// before (lines 54-61)
perCall: envelope.llmCalls.map((call) => ({
  node: call.nodeName,
  model: call['gen_ai.request.model'],
  inputTokens: call['gen_ai.usage.input_tokens'],
  outputTokens: call['gen_ai.usage.output_tokens'],
  latencyMs: call.latencyMs,
  escalatedFromTier: call.escalatedFromTier,
})),

// after
perCall: envelope.llmCalls.map((call) => ({
  node: call.nodeName,
  model: call['gen_ai.request.model'],
  inputTokens: call['gen_ai.usage.input_tokens'],
  outputTokens: call['gen_ai.usage.output_tokens'],
  latencyMs: call.latencyMs,
})),
```

This is the only other consumer of `escalatedFromTier` outside the tracer. After this delete, the field is gone from both definition and projection — type-check passes only when both edits land together.

**Behaviour change worth flagging explicitly**: today, Nova / Llama / Mistral model IDs hit `classifyTier`'s fallback and emit `'unknown'`. After the refactor they emit their raw ID (e.g. `'us.amazon.nova-pro-v1:0'`, `'meta.llama-3-3-70b-instruct-v1:0'`). Any downstream filter that treats `gen_ai.request.model === 'unknown'` as "unsupported / discard" will start KEEPING those rows. The verification grep below should catch consumers; if any are found, they need to be updated in the same PR.

```bash
grep -rn "'unknown'\\|\"unknown\"" services/ libs/ infrastructure/ tools/ 2>/dev/null \
  | grep -i 'model\\|tier\\|gen_ai' | grep -v dist | grep -v node_modules
```

Also verify no telemetry pipeline aggregates on the literals `'haiku'`, `'sonnet'`, `'opus'` as values of `gen_ai.request.model`:

```bash
grep -rn "gen_ai\\.request\\.model" services/ libs/ infrastructure/ tools/ 2>/dev/null \
  | grep -v dist | grep -v node_modules
```

Expected at spec time: no consumer reads outside `libs/agent-orchestrator/src/agent-tracer.ts` and its tests.

### 4.8 Service-side updates

- `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:24`:
  ```typescript
  // before
  { maxAttempts: 2, escalationPath: ['sonnet', 'opus'] }
  // after
  { maxAttempts: 2 }
  ```
- `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts:25`:
  ```typescript
  // before
  { maxAttempts: 3, escalationPath: ['sonnet'] }
  // after
  { maxAttempts: 3 }
  ```
- `services/investor/onboarding-bff/agents/onboarding/graph.ts:39`: stale comment references `MODEL_ID_MAP.sonnet`. Replace with a comment pointing at the explicit `modelId` binding used by onboarding-bff's own LLM call.

### 4.9 CDK / infrastructure cleanup — concrete deletion

`libs/cdk-constructs/src/extensions/agent-runtime.ts` has real wiring (verified by `grep -rn 'AGENT_MODEL_OVERRIDE\|agentModelOverride' libs/cdk-constructs infrastructure/`), not just a stale comment. Delete it as follows:

```typescript
// DELETE lines 55-63 entirely:
//   - the 5-line doc comment at 55-59 ("Temporary cost-cap downgrade override. …")
//   - the `overrideContext` lookup at line 60
//   - the `overrideEnv` ternary at lines 61-63
const overrideContext = scope.node.tryGetContext('agentModelOverride');
const overrideEnv: Record<string, string> = overrideContext
  ? { AGENT_MODEL_OVERRIDE: String(overrideContext) }
  : {};

// And in the Runtime constructor (line 78), change:
environmentVariables: { ...overrideEnv, ...props.environmentVariables },
// to:
environmentVariables: { ...props.environmentVariables },
```

`scope` is no longer referenced inside the constructor body after this delete (it's still received as the first ctor arg, and is passed implicitly through `super(scope, id)`); no further cleanup needed. Confirm with `pnpm nx run cdk-constructs:type-check` AND `pnpm nx run cdk-constructs:lint` — the latter catches `noUnusedParameters`/`@typescript-eslint/no-unused-vars` style trips if `scope` is in fact used elsewhere in the ctor (e.g., a CfnPolicy attach or `Tags.of(scope)` site that the spec didn't see). If lint trips, leave `scope` in place and add a one-line `// scope used by super()` comment rather than refactoring further.

The wider grep verification (`infrastructure/` apps and any other `libs/cdk-constructs/` site) stays as a pre-step in §7.2 — if a second site appears, it gets the same treatment as part of the same PR.

### 4.10 Tests

- `libs/agent-orchestrator/test/agent-factory.test.ts`:
  - Delete the entire `describe('createAgentNode — AGENT_MODEL_OVERRIDE (cost-cap downgrade)')` block (~lines 95–225, including `process.env` setup/teardown).
  - Delete the two `__escalationTier` test cases (line 55 `'uses __escalationTier to override model when present in state'`, line 196 `'__escalationTier on state wins over AGENT_MODEL_OVERRIDE'`).
  - Keep all other tests (config wiring, structured-output retry, etc.).
- `libs/agent-orchestrator/test/with-retry.test.ts`:
  - Delete the two `__escalationTier`-related `it()` blocks (around lines 39 and 63 — match by content: any `it()` whose body references `escalationPath` or `__escalationTier`).
  - Keep tests for `maxAttempts` retry behaviour, validation-error propagation, `__retryFeedback` augmentation.
  - **Add a regression test** asserting that on a `ValidationError` thrown by the wrapped node, the next attempt receives `state.__retryFeedback` populated with the error's `feedback` payload. Goal 5 preserves this path; the regression test makes the preservation explicit so a future cleanup pass can't silently sever the `withValidation` → `withRetry` feedback loop. Use the existing test harness pattern in the file (mock node that throws `ValidationError` on first call, captures `state` on second call).
- `libs/agent-orchestrator/test/agent-tracer.test.ts`:
  - Rename test descriptions referring to `extractModelTier` → `extractModelId` (currently at lines ~30 and ~38).
  - Update assertions: instead of `.toBe('haiku')`, assert `.toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0')` (raw ID, matching the value in the deleted `MODEL_ID_MAP`). Add a Nova case to confirm `extractModelId` returns `'us.amazon.nova-pro-v1:0'`, not `'unknown'` — currently this case (test file line 36) asserts `'unknown'` and must flip.
  - **Delete the four `escalatedFromTier` test blocks** entirely (NOT rename): currently at lines 117 (`expect(env.llmCalls[0].escalatedFromTier).toBeUndefined()`), 120 (`'records escalatedFromTier when successive LLM calls escalate upward'`), 131 (`'leaves escalatedFromTier undefined when tier de-escalates …'`), 143 (`'leaves escalatedFromTier undefined when either tier is unknown'`). The field no longer exists on the envelope, so these tests can't survive — they're not behaviour we want to preserve; the escalation feature itself is being removed.
- `libs/agent-orchestrator/test/tier-escalation.test.ts`: delete the entire file alongside `tier-escalation.ts` (file confirmed to exist).
- `libs/agent-orchestrator/test/create-orchestrator.test.ts`: drop any escalation-path-related assertions; keep wave-orchestration + retry-wiring assertions.
- `libs/agent-orchestrator/test/invoke-orchestrator.test.ts`: spec-time grep for `escalatedFromTier|escalationPath|ModelTier` returned no hits — no edits expected. Re-grep during implementation as a sanity check; any new hit gets deleted.

## 5. Validation

- `pnpm nx affected --target=test` passes.
- `pnpm nx affected --target=type-check` passes.
- `pnpm nx affected --target=lint` passes.
- `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl` succeeds.
- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` passes against deployed dev. Chosen because it exercises the full advisory pipeline (investor-profile + market-intelligence + portfolio-engine + advisory-narrative) — covers all 4 services whose retry/escalation wiring this refactor touches.

## 6. Risks

| Risk | Mitigation |
|---|---|
| `__escalationTier` was actually firing in production for some failure mode we don't know about | Escalation is wired in 4 services (see §1). Verified per-service behaviour, traced against the real `withRetry` semantics (condition `attempt > 0 && attempt < escalationPath.length`; `escalationPath[0]` is structurally dead because attempt 0 always uses `config.modelId`). Both `investor-profile-ctrl` and `portfolio-engine-ctrl` pass `retryOptions: { maxAttempts: 3 }` to `createOrchestrator`, so the auto-path is exercised across **3 attempts**:<br/>• **advisory-narrative** (haiku, `maxAttempts: 2`, explicit `['sonnet','opus']`): attempt 0 → haiku; attempt 1 → `escalationPath[1] = 'opus'`. Two attempts total. Actual escalation is **haiku→opus** (sonnet at `[0]` is never read).<br/>• **market-intelligence** (sonnet, `maxAttempts: 3`, explicit `['sonnet']`): condition `attempt < 1` never holds for `attempt ≥ 1`. All 3 attempts run at sonnet. The path is **entirely dead config**.<br/>• **investor-profile / user-goals** (haiku, auto-path `['haiku','sonnet','opus']`, `maxAttempts: 3`): attempt 0 → haiku, attempt 1 → sonnet, attempt 2 → opus. Three different models — the only site where the auto-path is fully exercised.<br/>• **investor-profile / risk-assessment** (sonnet, auto-path `['sonnet','opus']`, `maxAttempts: 3`): attempt 0 → sonnet, attempt 1 → opus, attempt 2 → condition fails (`2 < 2` false) → **back to sonnet**. Pattern: **sonnet → opus → sonnet** (a single-shot opus retry sandwiched between two sonnet attempts).<br/>• **portfolio-engine / portfolio-construction** (opus, auto-path `['opus']`, `maxAttempts: 3`): condition never holds. All 3 attempts at opus. Dead.<br/>• **portfolio-engine / rebalance-planner** (sonnet, auto-path `['sonnet','opus']`, `maxAttempts: 3`): same as risk-assessment — **sonnet → opus → sonnet**.<br/>If retry-and-escalate currently rescues the cycle from a real failure (most plausibly in advisory-narrative, user-goals, or the opus-retry slot of risk-assessment / rebalance-planner), removing it could regress. Verify by CloudWatch Logs Insights query in §7 step 1 BEFORE removing the code. If any envelope shows `escalatedFromTier !== undefined`, surface to the user as a workstream-scope risk. |
| Downstream telemetry consumes `gen_ai.request.model` as the closed set | Grep across the repo + cloud config for any aggregation on literal `'haiku'\|'sonnet'\|'opus'` values of that field. None found at spec time. |
| CDK wiring of AGENT_MODEL_OVERRIDE exists and the env var may be SET on deployed runtimes | Confirmed wiring at `libs/cdk-constructs/src/extensions/agent-runtime.ts:55-63,78` (NOT stale). Deletion plan spelled out in §4.9. Step §7.1 inspects `aws lambda get-function-configuration --function-name <agentcore-runtime>` for each of the 4 advisory runtimes to check whether `AGENT_MODEL_OVERRIDE` is currently populated. If it is non-empty on dev, that's a behaviour-change risk (the model running today differs from the `*.config.ts modelId`); surface to user before proceeding. Wider grep across `infrastructure/` apps catches any second wiring site. |
| `extractModelTier` rename breaks an external import | Per repo policy (`feedback_no_deprecation` — dev is disposable, breaking changes free), just rename. Public API surface check confirms no `services/*` outside `libs/agent-orchestrator` imports `extractModelTier` today. If a future consumer needs it, they'd already adapt to the new name. |
| `ModelTier` is imported by code outside `libs/agent-orchestrator` | Grep `ModelTier` across the repo confirms it's used only inside the lib + its tests. Safe to delete. |

## 7. Implementation order (for the writing-plans handoff)

1. **Blast-radius diligence (run all three checks before any code change).**

   **(a) CloudWatch Logs — confirm escalation isn't load-bearing.** Run this Logs Insights query against all 4 advisory AgentRuntime log groups in dev:

   ```
   fields @timestamp, @message, escalatedFromTier, nodeName
   | filter ispresent(escalatedFromTier)
   | stats count() by nodeName, escalatedFromTier
   | sort count desc
   ```

   Log groups: `/aws/bedrock-agentcore/runtime/dev-investor-profile-ctrl-*`, `/aws/bedrock-agentcore/runtime/dev-market-intelligence-ctrl-*`, `/aws/bedrock-agentcore/runtime/dev-portfolio-engine-ctrl-*`, `/aws/bedrock-agentcore/runtime/dev-advisory-narrative-ctrl-*`. Time window: last 30 days. Any node showing non-zero counts → surface as a regression risk before proceeding.

   **(b) Lambda env-var inspection — confirm AGENT_MODEL_OVERRIDE isn't set on deployed runtimes.** Per Risk #3, the CDK wiring is real; verify the var isn't currently populated on dev:

   ```bash
   for fn in $(AWS_PROFILE=nestfolio-dev aws lambda list-functions --query "Functions[?contains(FunctionName, 'agentcore-runtime') && contains(FunctionName, 'dev-')].FunctionName" --output text); do
     echo "=== $fn ==="
     AWS_PROFILE=nestfolio-dev aws lambda get-function-configuration --function-name "$fn" \
       --query 'Environment.Variables.AGENT_MODEL_OVERRIDE' --output text
   done
   ```

   Expected: every line prints `None` (env var unset). Any non-empty value means today's deployed model differs from the `*.config.ts modelId` — surface to user before proceeding.

   **(c) Repo grep — wiring + downstream consumers.**

   ```bash
   # CDK wiring sites
   grep -rn 'AGENT_MODEL_OVERRIDE\|agentModelOverride' infrastructure/ libs/cdk-constructs/ services/ 2>/dev/null \
     | grep -v dist | grep -v node_modules

   # envelope-field consumers
   grep -rn 'escalatedFromTier' services/ libs/ infrastructure/ tools/ 2>/dev/null \
     | grep -v dist | grep -v node_modules

   # agent-trace contract tests that may assert the closed-set tier vocabulary
   grep -rn "gen_ai\\.request\\.model" services/ libs/ apps/ 2>/dev/null \
     | grep -i 'test\\|spec' | grep -v dist | grep -v node_modules
   ```

   Expected at spec time:
   - First grep: only `libs/cdk-constructs/src/extensions/agent-runtime.ts:55-63,78` (handled in §4.9). A second site → handle in the same PR.
   - Second grep: only `libs/agent-orchestrator/src/agent-tracer.ts` (definition) + `libs/agent-orchestrator/src/invoke-orchestrator.ts:60` (projection — handled in §4.7.1) + `libs/agent-orchestrator/test/agent-tracer.test.ts` (tests — handled in §4.10). Any other hit needs handling in the same PR.
   - Third grep: agent-trace contract tests (per memory, 6 agents emit `AgentTraceEnvelope`; 3 advisory scenarios assert on it). Any test asserting `'gen_ai.request.model' === 'haiku' | 'sonnet' | 'opus'` (or comparing against the closed-set values) must be updated in the same PR to assert on the raw model ID. Tests that only check field *presence* are unaffected.

2. **Type-only changes.** Drop `ModelTier`, drop `RetryOptions.escalationPath`. Run `pnpm nx affected --target=type-check`. Fix all callers (the 2 service graph.ts files + the lib internals).
3. **Lib internals.** Delete `tier-escalation.ts`. Strip `agent-factory.ts` of escalation/override blocks. Strip `with-retry.ts` of escalationPath. Strip `create-orchestrator.ts` of buildEscalationPath/escalationPath. Drop `ModelTier` re-export from `index.ts`.
4. **Observability refactor.** Rename `extractModelTier` → `extractModelId` and adjust callers + tests. Drop `TIER_RANK`, `classifyTier`, the `escalatedFromTier` envelope field, the `lastTier` private field, and the rank-comparison block in `handleLLMEnd` (per §4.7). Drop the `escalatedFromTier` projection in `invoke-orchestrator.ts:60` (per §4.7.1).
5. **CDK wiring deletion.** Apply §4.9 — drop the `overrideContext`/`overrideEnv` block in `agent-runtime.ts:55-63` and the spread at line 78. Run `pnpm nx run cdk-constructs:type-check`.
6. **Test cleanup.** Delete the test blocks per §4.10.
7. **Comment cleanup.** Update the stale `MODEL_ID_MAP.sonnet` comment in `onboarding-bff/agents/onboarding/graph.ts:39`. (The `agent-runtime.ts:55-59` doc-comment is already deleted as part of step 5, since it's the comment above the wiring block.)
8. **CI gates.** `pnpm nx affected --target=test`, `--target=lint`, `--target=type-check`.
9. **Deploy dev.** `deploy.sh sandbox --prefix=dev --services=…` for the 4 advisory services.
10. **E2E gate.** One advisory-pipeline scenario in `apps/e2e-feature-tests`.
11. **Ship.** Set `status: shipped`, fill `validation_gate:`. Run `backlog-lint --fix`. Flip `agent-benchmark-skill` from `parking` → `queued` (default) by removing the trigger sentence + adding a "promoted because simplify-agent-orchestrator-model-knob shipped at <commit>" note + assigning a `rank`. Promoting directly to `active` is only legal if no other backlog file currently has `status: active` (backlog rule #2: at most one active). At ship time, this workstream's file flips to `shipped`, so if no other file claims `active`, `agent-benchmark-skill` can take the slot in the same `backlog-lint --fix` pass — otherwise it sits in QUEUED until the contending workstream ships.
