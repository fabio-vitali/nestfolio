# Portfolio-engine mode-aware validation rule + retry-feedback loop (Approach B)

**Date:** 2026-05-07
**Status:** Design — pending user review
**Workstream:** Close `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` so portfolio-construction respects the operating-mode envelope under deployed dev.
**Predecessor:** `docs/superpowers/specs/2026-05-06-portfolio-engine-mode-anchored-examples-design.md` (α-tune SHIPPED-NOT-VALIDATED 2026-05-07, commits `e2768437`..`78378946` on `main`). Per-mode worked examples + EQUITY-only envelope semantic + cached per-mode orchestrator landed; both e2e gate runs failed (CONSERVATIVE 7/0.50/0.15 vs ≤5/≤0.30/≤0.10; AGGRESSIVE 7/0.52/0.15 vs ≥6/≥0.70/≤0.25). Per the predecessor spec's risk register, two consecutive failures triggers escalation to Approach B — this spec.

## Problem

Prompt-level levers are exhausted. Bedrock structured-output (Opus 4.6 + per-mode worked examples + temp=0.1 + HARD-RULES framing + REINFORCE_SUFFIX) still anchors portfolio-construction outputs toward a centred ~50 % equity / ~7 position "BALANCED-shape" regardless of declared mode. The model is *aware* of the rules (they are restated three times in the prompt) and *partly* responds (CONSERVATIVE shed 1 position and 0.10 equity vs pre-α-tune); it just does not converge inside the envelope.

The portfolio-engine validation chain currently catches this case but discards the signal. `withRetry` re-runs the same prompt on `ValidationError`, so the model has no idea its previous attempt was rejected, let alone *how*. We need to feed the violation diff back into the next attempt as concrete corrective text — and we need the validation rule to know which mode envelope to enforce.

## Solution

Two coupled changes inside `libs/agent-orchestrator`, plus the mode-aware rule body in `portfolio-engine-ctrl`. No code changes to the 3 sibling advisory services (`investor-profile-ctrl`, `market-intelligence-ctrl`, `advisory-narrative-ctrl`) — their existing `validate(output)` rules remain valid by signature, and they emit no `feedback` so the new retry path is a no-op for them.

### Lib change 1 — `ValidationRule` becomes context-aware

`ValidationRule.validate()` gains an optional second positional argument:

```ts
// libs/agent-orchestrator/src/types.ts
export interface ValidationContext {
  readonly state: Record<string, unknown>;
  readonly attempt: number;
}

export interface ValidationRule<T> {
  readonly validate: (output: T, ctx?: ValidationContext) => ValidationResult;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly feedback?: string;  // NEW — corrective remediation string for the next prompt attempt
}
```

`withValidation` constructs the ctx from state + the new `__retryAttempt` channel and propagates `result.feedback` into the thrown `ValidationError`:

```ts
// libs/agent-orchestrator/src/with-validation.ts
export function withValidation<T>(node: AgentNodeFn, rule: ValidationRule<T>): AgentNodeFn {
  return async (state, config) => {
    const output = await node(state, config);
    const attempt = (state['__retryAttempt'] as number | undefined) ?? 0;
    const ctx: ValidationContext = { state, attempt };
    const result = rule.validate(output as unknown as T, ctx);
    if (!result.valid) throw new ValidationError(result.errors, { feedback: result.feedback });
    return output;
  };
}
```

`ValidationError` extends to carry the optional feedback:

```ts
// libs/agent-orchestrator/src/types.ts
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

**Backward compatibility:** every existing `validate(output)` callsite still type-checks (ctx is optional). Every existing `new ValidationError(errors)` callsite still type-checks (opts is optional). Every existing `return { valid, errors }` still type-checks (feedback is optional). The 3 sibling services and the `rebalanceValidationRule` in this same service touch *zero* code.

### Lib change 2 — `withRetry` injects feedback + tracks attempt

`withRetry` now writes two new state channels before each attempt — `__retryAttempt` (read by `withValidation` for ctx population) and `__retryFeedback` (read by `agent-factory` to mutate the prompt). On `ValidationError`, it reads `error.feedback ?? error.errors.join('\n')` and stores it on state for the next iteration:

```ts
// libs/agent-orchestrator/src/with-retry.ts
export function withRetry(node: AgentNodeFn, options: RetryOptions): AgentNodeFn {
  const { maxAttempts, escalationPath } = options;
  return async (state, config) => {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const enriched: Record<string, unknown> = { ...state, __retryAttempt: attempt };
        if (escalationPath && attempt > 0 && attempt < escalationPath.length) {
          enriched['__escalationTier'] = escalationPath[attempt];
        }
        return await node(enriched, config);
      } catch (error) {
        if (error instanceof ValidationError) {
          lastError = error;
          state = {
            ...state,
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

**Coordination with `__escalationTier` (the "don't double-cost" constraint):** the two channels are independent. For portfolio-construction (the only service in scope here), `buildEscalationPath('opus')` returns `['opus']` so escalation is a no-op — feedback is the *only* retry signal, no compounding cost. For the 3 sibling services starting at Sonnet, their rules emit no `feedback` so `withRetry` falls through to `errors.join('\n')` *only when their existing rules already throw* — current behaviour is unchanged. A future sibling that opts into rich `feedback` AND has a non-trivial `escalationPath` would pay both costs additively (~3× model cost + ~10 % prompt growth); that's solvable by adding a `RetryOptions.feedbackPolicy` knob then, not now.

### Lib change 3 — `agent-factory` consumes `__retryFeedback`

After building the bare prompt, `createAgentNode` appends a feedback section if state carries one. Both attempts inside `agent-factory` (the bare invoke and the existing `tool_choice`-pinned retry) see the same feedback-augmented prompt:

```ts
// libs/agent-orchestrator/src/agent-factory.ts (inside createAgentNode's returned async fn)
const basePrompt = promptTemplate.replace('{input}', input);
const feedback = state['__retryFeedback'] as string | undefined;
const prompt = feedback
  ? `${basePrompt}\n\nPRIOR ATTEMPT FEEDBACK — your previous output was rejected. Correct it now:\n${feedback}`
  : basePrompt;
// …subsequent structured.invoke(prompt, runnableConfig) and the tool_choice-pinned
// retry that follows both pick up the feedback-augmented prompt automatically.
```

The `REINFORCE_SUFFIX` already appended to the second `agent-factory` attempt continues to apply on top of the feedback section — they address different failure modes (feedback = "your output broke envelope rules", reinforce-suffix = "your output was empty / shallow").

### Lib change 4 — `index.ts` re-exports `ValidationContext`

Add `ValidationContext` to the public exports of `libs/agent-orchestrator/src/index.ts` so service-level rule files can import the type.

### Service change 1 — Plumb `operatingMode` through orchestrator state

`invokePortfolioEngine` currently passes only `{ input: enrichedInput }` to `invokeOrchestrator`. The mode-aware rule needs to read `operatingMode` from `ctx.state`, so we add it as an explicit state channel:

```ts
// services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts
// inside invokePortfolioEngine, after operatingMode is resolved (line 116-119):
const result = await invokeOrchestrator(
  graph,
  { input: enrichedInput, operatingMode },  // NEW — explicit state channel for the rule
  emitter
    ? { agent: 'portfolio-engine', correlationId: payload.decisionId, tenantId: payload.tenantId, emitter }
    : undefined,
);
```

`PortfolioEngineState` annotation in `services/advisory/portfolio-engine-ctrl/src/agents/state.ts` gains an `operatingMode` channel (string, default `'BALANCED'`) so LangGraph propagates it through wave nodes.

### Service change 2 — `portfolioValidationRule` becomes mode-aware

`portfolioValidationRule` keeps its exported name (per Q4 = D) but its body becomes mode-aware. The existing rule is also *factually wrong* now: its 50 %-on-any-position cap would false-reject the predecessor spec's CONSERVATIVE worked example (which intentionally has BND at 0.50), so leaving it untouched is not an option.

```ts
// services/advisory/portfolio-engine-ctrl/src/agents/validation.ts
import type { ValidationContext, ValidationRule, ValidationResult } from '@nestfolio/agent-orchestrator';
import type { OperatingMode } from './prompts';

interface PortfolioOutput {
  allocations: Array<{ instrument: string; assetClass: string; targetWeight: number; rationale: string }>;
  totalExposure: number;
  equityWeight: number;
  riskMetrics: { concentrationRisk: number; sectorDiversity: number; largestPositionWeight: number };
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

export const portfolioValidationRule: ValidationRule<PortfolioOutput> = {
  validate(output: PortfolioOutput, ctx?: ValidationContext): ValidationResult {
    const mode = (ctx?.state['operatingMode'] as OperatingMode | undefined) ?? 'BALANCED';
    const env = MODE_ENVELOPE[mode];
    const errors: string[] = [];
    const violations: Violation[] = [];

    // 1. Mass conservation (mode-orthogonal)
    const weightSum = output.allocations.reduce((s, a) => s + a.targetWeight, 0);
    if (Math.abs(weightSum - output.totalExposure) > 0.01) {
      errors.push(`Weights sum to ${weightSum.toFixed(4)}, totalExposure=${output.totalExposure}`);
      violations.push({ kind: 'mass', observed: weightSum, expected: `≈${output.totalExposure}` });
    }

    // 2. Count band
    const count = output.allocations.length;
    const [countMin, countMax] = env.countRange;
    if (count < countMin || count > countMax) {
      errors.push(`allocations.length=${count}, must be in [${countMin}, ${countMax}] for ${mode}`);
      violations.push({ kind: 'count', observed: count, expected: `[${countMin}, ${countMax}]` });
    }

    // 3. Equity weight band (computed from allocations, not the model-reported field)
    const equitySum = output.allocations
      .filter((a) => a.assetClass === 'EQUITY')
      .reduce((s, a) => s + a.targetWeight, 0);
    const [eqMin, eqMax] = env.equityRange;
    if (equitySum < eqMin || equitySum > eqMax) {
      errors.push(`equityWeight=${equitySum.toFixed(2)}, must be in [${eqMin}, ${eqMax}] for ${mode}`);
      violations.push({ kind: 'equity', observed: equitySum, expected: `[${eqMin}, ${eqMax}]` });
    }

    // 4. Largest EQUITY position cap
    const equityPositions = output.allocations.filter((a) => a.assetClass === 'EQUITY');
    const largestEquity = equityPositions.length > 0 ? Math.max(...equityPositions.map((a) => a.targetWeight)) : 0;
    if (largestEquity > env.largestEquityCap) {
      const offender = equityPositions.find((a) => a.targetWeight === largestEquity)?.instrument ?? '?';
      errors.push(`largest EQUITY position ${offender}=${largestEquity.toFixed(2)}, must be ≤ ${env.largestEquityCap} for ${mode}`);
      violations.push({ kind: 'largestEquity', observed: `${offender}=${largestEquity.toFixed(2)}`, expected: `≤ ${env.largestEquityCap}` });
    }

    if (errors.length === 0) return { valid: true, errors: [] };

    const feedback = formatCorrectiveFeedback(mode, env, violations, output);
    return { valid: false, errors, feedback };
  },
};
```

`formatCorrectiveFeedback` produces the multi-line corrective string. Each violation kind has a tailored remediation hint:

```ts
function formatCorrectiveFeedback(mode: OperatingMode, env: ModeEnvelope, violations: Violation[], output: PortfolioOutput): string {
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
```

`rebalanceValidationRule` is unchanged (mode-orthogonal; no observed failure mode).

## Per-cycle data flow (worked example)

CONSERVATIVE mode, attempt 0 produces the same 7-position / 0.50-equity / 0.15-largest output observed in the 2026-05-07 e2e gate run:

```
invokePortfolioEngine(payload, emitter)
 ├─ resolves operatingMode = 'CONSERVATIVE' (from upstreamOutputs.operatingMode)
 ├─ getGraphForMode('CONSERVATIVE') → cached compiled graph
 └─ invokeOrchestrator(graph, { input: enrichedInput, operatingMode: 'CONSERVATIVE' })
     └─ wave0 → portfolio-construction node = withFallback(withRetry(withValidation(createAgentNode(cfg))))
         ├─ ATTEMPT 0
         │   ├─ withRetry: enriched={...state, __retryAttempt:0}, no escalation, no __retryFeedback
         │   ├─ withValidation: ctx={state, attempt:0}
         │   ├─ createAgentNode: state.__retryFeedback undefined → bare prompt (per-mode worked example)
         │   ├─ Bedrock: {allocations:[7 items], equityWeight:0.50, largestPositionWeight:0.15}
         │   ├─ portfolioValidationRule.validate(output, ctx) reads ctx.state.operatingMode='CONSERVATIVE'
         │   │   ├─ mass: 1.00 ✓
         │   │   ├─ count: 7 ∉ [3,5] ✗
         │   │   ├─ equity: 0.50 ∉ [0, 0.30] ✗
         │   │   └─ largest equity: 0.15 > 0.10 ✗
         │   ├─ rule returns {valid:false, errors:[…], feedback:"You returned a portfolio that violates CONSERVATIVE…"}
         │   └─ withValidation throws ValidationError(errors, { feedback })
         ├─ withRetry catches: state.__retryFeedback = error.feedback, attempt++
         ├─ ATTEMPT 1
         │   ├─ withRetry: enriched={...state, __retryAttempt:1, __retryFeedback:"…corrective…"}
         │   ├─ createAgentNode: appends "PRIOR ATTEMPT FEEDBACK — your previous output was rejected. Correct it now:\n…"
         │   ├─ Bedrock: {allocations:[4 items], equityWeight:0.20, largestPositionWeight:0.10}  ← target shape
         │   ├─ portfolioValidationRule.validate: all 4 checks ✓
         │   └─ returns output
         └─ withFallback: ok=true → wave-node returns
```

If attempt 1 also violates, attempt 2 retries with feedback derived from the attempt-1 output (potentially different violations — the diff is recomputed each cycle). After `maxAttempts=3` exhausted, the last `ValidationError` rethrows past `withRetry` → `withFallback` catches → wave-node entry is `{ ok: false, reason, fallback }` → `agent-service.ts` raises `DegradedAgentOutputError` per the existing β/γ contract. SF observes a TaskFailure with a clear cause; no silent success.

## Code changes summary

Eight files, organised by concern:

### `libs/agent-orchestrator`
1. `src/types.ts` — extend `ValidationResult` with optional `feedback`; extend `ValidationError` constructor to accept `{ feedback }`; add `ValidationContext` interface; extend `ValidationRule<T>.validate` signature.
2. `src/with-validation.ts` — read `__retryAttempt` from state to populate ctx; thread `result.feedback` into the thrown `ValidationError`.
3. `src/with-retry.ts` — write `__retryAttempt` on every attempt; on caught `ValidationError`, write `__retryFeedback` to state for the next iteration.
4. `src/agent-factory.ts` — read `__retryFeedback` inside `createAgentNode`; append "PRIOR ATTEMPT FEEDBACK — your previous output was rejected. Correct it now:\n…" section to prompt when present.
5. `src/index.ts` — re-export `ValidationContext`.

### `services/advisory/portfolio-engine-ctrl`
6. `src/agents/state.ts` — add `operatingMode` channel (string, default `'BALANCED'`) to `PortfolioEngineState`.
7. `agents/portfolio-engine/graph.ts` — pass `operatingMode` alongside `input` in the `invokeOrchestrator` payload.
8. `src/agents/validation.ts` — replace `portfolioValidationRule` body with the mode-aware logic above; add `formatCorrectiveFeedback` helper. `rebalanceValidationRule` unchanged.

### Tests touched
- `libs/agent-orchestrator/test/unit/with-retry.test.ts` (extend or new) — assert `__retryFeedback` lands on state on retry; assert non-`ValidationError` still bypasses retry; assert `error.feedback ?? errors.join` precedence.
- `libs/agent-orchestrator/test/unit/with-validation.test.ts` (extend or new) — assert ctx `state` + `attempt` populated; assert `result.feedback` propagates into thrown `ValidationError`.
- `services/advisory/portfolio-engine-ctrl/test/unit/validation.test.ts` — table-driven cases per mode × violation kind; assert `errors[]` content + presence of structured `feedback` string with the expected remediation hint.
- `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts` — verify `invokeOrchestrator` is called with `{ input, operatingMode }`.

## Done-when

- E2E gate `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` against deployed dev returns **CONSERVATIVE GREEN + AGGRESSIVE GREEN**.
- BALANCED outcome documented but not blocking — depends on the separately-filed Vestigial MemoryStrategy entry. Gate result is "2/3 from us, 1/3 blocked-out-of-scope" → counts as ship for this workstream.
- Unit suites for `agent-orchestrator` and `portfolio-engine-ctrl` green.
- Lint green for both projects.

## Validation gate

1. `pnpm nx run agent-orchestrator:test` — unit suite green (with the new with-retry + with-validation assertions).
2. `pnpm nx run agent-orchestrator:lint` — zero new violations.
3. `pnpm nx run portfolio-engine-ctrl:test` — unit suite green (with the new validation.test.ts table + the graph.test.ts state-payload assertion).
4. `pnpm nx run portfolio-engine-ctrl:lint` — zero new violations.
5. `pnpm nx run portfolio-engine-ctrl:test-integration` against deployed dev — green (the existing agent-service.test.ts hits real Bedrock; should pass with mode-aware retries since CONSERVATIVE/AGGRESSIVE recovery is the new dominant pathway).
6. Deploy AgentRuntime: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl`.
7. Run e2e gate: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=operating-mode-recommendation-shape`.
8. Expected outcome: CONSERVATIVE PASS, AGGRESSIVE PASS, BALANCED times out (separate item).
9. If CONSERVATIVE or AGGRESSIVE flakes on first run: re-run once before declaring failure (LLM nondeterminism). Two consecutive failures of either mode → escalation: revisit `maxAttempts` (currently 3), consider raising the per-attempt `maxTokens`, or pursue an explicit "Opus + extended-thinking" tier rather than a third architectural workstream.

## Out of scope

| Item | Why deferred | Filed |
| ---- | ------------ | ----- |
| BALANCED mode validation gate | Vestigial MemoryStrategy namespace bug — already filed | `docs/BACKLOG.md` PARKING LOT |
| `rebalance-planner` mode-awareness | Mode-orthogonal to turnover minimization; no observed failure | Predecessor spec OOS table |
| `updateOperatingMode` mutation re-derivation gap | Already filed | `docs/BACKLOG.md` PARKING LOT |
| `withLiveDecision` BALANCED hardcode | Already filed | `docs/BACKLOG.md` PARKING LOT |
| Generic `Ctx` typing on `ValidationRule<T, Ctx = void>` | Considered (Q1 option C); rejected as over-engineering for 4 in-monorepo services. The 4 advisory services share types; type-narrowing on `ctx.state['operatingMode']` is acceptable for one rule. | n/a |
| Per-service `RetryOptions.feedbackPolicy` knob | Considered (Q3 option C); deferred until a sibling service both opts into rich `feedback` AND has multi-tier `escalationPath` (current escalationPaths: portfolio-construction Opus → no-op; the 3 siblings start at Sonnet but emit no feedback). | n/a |
| Sibling services adopting the feedback channel | No current failure mode in investor-profile / market-intelligence / advisory-narrative output; the architectural α/β/γ workstream closed their structured-output gaps. Adopt opportunistically when a sibling-specific envelope violation surfaces. | n/a |
| Stale `readUpstreamOutput('advisory-ctrl')` in `graph.ts:97` | Already filed | `docs/BACKLOG.md` PARKING LOT |
| Silent `operatingMode` discard observability gap (`graph.ts:113-119`) | Already filed | `docs/BACKLOG.md` PARKING LOT |
| Intermittent zero-packet runs across all modes | Already filed (separate from BALANCED's Memory namespace issue) | `docs/BACKLOG.md` PARKING LOT |
| Cross-service ValidationContext adoption (sibling rules upgrading to mode-aware) | Out of scope; would warrant its own design | n/a |

## References

- `docs/architecture/SYSTEM-ARCHITECTURE.md` §14 — operating-mode dimension across the system.
- `docs/architecture/SERVICE-INVENTORY.md` § portfolio-engine-ctrl — agent topology and the Opus/Sonnet split.
- `flows/advisory-cycle.flow.yaml` Phase 2c — portfolio-construction agent invocation contract.
- `docs/superpowers/specs/2026-05-06-portfolio-engine-mode-anchored-examples-design.md` § "Solution" + § "Risk register" — the predecessor spec that explicitly identified Approach B as the fallback path.
- `docs/superpowers/specs/2026-05-06-agent-runtime-structured-output-design.md` — the architectural α/β/γ pipeline this design sits on top of (`withFallback`, `assertOrchestratorOutput`, `DegradedAgentOutputError`).
- `services/advisory/portfolio-engine-ctrl/CLAUDE.md` — current service card; verified against code at design time, no drift relevant to this design.
- `libs/agent-orchestrator/src/types.ts` — current `ValidationRule` / `ValidationResult` / `ValidationError` definitions being extended.
- `libs/agent-orchestrator/src/agent-factory.ts` § "Phase γ.4 (Spec 4, 2026-05-06)" — the existing in-call retry-with-`tool_choice` path that the new feedback-augmented prompt feeds into.
