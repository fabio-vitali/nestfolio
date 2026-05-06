# Agent Runtime — Structured-Output Reliability

**Date:** 2026-05-06
**Status:** Proposed (pending approval)
**Scope:** `libs/agent-orchestrator/src/`, all four advisory agent services (`services/advisory/{investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl}/src/`), the four AgentCore Runtime entry-points (`services/advisory/*/agents/*/`).
**Predecessor:** `docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md` (Spec 3 — onboarding-bff equivalent for the CopilotKit AbstractAgent path, SHIPPED 2026-05-01 commit `fa78514c`).
**Promoted from:** `docs/BACKLOG.md` QUEUED slot 1 — `[bug] Agent runtime returns degraded structured output (e2e gate blocker)` — adopted 2026-05-06.

## Problem

Every `DecisionPacket` ever produced in dev has shipped with `proposedTrades: []` and `portfolioValue: 0`. SF executions complete, AgentCore Memory writes happen, the assembler reads the Memory record correctly — but the record itself contains nothing. Operating Mode Phase 2's e2e gate (`apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts`) cannot validate mode-differentiated allocations until this is fixed.

### What the runtime actually does (verified by code read 2026-05-06)

1. `services/advisory/portfolio-engine-ctrl/src/agent-service.ts:80` calls `dispatchAgentInvocation()` and gets back `result` shaped `{ 'portfolio-construction': ?, 'rebalance-planner': ? }` from the AgentCore Runtime.
2. The AgentCore Runtime (`agents/portfolio-engine/server.ts` → `invokePortfolioEngine` in `graph.ts`) calls `invokeOrchestrator(graph, { input: enrichedInput })`.
3. `libs/agent-orchestrator/src/create-orchestrator.ts:61-66` builds wave nodes that do `Promise.all(wave.agents.map(k => nodeMap[k](state)))` and assemble `{ [agentKey]: output }`.
4. Each `nodeMap[k]` is the decorator stack `withFallback(withRetry(withValidation(createAgentNode(...))))` from `agent-factory.ts`.
5. `createAgentNode` builds a `ChatBedrockConverse` + `llm.withStructuredOutput(schema)`, then calls `.invoke(prompt, runnableConfig)`.

### Failure mode (verified by elimination, not by log inspection — see §Validation)

Bedrock log group `/aws/bedrock-agentcore/runtimes/portfolio_engine_agents-DIbHQa6EdW-DEFAULT` shows `Orchestrator invocation completed duration=10633ms` with no ERROR lines. 10–15s wall-clock is **half** the latency a real Sonnet/Opus structured-output call requires (30–60s+ for a 5–12 position recommendation against a complex Zod schema).

Three layers of evidence eliminate the obvious candidates:

- **`withFallback` is not firing.** `services/advisory/portfolio-engine-ctrl/src/agents/fallbacks.ts` returns 3 populated allocations (VTI/BND/VXUS, equityWeight=0.7). If any error reached `withFallback`, packets would carry 3 trades, not `[]`. They carry `[]`. So the agent is **returning `{}` without throwing**.
- **`withRetry` is too narrow.** `libs/agent-orchestrator/src/with-retry.ts:18-21` catches *only* `ValidationError`. Bedrock 5xx, throttle, parse failures, all propagate immediately. But there's nothing to propagate — the agent didn't throw.
- **`EmptyAgentResponseError` is too loose.** `services/advisory/portfolio-engine-ctrl/src/agent-service.ts:91` checks `if (!result['portfolio-construction'] && !result['rebalance-planner'])`. `!{}` is `false` — empty object is truthy. The check never fires.

### Root cause

The combination of:

- **Tiny prompts** — all four services use 9–19-line stub prompts (`portfolio-engine` 19 lines, `advisory-narrative` 12, `investor-profile` 18, `market-intelligence` 9). No worked example, no schema-shape directive, no "you MUST populate every field", no forbid-empty.
- **Permissive Zod schemas + relaxed defaults** — `ExplainabilitySchema` (advisory-narrative) is 6 fields, all `z.string()` / `z.number()` with no `.min()`. Nothing prevents the model from calling the structured-output tool with sparse arguments that pass schema validation as a near-empty object.
- **`withStructuredOutput` does not throw on sparse output.** When Sonnet 4.6 produces a tool_use with empty/minimal args, `withStructuredOutput` parses successfully and returns `{}` (no `tool_calls.length === 0` exception path triggered). Same Sonnet behavior that bit onboarding in Spec 3 — **but onboarding fixed it via prompt cleanup + named-tool retry. The advisory factory has neither.**
- **Cross-cutting silent-degradation pattern.** `grep 'EmptyAgentResponseError' services/advisory/*/src/agent-service.ts` matches **only portfolio-engine-ctrl**. The other three services pipe `result['user-goals'] ?? {}`, `result['market-research'] ?? {}`, `result['explainability'] ?? {}` straight to their downstream Memory write. Three latent variants of the exact same bug, never observed because nothing downstream asserts on content shape.

The Phase 2 commit (`515b3f15`) and the assemble-packet fix (`864d31a6`) made `proposedTrades: []` newly *visible* by adding the schema fields the e2e gate asserts on. The bug itself has been silently failing every advisory cycle since service inception.

## Out of scope

- **Onboarding agent (`services/investor/onboarding-bff/src/agent/`)** — uses a custom `AbstractAgent` (CopilotKit AG-UI), not `libs/agent-orchestrator`. Already hardened in Spec 3 (commit `fa78514c`). This spec touches only the advisory `agent-orchestrator` path.
- **AgentCore Memory namespace mismatch / dual DECISION_PACKET_CREATED race / advisory-bff `onDecisionUpdate` WSS premature close** — separately filed in PARKING LOT.
- **`updateOperatingMode` mutation re-derivation gap** — separately filed.
- **Stale `session.readUpstreamOutput('advisory-ctrl')` in two graph.ts files** — separately filed.
- **Rewriting AgentCore Runtime container image / Bedrock SDK retry config** — Bedrock SDK retries are appropriate as-is; we are NOT touching transport layer.
- **Fallback CONTENT tuning** (per-mode fallback shapes, etc.) — fallbacks become unreachable in practice once we make `withFallback` mark-degraded; their content is no longer load-bearing for the e2e gate.
- **Step Functions task-level retry** — adding `addRetry` on agent-invocation states is tempting but premature. We want the bug to surface as a SF TaskFailure with a clear cause first, then decide if a transport-level retry is warranted (separate workstream if so).
- **Re-tuning operating-mode envelope thresholds** — Phase 2 envelope (CONSERVATIVE ≤30% equity, etc.) stays as-is; e2e gate still asserts the same shape.

## Library-vs-service breakdown (per-fix verification)

The user instruction was: *for each fix, verify if it can be done at library level (so all system agents are automatically fixed), and if not, look into other agent implementations for similar weaknesses*. The audit confirms the cross-cutting weakness — all four services share it — and three of four fixes are pure library-level.

| Fix | Lib-level? | Per-service touches | Rationale |
|---|---|---|---|
| **α — Prompt rewrite** | **Helper at lib + per-service content** | All 4 advisory `prompts.ts` files (6 prompts total) | Prompt *content* is inherently per-agent. **Discipline** is library-level: a `formatStructuredOutputPrompt({role, task, schemaShape, examples, rules})` helper produces a consistent template, and a lib-level prompt-invariant test ensures every advisory prompt routes through it. |
| **β — `withFallback` discriminant** | **Pure library-level** | Per-service `agent-service.ts` consumes new error class | Single change to `with-fallback.ts` + wave-node in `create-orchestrator.ts` flows the discriminant through. All four services automatically gain fail-fast on degraded output once they consume the lib's new `DegradedAgentOutputError`. |
| **γ — Empty-output check** | **Pure library-level** | All 4 `agent-service.ts` call the lib helper | New `assertOrchestratorOutput(result, expectedKeys)` helper. **investor-profile + market-intelligence + advisory-narrative gain protection they currently lack** — closing three latent variants of the same bug. |
| **γ' — Structured-output shape retry** | **Pure library-level** | None | Inside `agent-factory.ts` after `structured.invoke()`: if the parsed object has zero defined keys, retry once with a stronger prompt suffix and `tool_choice` pinned to the schema's tool name. Mirrors onboarding's named-tool retry, lifted from per-phase to per-agent. All advisory agents benefit transparently. |

## Approach — phased, most-decisive first

Mirrors the Spec 3 ordering rationale: prompt cleanup is almost always the actual fix; everything else is anti-fragility / defense-in-depth.

### Phase α — Prompt rewrite + discipline helper (decisive)

**α.1 — Library helper.** New `libs/agent-orchestrator/src/format-prompt.ts`:

```typescript
export interface StructuredOutputPromptSpec {
  readonly role: string;
  readonly task: string;
  readonly schemaShape: string;        // multi-line JSON example matching the Zod schema
  readonly rules: readonly string[];   // imperative MUST/MUST NOT clauses
  readonly examples?: readonly string[];
  readonly forbidEmpty?: boolean;      // defaults true — emits "You MUST NOT return empty…"
}

export function formatStructuredOutputPrompt(spec: StructuredOutputPromptSpec): string;
```

Output shape (uniform across all advisory agents):

```
ROLE: …
TASK: …
SCHEMA SHAPE — populate EVERY field:
<json example>
RULES:
- …
- …
EXAMPLES:
<example block>
You MUST call the structured-output tool with non-empty arguments. Returning empty fields is a hard failure.
Input: {input}
```

Lib-level test `libs/agent-orchestrator/test/format-prompt.test.ts` enforces invariants: helper output contains `ROLE:`, `TASK:`, `SCHEMA SHAPE`, `RULES:`, `Input: {input}`; `forbidEmpty: true` injects the exact directive grep-able by per-service tests.

**α.2 — Rewrite all 6 advisory prompts.** Each `prompts.ts` calls `formatStructuredOutputPrompt(...)` with content matching the agent's role + schema. Schema-shape blocks are JSON snippets derived from the Zod schemas. Per-service unit tests assert content anchors (`portfolio-construction` prompt contains `equityWeight`, `largestPositionWeight`, `assetClass`, the seven-class enum, the 5–12 positions cap; `advisory-narrative` prompt mentions `summary` ≥20 chars, `keyFactors` ≥1, etc. — symmetric with the existing `validation.ts` rules so prompt and validator agree).

**α.3 — Mode-envelope migration.** Phase 2's mode envelope is currently concatenated into `enrichedInput` at runtime in `portfolio-engine/graph.ts:103-117`. Move it INTO the prompt template's RULES block (per-mode rule string interpolated by `formatStructuredOutputPrompt`) so Sonnet weights it the same as the rest of the system instructions. The graph-level concatenation drops out.

### Phase β — Architectural fail-fast (your "C")

**β.1 — Reshape `with-fallback.ts`.** New return shape — discriminated union:

```typescript
export type AgentNodeResult =
  | { ok: true;  output: Record<string, unknown> }
  | { ok: false; reason: string; fallback: Record<string, unknown> };

export function withFallback(
  node: AgentNodeFn,
  fallbackFn: (input: Record<string, unknown>) => Record<string, unknown>,
): (state, config) => Promise<AgentNodeResult>;
```

`AgentNodeFn` itself stays string-keyed for back-compat; only the outermost `withFallback` returns the union.

**β.2 — Wave node propagates discriminant.** `create-orchestrator.ts` wave node returns `{ [agentKey]: AgentNodeResult }` instead of `{ [agentKey]: output }`. Downstream code reads `result[k].ok` to decide.

**β.3 — New `DegradedAgentOutputError`** in lib (`libs/agent-orchestrator/src/errors.ts`). Per-service `agent-service.ts` files check `result[k].ok === false` after the runtime call and throw `DegradedAgentOutputError({ decisionId, agent: k, reason, keys: Object.keys(result) })`. SF observes this as a TaskFailure, the cycle does NOT silent-succeed.

**β.4 — Memory write rule.** `graph.ts` `session.writeAgentOutput(result)` only writes if **all** agent results have `ok: true`. Partial-degraded cycles do not poison Memory for downstream agents.

### Phase γ — Defense-in-depth at lib level

**γ.1 — `assertOrchestratorOutput` helper.** New `libs/agent-orchestrator/src/assert-output.ts`:

```typescript
export function assertOrchestratorOutput(
  result: Record<string, unknown>,
  expectedKeys: readonly string[],
  context: { decisionId: string; agent: string },
): void;  // throws EmptyAgentResponseError when any expected key is missing OR maps to empty object/array
```

`EmptyAgentResponseError` is hoisted from `portfolio-engine-ctrl/src/agent-service.ts` to `libs/agent-orchestrator/src/errors.ts`. Tightened semantics per the BACKLOG entry: each expected key must point at a value with at least one defined sub-key (objects) or one element (arrays). All 4 advisory `agent-service.ts` files call this helper after `dispatchAgentInvocation`. **investor-profile + market-intelligence + advisory-narrative gain the guard they currently lack.**

**γ.2 — Structured-output shape retry in `agent-factory.ts`.** After `structured.invoke(prompt, runnableConfig)`:

```typescript
const result = await structured.invoke(prompt, runnableConfig);
if (looksDegraded(result, schema)) {
  // Retry once with tool_choice pinned to the schema's tool name and a stronger
  // prompt suffix — mirrors services/investor/onboarding-bff/src/agent/phase-node.ts
  // named-tool retry guard (Spec 3, 2026-05-01).
  const pinned = llm.withStructuredOutput(schema, { name: schemaToolName, includeRaw: false });
  const retried = await pinned.invoke(prompt + REINFORCE_SUFFIX, runnableConfig);
  if (looksDegraded(retried, schema)) {
    throw new DegradedStructuredOutputError(/* … */);
  }
  return retried;
}
return result;
```

`looksDegraded(result, schema)` returns true when the parsed object has zero defined keys among the schema's required fields. The retry path adds a `REINFORCE_SUFFIX` directive ("Your previous response had empty/missing fields. Re-emit with EVERY required field populated.") — Spec 3's exact playbook for onboarding's renderer-render_* tool, lifted to structured-output.

This single library-level change protects **all five LangGraph agents** (user-goals, risk-assessment, market-research, portfolio-construction, rebalance-planner, explainability — six in total when counting investor-profile's two waves) without touching any service code.

## Validation gate

Sequential, blocking. Same shape as Spec 3.

1. **Lib unit suites green** — `libs/agent-orchestrator/test/{format-prompt,with-fallback,with-retry,create-orchestrator,agent-factory,assert-output}.test.ts`. Total expected: existing + ~12 new tests across the new helpers + reshaped fallback.
2. **Per-service unit suites green** — all four advisory `test/unit/agents/{prompts,schemas,validation,fallbacks,golden-fixtures}.test.ts` + `agent-service.test.ts`. Adds prompt-content anchor assertions (each agent's prompt mentions its key required schema fields).
3. **Integration smoke against deployed dev** — `pnpm nx run portfolio-engine-ctrl:test-integration` + `advisory-narrative-ctrl:test-integration` + the other two. Validates upstream wiring still passes.
4. **CloudWatch log assertion** — pull container logs for one fresh e2e cycle. Assert `Orchestrator invocation completed duration` lines exceed 30000ms (real LLM call) and `responsePreview` shows populated keys, not `{}`. This is the **single direct check** that the runtime-level fix landed; lib unit tests cannot exercise the real Bedrock surface.
5. **E2E gate** — `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` returns 3/3 GREEN. Same trigger yields mode-differentiated `proposedTrades` shape (CONSERVATIVE bands ≤30% equity / 3–5 positions, AGGRESSIVE ≥70% equity / 6–12 positions). This is also the **natural revalidation of Operating Mode Phase 2** — moves Phase 2 from `SHIPPED-PENDING-VALIDATION` → `SHIPPED`.

## Risk register

- **Bedrock cost.** Phase γ.2's structured-output retry doubles cost on the failure path. Steady-state (per Spec 3 onboarding ship) the retry guard never fires once prompts are clean — but the AGENT_MODEL_OVERRIDE cost-cap remains the floor. No new cost regime.
- **Schema vs prompt drift.** Phase α embeds a JSON example of each schema in the prompt. If a schema changes, the prompt drifts. Mitigated by per-service prompt-content anchor tests that grep for current schema field names — schema rename forces prompt update in the same PR.
- **Fallback unreachability.** Phase β makes fallbacks effectively dead code (they fire but the wave node marks `ok: false`, the cycle fails). Acceptable — fallbacks were a misfeature in this domain (silent-success is worse than fail-fast for advisory). Their content stays for auditability but is no longer load-bearing.
- **Phase ordering.** α first; if α alone closes the e2e gate (per Spec 3 precedent — onboarding's named-tool retry never fired because prompt cleanup was sufficient), β + γ ship anyway as anti-fragility (no rollback). If α does NOT close the gate, β + γ surface the actual failure mode in CloudWatch instead of `proposedTrades: []`.
- **AgentCore Runtime redeploy required.** All four `agents/*/server.ts` containers must rebuild + redeploy after lib + service changes. Already-on-the-shelf via `pnpm nx run-many -t build-agent` followed by per-service deploy.

## References

- `docs/architecture/SYSTEM-ARCHITECTURE.md` §14 (advisory cycle), §17 (AgentCore Runtime contract).
- `docs/architecture/SERVICE-INVENTORY.md` — `portfolio-engine-ctrl`, `advisory-narrative-ctrl`, `investor-profile-ctrl`, `market-intelligence-ctrl`.
- `flows/advisory-cycle.flow.yaml` Phase 2c/2d (LangGraph waves).
- Predecessor Spec 3 — `docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md` (commit `fa78514c`).
- BACKLOG entry — `[bug] Agent runtime returns degraded structured output` (slot 1 → ACTIVE 2026-05-06).
- Memory topic — `project_agent_runtime_structured_output.md` (to be created at ship).

## Open questions

1. **`assertOrchestratorOutput` granularity.** Should the helper inspect schema-required fields (deep check) or just first-level keys (shallow)? Shallow is simpler; deep catches more cases but couples lib to Zod's introspection API. **Recommend: shallow first, escalate if a degraded-but-not-empty case slips through.**
2. **Phase α prompt-content tests — Italian or English?** Existing onboarding tests assert Italian phrases (user-facing language). Advisory agents are server-side only — recommend English content + per-mode rule strings, no localization concern.
3. **Should `formatStructuredOutputPrompt` live in `libs/agent-orchestrator` or in a new `libs/agent-prompts`?** Recommend keeping it in `agent-orchestrator` for now — promotion to a separate lib only if a non-advisory caller appears (none today; onboarding has its own custom AbstractAgent and is out of scope).
