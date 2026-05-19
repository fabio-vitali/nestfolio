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

2. **`AGENT_MODEL_OVERRIDE` cost-cap downgrade.** `applyOverride()` reads the env var and downgrades the resolved model with a smart-skip rule (opus sites exempt, never raises a tier). The doc-comment claims the var is set per-deploy via `cdk deploy --context agentModelOverride=haiku`, but `grep -rn 'AGENT_MODEL_OVERRIDE\|agentModelOverride' libs/cdk-constructs infrastructure/` returns no actual env-var wiring — only a stale comment reference in `libs/cdk-constructs/src/extensions/agent-runtime.ts:58`. The feature is dead in practice.

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

Net deletion: lines 7-42, plus the `state.__escalationTier`/`applyOverride` block at lines 85-87 collapses to just `model: modelId`.

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

The AgentTracer emits envelopes with a model field. Currently:

```typescript
'gen_ai.request.model': ModelTier | 'unknown';
escalatedFromTier?: ModelTier;
const TIER_RANK: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };

export function extractModelTier(llm, extraParams?, metadata?): ModelTier | 'unknown' { ... }
function classifyTier(text: string): ModelTier | 'unknown' { ... }
```

After:

```typescript
'gen_ai.request.model': string;  // raw model ID, e.g. 'us.anthropic.claude-sonnet-4-6' or 'unknown'
// escalatedFromTier removed entirely — escalation no longer exists
// TIER_RANK removed entirely
// classifyTier removed entirely

export function extractModelId(llm, extraParams?, metadata?): string {
  // same extraction logic (kwargs.model → extraParams → metadata.ls_model_name)
  // but returns the raw model id string. Returns 'unknown' only when no candidate found.
}
```

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
- `libs/cdk-constructs/src/extensions/agent-runtime.ts:58`: stale comment references `applyOverride()`. Delete the comment.

### 4.9 CDK / infrastructure verification

A full grep of `infrastructure/` and `libs/cdk-constructs/` for `AGENT_MODEL_OVERRIDE` and `agentModelOverride` is part of the implementation plan. The exploratory grep before this spec found **no actual env-var wiring** — only the stale comment in `agent-runtime.ts:58`. If the verification surfaces real wiring (e.g. a `environment: { AGENT_MODEL_OVERRIDE: ... }` block in a Lambda construct or a `cdk.context.tryGetContext('agentModelOverride')` read), it gets deleted as part of the same PR.

### 4.10 Tests

- `libs/agent-orchestrator/test/agent-factory.test.ts`:
  - Delete the entire `describe('createAgentNode — AGENT_MODEL_OVERRIDE (cost-cap downgrade)')` block (~lines 95–225, including `process.env` setup/teardown).
  - Delete the two `__escalationTier` test cases (line 55 `'uses __escalationTier to override model when present in state'`, line 196 `'__escalationTier on state wins over AGENT_MODEL_OVERRIDE'`).
  - Keep all other tests (config wiring, structured-output retry, etc.).
- `libs/agent-orchestrator/test/with-retry.test.ts`:
  - Delete the two `__escalationTier`-related `it()` blocks (around lines 39 and 63 — match by content: any `it()` whose body references `escalationPath` or `__escalationTier`).
  - Keep tests for `maxAttempts` retry behaviour, validation-error propagation, `__retryFeedback` augmentation.
- `libs/agent-orchestrator/test/agent-tracer.test.ts`:
  - Rename test descriptions referring to `extractModelTier` → `extractModelId`.
  - Update assertions: instead of `.toBe('haiku')`, assert `.toBe('us.anthropic.claude-haiku-4-5')` (raw ID). Add a Nova case to confirm `extractModelId` returns the raw ID, not `'unknown'`.
- `libs/agent-orchestrator/test/tier-escalation.test.ts` (if present): delete the entire file alongside `tier-escalation.ts`.
- `libs/agent-orchestrator/test/create-orchestrator.test.ts`: drop any escalation-path-related assertions; keep wave-orchestration + retry-wiring assertions.

## 5. Validation

- `pnpm nx affected --target=test` passes.
- `pnpm nx affected --target=type-check` passes.
- `pnpm nx affected --target=lint` passes.
- `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl` succeeds.
- One advisory-pipeline e2e scenario in `apps/e2e-feature-tests` passes against deployed dev (covers narrative + market-intelligence which previously had escalation paths).

## 6. Risks

| Risk | Mitigation |
|---|---|
| `__escalationTier` was actually firing in production for some failure mode we don't know about | Escalation is wired in 4 services (see §1). Verified per-service behaviour, traced against the real `withRetry` semantics (condition `attempt > 0 && attempt < escalationPath.length`; `escalationPath[0]` is structurally dead because attempt 0 always uses `config.modelId`). Both `investor-profile-ctrl` and `portfolio-engine-ctrl` pass `retryOptions: { maxAttempts: 3 }` to `createOrchestrator`, so the auto-path is exercised across **3 attempts**:<br/>• **advisory-narrative** (haiku, `maxAttempts: 2`, explicit `['sonnet','opus']`): attempt 0 → haiku; attempt 1 → `escalationPath[1] = 'opus'`. Two attempts total. Actual escalation is **haiku→opus** (sonnet at `[0]` is never read).<br/>• **market-intelligence** (sonnet, `maxAttempts: 3`, explicit `['sonnet']`): condition `attempt < 1` never holds for `attempt ≥ 1`. All 3 attempts run at sonnet. The path is **entirely dead config**.<br/>• **investor-profile / user-goals** (haiku, auto-path `['haiku','sonnet','opus']`, `maxAttempts: 3`): attempt 0 → haiku, attempt 1 → sonnet, attempt 2 → opus. Three different models — the only site where the auto-path is fully exercised.<br/>• **investor-profile / risk-assessment** (sonnet, auto-path `['sonnet','opus']`, `maxAttempts: 3`): attempt 0 → sonnet, attempt 1 → opus, attempt 2 → condition fails (`2 < 2` false) → **back to sonnet**. Pattern: **sonnet → opus → sonnet** (a single-shot opus retry sandwiched between two sonnet attempts).<br/>• **portfolio-engine / portfolio-construction** (opus, auto-path `['opus']`, `maxAttempts: 3`): condition never holds. All 3 attempts at opus. Dead.<br/>• **portfolio-engine / rebalance-planner** (sonnet, auto-path `['sonnet','opus']`, `maxAttempts: 3`): same as risk-assessment — **sonnet → opus → sonnet**.<br/>If retry-and-escalate currently rescues the cycle from a real failure (most plausibly in advisory-narrative, user-goals, or the opus-retry slot of risk-assessment / rebalance-planner), removing it could regress. Verify by CloudWatch Logs Insights query in §7 step 1 BEFORE removing the code. If any envelope shows `escalatedFromTier !== undefined`, surface to the user as a workstream-scope risk. |
| Downstream telemetry consumes `gen_ai.request.model` as the closed set | Grep across the repo + cloud config for any aggregation on literal `'haiku'\|'sonnet'\|'opus'` values of that field. None found at spec time. |
| Hidden CDK wiring of AGENT_MODEL_OVERRIDE I didn't find | Implementation plan includes a full `grep -rn 'AGENT_MODEL_OVERRIDE\|agentModelOverride' infrastructure libs/cdk-constructs` as a pre-step. |
| `extractModelTier` rename breaks an external import | Per repo policy (`feedback_no_deprecation` — dev is disposable, breaking changes free), just rename. Public API surface check confirms no `services/*` outside `libs/agent-orchestrator` imports `extractModelTier` today. If a future consumer needs it, they'd already adapt to the new name. |
| `ModelTier` is imported by code outside `libs/agent-orchestrator` | Grep `ModelTier` across the repo confirms it's used only inside the lib + its tests. Safe to delete. |

## 7. Implementation order (for the writing-plans handoff)

1. **Confirm escalation isn't load-bearing.** Run this CloudWatch Logs Insights query against all 4 advisory AgentRuntime log groups in dev — covering both the manually-wired services (advisory-narrative, market-intelligence) and the auto-wired ones (investor-profile, portfolio-engine):

   ```
   fields @timestamp, @message, escalatedFromTier, nodeName
   | filter ispresent(escalatedFromTier)
   | stats count() by nodeName, escalatedFromTier
   | sort count desc
   ```

   Run against log groups: `/aws/bedrock-agentcore/runtime/dev-investor-profile-ctrl-*`, `/aws/bedrock-agentcore/runtime/dev-market-intelligence-ctrl-*`, `/aws/bedrock-agentcore/runtime/dev-portfolio-engine-ctrl-*`, `/aws/bedrock-agentcore/runtime/dev-advisory-narrative-ctrl-*`. Time window: last 30 days. If any node shows non-zero counts, surface to the user as a regression risk before proceeding.

   Also grep the repo for any downstream consumer of the `escalatedFromTier` envelope field (test harnesses, dashboards, analysis scripts):

   ```bash
   grep -rn 'escalatedFromTier' services/ libs/ infrastructure/ tools/ 2>/dev/null | grep -v dist | grep -v node_modules
   ```

   Expected: only `libs/agent-orchestrator/src/agent-tracer.ts` (the definition). Any other hit needs handling in the same PR.
2. **Grep CDK wiring.** Full grep for `AGENT_MODEL_OVERRIDE` and `agentModelOverride` across `infrastructure/`, `libs/cdk-constructs/`. Inventory any real wiring; expect none.
3. **Type-only changes.** Drop `ModelTier`, drop `RetryOptions.escalationPath`. Run `pnpm nx affected --target=type-check`. Fix all callers (the 2 service graph.ts files + the lib internals).
4. **Lib internals.** Delete `tier-escalation.ts`. Strip `agent-factory.ts` of escalation/override blocks. Strip `with-retry.ts` of escalationPath. Strip `create-orchestrator.ts` of buildEscalationPath/escalationPath. Drop `ModelTier` re-export from `index.ts`.
5. **Observability refactor.** Rename `extractModelTier` → `extractModelId` and adjust callers + tests. Drop `TIER_RANK`, `classifyTier`, `escalatedFromTier` field.
6. **Test cleanup.** Delete the test blocks per §4.10.
7. **Comment cleanup.** Update the two stale comments in `onboarding-bff/agents/onboarding/graph.ts` and `cdk-constructs/extensions/agent-runtime.ts`.
8. **CI gates.** `pnpm nx affected --target=test`, `--target=lint`, `--target=type-check`.
9. **Deploy dev.** `deploy.sh sandbox --prefix=dev --services=…` for the 4 advisory services.
10. **E2E gate.** One advisory-pipeline scenario in `apps/e2e-feature-tests`.
11. **Ship.** Set `status: shipped`, fill `validation_gate:`. Run `backlog-lint --fix`. Flip `agent-benchmark-skill` from `parking` → `queued` (or directly `active` if no other workstream is contending) by removing the trigger sentence + adding a "promoted because simplify-agent-orchestrator-model-knob shipped at <commit>" note.
