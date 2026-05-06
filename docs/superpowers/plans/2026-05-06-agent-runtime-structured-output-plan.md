# Agent Runtime — Structured-Output Reliability Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the silent-success failure mode where AgentCore Runtime invocations return in 10–15s with empty `{}` agent results that pass through the decorator stack untouched, producing `DecisionPacket.proposedTrades: []` on every advisory cycle. Three coupled fixes — most-decisive-first per Spec 3 onboarding playbook: (α) rewrite the four advisory agents' prompts behind a uniform library-level helper; (β) reshape `withFallback` to a discriminated union so wave-node output marks degraded paths and the per-service `agent-service.ts` fails fast with `DegradedAgentOutputError` instead of silently writing `{}` to AgentCore Memory; (γ) hoist the empty-output guard out of `portfolio-engine-ctrl` (currently the only service with one) into a library helper consumed by all four services, plus a `tool_choice`-pinned structured-output retry inside `agent-factory.ts` mirroring onboarding-bff's named-tool retry guard from Spec 3.

**Architecture:** Five-phase rollout. α (lib helper + 6 prompt rewrites + invariant tests) ships first because Spec 3 precedent says prompt cleanup is the actual fix and the rest is anti-fragility. β (lib `withFallback` reshape + per-service consumption) is the architectural fail-fast you accepted as approach C. γ (lib `assertOrchestratorOutput` + `agent-factory.ts` retry guard) is defense-in-depth that also closes three latent variants of the same bug in `investor-profile-ctrl`, `market-intelligence-ctrl`, and `advisory-narrative-ctrl` (none currently have empty-output guards). δ rebuilds and redeploys the four AgentCore Runtime containers and runs integration smoke against deployed dev. ε runs the e2e gate (`operating-mode-recommendation-shape.e2e.test.ts`) which, on green, also revalidates Operating Mode Phase 2 from `SHIPPED-PENDING-VALIDATION` → `SHIPPED`.

**Tech Stack:** TypeScript 5.x, Nx monorepo, `libs/agent-orchestrator` (LangGraph.js + `@langchain/aws` + Bedrock data-plane SDK), AWS CDK 6-construct pattern, AgentCore Runtime (Hono on port 8080 inside ARM64 Docker via `build-agent` esbuild target), Bedrock inference profile IDs (`us.anthropic.claude-{haiku-4-5,sonnet-4-6,opus-4-6-v1}`), Zod schemas via `withStructuredOutput`, Jest with `aws-sdk-client-mock` and `MockChatBedrockConverse`.

**Workstream conventions:**
- All commits go directly to `main` (no feature branch / PR ceremony).
- Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (matches recent practice — Phase 2 `515b3f15`, assemble-packet fix `864d31a6`).
- Phases α, β, γ are local code + commits; safe to execute back-to-back.
- Phase δ (deploy + AgentCore Runtime container rebuild) requires explicit user confirmation before `pnpm nx run-many -t build-agent` + the per-service deploy commands — these rotate the live runtimes in dev.
- After every phase: run the verification commands listed under "Acceptance criteria" and STOP if any fail. Investigate root cause; do not bypass with `--testPathIgnorePatterns` or similar.
- Open questions resolved by user 2026-05-06: shallow first-level key check in `assertOrchestratorOutput` (escalate to deep schema introspection only if a degraded-but-non-empty case slips through); English prompt content (advisory agents are server-side only — no localization concern); `formatStructuredOutputPrompt` lives in `libs/agent-orchestrator` (no separate `libs/agent-prompts` until a non-advisory caller appears).

**Spec reference:** `docs/superpowers/specs/2026-05-06-agent-runtime-structured-output-design.md`.

**Predecessor:** `docs/superpowers/specs/2026-05-01-onboarding-tool-call-reliability-design.md` (Spec 3, commit `fa78514c`) — onboarding-bff's CopilotKit `AbstractAgent` got the same Sonnet 4.6 zero-tool-call treatment via prompt cleanup + named-tool retry. This plan applies the equivalent playbook to the advisory `agent-orchestrator` path.

**BACKLOG entry:** `[bug] Agent runtime returns degraded structured output (e2e gate blocker)` — adopted as ACTIVE 2026-05-06.

---

## Out of scope

Per `CLAUDE.md` § "Backlog Discipline". If any of these surface during execution, invoke `backlog-add` and continue. Do not pivot mid-flight unless the finding actually blocks the active workstream's done-definition.

- **Onboarding agent** (`services/investor/onboarding-bff/src/agent/`) — uses a custom `AbstractAgent` (CopilotKit AG-UI), not `libs/agent-orchestrator`. Already hardened in Spec 3 (commit `fa78514c`). This plan touches only the advisory `agent-orchestrator` path.
- **AgentCore Memory namespace mismatch / dual `DECISION_PACKET_CREATED` race / advisory-bff `onDecisionUpdate` WSS premature close** — separately filed in PARKING LOT.
- **`updateOperatingMode` mutation re-derivation gap** — separately filed.
- **Stale `session.readUpstreamOutput('advisory-ctrl')` in two `graph.ts` files** — separately filed.
- **Rewriting AgentCore Runtime container image / Bedrock SDK retry config** — Bedrock SDK retries are appropriate as-is; this plan does NOT touch transport layer.
- **Fallback CONTENT tuning** (per-mode fallback shapes, etc.) — fallbacks become unreachable in practice once `withFallback` marks-degraded; their content is no longer load-bearing for the e2e gate.
- **Step Functions task-level retry** — adding `addRetry` on agent-invocation states is tempting but premature. Surface the bug as a SF TaskFailure with a clear cause first; decide on transport-level retry only if a separate workstream requires it.
- **Re-tuning operating-mode envelope thresholds** — Phase 2 envelope (CONSERVATIVE ≤ 30% equity / 3–5 positions; BALANCED 50–70% / 5–8; AGGRESSIVE 70–90% / 6–12) stays as-is; e2e gate still asserts the same shape.
- **Deep Zod schema introspection in `assertOrchestratorOutput`** — Q1 resolved as shallow first-level key check; revisit only if a degraded-but-non-empty case is observed.
- **Promotion of `formatStructuredOutputPrompt` to a separate `libs/agent-prompts`** — Q3 resolved as keep in `agent-orchestrator`; promote only if a non-advisory caller appears.
- **Italian-language prompt variants** — Q2 resolved as English (server-side only).

---

## File Structure (what gets touched)

**Created:**

- `libs/agent-orchestrator/src/format-prompt.ts` (Phase α)
- `libs/agent-orchestrator/test/format-prompt.test.ts` (Phase α)
- `libs/agent-orchestrator/src/errors.ts` (Phase β + γ — new file housing `DegradedAgentOutputError` and the hoisted `EmptyAgentResponseError`)
- `libs/agent-orchestrator/src/assert-output.ts` (Phase γ)
- `libs/agent-orchestrator/test/assert-output.test.ts` (Phase γ)

**Modified — `libs/agent-orchestrator` (Phases α, β, γ):**

- `src/index.ts` — export `formatStructuredOutputPrompt`, `DegradedAgentOutputError`, `EmptyAgentResponseError`, `assertOrchestratorOutput`, the new `AgentNodeResult` discriminated union, and the existing `AgentNodeFn` (no breaking renames).
- `src/with-fallback.ts` — return `Promise<AgentNodeResult>` instead of `Promise<Record<string, unknown>>` (Phase β).
- `src/with-validation.ts` — `AgentNodeFn` type stays as-is (string-keyed); only the outermost `withFallback` returns the union. Comment update only.
- `src/create-orchestrator.ts` — wave node accumulator switches to `{ [agentKey]: AgentNodeResult }`; comment clarifies that downstream consumers must check `.ok` (Phase β).
- `src/agent-factory.ts` — after `structured.invoke(prompt, runnableConfig)`, run `looksDegraded(result, schema)` and retry once with `tool_choice: <toolName>` + `REINFORCE_SUFFIX`. Throws `DegradedStructuredOutputError` on second failure (Phase γ.4).
- `test/with-fallback.test.ts` — assert discriminant shape (Phase β).
- `test/create-orchestrator.test.ts` — assert wave-node propagation (Phase β).
- `test/agent-factory.test.ts` — assert retry path with mock `looksDegraded` returning true on first call, false on second (Phase γ).

**Modified — `services/advisory/portfolio-engine-ctrl` (Phases α, β, γ):**

- `src/agents/prompts.ts` — both `portfolioConstructionPrompt` + `rebalancePlannerPrompt` rewrite via `formatStructuredOutputPrompt(...)` (Phase α).
- `agents/portfolio-engine/graph.ts` — drop the runtime mode-context concatenation (`modeContext = …\nReflect adherence in your output: …`); the per-mode RULES move into the prompt template (Phase α).
- `src/agent-service.ts` — drop local `EmptyAgentResponseError` class (Phase γ.1 hoists it to lib); replace local empty-keys check with `assertOrchestratorOutput(result, ['portfolio-construction', 'rebalance-planner'], { decisionId, agent: 'portfolio-engine' })` (Phase γ.3); add discriminant check `if (!result['portfolio-construction'].ok || !result['rebalance-planner'].ok) throw new DegradedAgentOutputError(...)` (Phase β.5). Note: discriminant check happens BEFORE assert-output because the helper unwraps `.output` internally.
- `test/unit/agents/prompts.test.ts` (likely created if not present) — content-anchor assertions: `equityWeight`, `largestPositionWeight`, `assetClass`, the seven-class enum, "5-12 positions" cap, `rationale`, schema field names, "MUST NOT" forbid-empty marker (Phase α).
- `test/unit/agent-service.test.ts` — update for hoisted error class import + discriminant path (Phases β, γ).

**Modified — `services/advisory/advisory-narrative-ctrl` (Phases α, β, γ):**

- `src/agents/prompts.ts` — `explainabilityPrompt` rewrite via `formatStructuredOutputPrompt` (Phase α).
- `agents/advisory-narrative/graph.ts` — no runtime mode-context concat to remove (advisory-narrative doesn't have one); but verify any embedded prompt-extension is moved to the helper.
- `src/agent-service.ts` — add discriminant check (Phase β.5); add `assertOrchestratorOutput(result, ['explainability'], ...)` call (Phase γ.3) — **first time this service has had any guard**.
- `test/unit/agents/prompts.test.ts` — content anchors: `summary` ≥ 20 chars (matches `validation.ts`), `rationale` ≥ 20 chars, `keyFactors` ≥ 1, `tone`, `wordCount` (Phase α).
- `test/unit/agent-service.test.ts` — update for new error paths (Phases β, γ).

**Modified — `services/advisory/investor-profile-ctrl` (Phases α, β, γ):**

- `src/agents/prompts.ts` — both `userGoalsPrompt` + `riskAssessmentPrompt` rewrite (Phase α).
- `agents/investor-profile/graph.ts` — verify any prompt-affecting concat moves to helper.
- `src/agent-service.ts` — add discriminant check (Phase β.5); add `assertOrchestratorOutput(result, ['user-goals', 'risk-assessment'], ...)` call (Phase γ.3) — **first time this service has had any guard**. Replace today's `result['user-goals'] ?? {}` / `result['risk-assessment'] ?? {}` with direct read after assert.
- `test/unit/agents/prompts.test.ts` — content anchors per schema (`goals` array, `timeHorizon`, `riskWillingness`, `riskScore`, `riskCategory` enum, etc.) (Phase α).
- `test/unit/agent-service.test.ts` — update (Phases β, γ).

**Modified — `services/advisory/market-intelligence-ctrl` (Phases α, β, γ):**

- `src/agents/prompts.ts` — `marketResearchPrompt` rewrite (Phase α).
- `agents/market-intelligence/graph.ts` — verify.
- `src/agent-service.ts` — add discriminant check (Phase β.5); add `assertOrchestratorOutput(result, ['market-research'], ...)` call (Phase γ.3) — **first time this service has had any guard**. Replace today's `result['market-research'] ?? {}` pass-through.
- `test/unit/agents/prompts.test.ts` — content anchors (`signals` array shape, `marketOutlook`, `confidenceScore`, `tickersMentioned`) (Phase α).
- `test/unit/agent-service.test.ts` — update (Phases β, γ).

**Not touched (verified out of scope):**

- `services/investor/onboarding-bff/` — Spec 3 territory.
- `libs/agent-orchestrator/src/{with-retry,with-validation,memory,kb-retrieval,resolve-runtime-target,dispatch-runtime,invoke-agentcore,invoke-mock,agent-server,agent-tracer,emitters/*}` — not on the failure path. Comment-only updates if a referenced symbol moves.
- `services/advisory/decision-workflow-ctrl/` — assemble-packet already fixed in commit `864d31a6`. SF wiring stays as Phase 2 left it.

---

## Phase α — Prompt rewrite + discipline helper (decisive)

**Goal:** Eliminate the 9–19-line stub-prompt failure mode. Every advisory prompt routes through a uniform helper that injects schema shape, worked example, MUST/MUST-NOT rules, and the forbid-empty directive that Spec 3's onboarding ship validated as the actual fix.

### Task α.1 — Library helper + invariant tests

- [ ] Create `libs/agent-orchestrator/src/format-prompt.ts`. Export interface and function:

  ```typescript
  export interface StructuredOutputPromptSpec {
    readonly role: string;
    readonly task: string;
    readonly schemaShape: string;        // multi-line JSON example matching the Zod schema
    readonly rules: readonly string[];   // imperative MUST / MUST NOT clauses
    readonly examples?: readonly string[];
    readonly forbidEmpty?: boolean;      // defaults true
  }

  export function formatStructuredOutputPrompt(spec: StructuredOutputPromptSpec): string;
  ```

- [ ] Output template (uniform across all advisory agents):

  ```
  ROLE: <role>

  TASK: <task>

  SCHEMA SHAPE — populate EVERY field:
  <schemaShape>

  RULES:
  - <rule 1>
  - <rule 2>
  - …

  EXAMPLES:
  <example 1>
  <example 2>

  You MUST call the structured-output tool with non-empty arguments. Returning empty fields is a hard failure — every required field above MUST be populated.

  Input: {input}
  ```

- [ ] `forbidEmpty: true` (default) emits the exact final paragraph above; `forbidEmpty: false` omits it.
- [ ] Create `libs/agent-orchestrator/test/format-prompt.test.ts`. Invariant tests:
  - [ ] Output contains the literal markers `ROLE:`, `TASK:`, `SCHEMA SHAPE`, `RULES:`, `Input: {input}`.
  - [ ] `examples` omitted → no `EXAMPLES:` block in output.
  - [ ] `forbidEmpty: false` → output does not contain "MUST call the structured-output tool".
  - [ ] `forbidEmpty: true` (default) → output contains the forbid-empty paragraph and `every required field above MUST be populated`.
  - [ ] Schema shape is rendered verbatim (no JSON re-parsing — preserves comments / formatting).
  - [ ] Rules are joined by `\n- ` with a leading `- `.
- [ ] Export from `libs/agent-orchestrator/src/index.ts`.

**Acceptance criteria:**
- `pnpm nx test agent-orchestrator` green.
- `pnpm nx lint agent-orchestrator` green.

### Task α.2 — Rewrite `portfolio-engine-ctrl` prompts

- [ ] In `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts`, replace both string literals with `formatStructuredOutputPrompt(...)` calls. Each prompt's `schemaShape` is a JSON example mirroring the Zod schema in `src/agents/schemas.ts` (e.g., for `portfolioConstructionPrompt`: an `allocations` array with two example entries showing all five fields including `assetClass`, plus `totalExposure`, `equityWeight`, `riskMetrics`, `confidence`).
- [ ] Each prompt's `rules` array carries the schema-derived constraints PLUS the per-mode envelope clauses (5 rules for portfolio-construction): equity weight band per mode, single-position cap per mode, position count per mode, asset class enumeration, rationale required.
- [ ] Phase α.6 below moves the per-mode RULES from `graph.ts` runtime concat into a function `buildPortfolioConstructionPrompt(mode: OperatingMode): string` exported from `prompts.ts` (because mode is per-invocation). The exported `portfolioConstructionConfig` keeps `promptTemplate: string` static — reconcile by: either (a) make `promptTemplate` accept a callback, or (b) inject mode at the `graph.ts` level via the `enrichedInput` string but have the BASE prompt already contain a per-mode rule slot. **Recommend (b)** — simpler, no `agent-orchestrator` API change. The base prompt's RULES list contains:
  - `Operating mode behavioural envelope is provided in the Input below; you MUST honour the equity weight band, single-position cap, and position count specified there.`
  - …followed by all the schema-derived rules.
  - The mode envelope itself stays as `modeContext` text in `graph.ts:103-117` — but its language strengthens to "These are HARD RULES for this invocation" so the model weights it correctly when reading from the user message.
- [ ] Same approach for `rebalancePlannerPrompt`.
- [ ] Create `services/advisory/portfolio-engine-ctrl/test/unit/agents/prompts.test.ts` with anchor assertions per the §File Structure list above.

**Acceptance criteria:**
- `pnpm nx test portfolio-engine-ctrl` green.
- `pnpm nx lint portfolio-engine-ctrl` green.
- `grep -c 'formatStructuredOutputPrompt' services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts` returns 2.

### Task α.3 — Rewrite `advisory-narrative-ctrl` prompts

- [ ] Same playbook as α.2 for `services/advisory/advisory-narrative-ctrl/src/agents/prompts.ts` (`explainabilityPrompt` only).
- [ ] Schema example: `summary`, `rationale`, `keyFactors` (3-element array), `tone`, `wordCount`, `confidence`.
- [ ] Rules align with `services/advisory/advisory-narrative-ctrl/src/agents/validation.ts` (`summary` ≥ 20 chars, `rationale` ≥ 20 chars, `keyFactors.length ≥ 1`, `wordCount ≤ 2000`).
- [ ] Create / update `test/unit/agents/prompts.test.ts` with anchor assertions.

**Acceptance criteria:**
- `pnpm nx test advisory-narrative-ctrl` green.
- `grep -c 'formatStructuredOutputPrompt' services/advisory/advisory-narrative-ctrl/src/agents/prompts.ts` returns 1.

### Task α.4 — Rewrite `investor-profile-ctrl` prompts

- [ ] Same for `services/advisory/investor-profile-ctrl/src/agents/prompts.ts` (`userGoalsPrompt` + `riskAssessmentPrompt`).
- [ ] Schema examples derived from `GoalInterpretationSchema` + `RiskEvaluationSchema` in `src/agents/schemas.ts`.
- [ ] `test/unit/agents/prompts.test.ts`.

**Acceptance criteria:**
- `pnpm nx test investor-profile-ctrl` green.
- `grep -c 'formatStructuredOutputPrompt' services/advisory/investor-profile-ctrl/src/agents/prompts.ts` returns 2.

### Task α.5 — Rewrite `market-intelligence-ctrl` prompts

- [ ] Same for `services/advisory/market-intelligence-ctrl/src/agents/prompts.ts` (`marketResearchPrompt`).
- [ ] Schema example derived from `MarketAnalysisOutputSchema`.
- [ ] `test/unit/agents/prompts.test.ts`.

**Acceptance criteria:**
- `pnpm nx test market-intelligence-ctrl` green.
- `grep -c 'formatStructuredOutputPrompt' services/advisory/market-intelligence-ctrl/src/agents/prompts.ts` returns 1.

### Task α.6 — Mode-envelope language strengthening

- [ ] In `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts`:
  - [ ] Tighten the `modeContext` strings (lines 103-117) so each starts with `OPERATING MODE: <MODE>. THESE ARE HARD RULES FOR THIS INVOCATION — violating any clause is a hard failure.` (current language is `You MUST: …`).
  - [ ] Append explicit reference to the schema fields the mode controls: `equityWeight`, `riskMetrics.largestPositionWeight`, `allocations.length`, per-allocation `assetClass`. (Already present in the trailing reflective sentence — verify it survives the tightening.)
  - [ ] Update `services/advisory/portfolio-engine-ctrl/test/unit/graph.test.ts` mode-envelope assertions if present.
- [ ] In `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`:
  - [ ] Add a parallel `modeContext` if Phase 2 left it absent for narrative (verify by reading `agents/advisory-narrative/graph.ts` — Phase 2 commit `515b3f15` modified this file; check that mode is currently injected. If yes, tighten language.) The user-visible narrative tone differs by mode (CONSERVATIVE: reassuring; AGGRESSIVE: opportunity-framing) — clauses already in the prompt should be re-marked HARD.
- [ ] No changes needed in `investor-profile-ctrl/agents/.../graph.ts` or `market-intelligence-ctrl/agents/.../graph.ts` — those agents are not mode-conditional.

**Acceptance criteria:**
- `pnpm nx test portfolio-engine-ctrl advisory-narrative-ctrl` green.
- `grep -c 'HARD RULES' services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts` ≥ 1.

### Task α.7 — Commit

- [ ] `git add libs/agent-orchestrator/src/format-prompt.ts libs/agent-orchestrator/test/format-prompt.test.ts libs/agent-orchestrator/src/index.ts services/advisory/{portfolio-engine,advisory-narrative,investor-profile,market-intelligence}-ctrl/src/agents/prompts.ts services/advisory/*/test/unit/agents/prompts.test.ts services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts`
- [ ] Commit message:

  ```
  feat(agent-orchestrator): structured-output prompt discipline + advisory rewrites

  Phase α of the agent-runtime structured-output workstream. Adds a uniform
  formatStructuredOutputPrompt helper to libs/agent-orchestrator and rewrites
  all six advisory agent prompts (user-goals, risk-assessment, market-research,
  portfolio-construction, rebalance-planner, explainability) behind it so each
  carries an explicit schema shape, MUST/MUST-NOT rules, and the forbid-empty
  directive Spec 3 (2026-05-01) validated as the decisive fix for Sonnet 4.6's
  zero-tool-call symptom on the onboarding side.

  Operating Mode envelope language in portfolio-engine + advisory-narrative
  graph.ts tightened to "HARD RULES" framing so the model weights the per-
  invocation per-mode constraints alongside the now-stronger system prompt.

  Spec: docs/superpowers/specs/2026-05-06-agent-runtime-structured-output-design.md
  Plan: docs/superpowers/plans/2026-05-06-agent-runtime-structured-output-plan.md
  Phase: α (decisive — Spec 3 onboarding precedent)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

**Acceptance criteria:**
- `git log -1 --name-only` shows the expected file set.
- `pnpm nx run-many -t test --projects=agent-orchestrator,portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl` green.
- `pnpm nx run-many -t lint --projects=agent-orchestrator,portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl` green.

---

## Phase β — `withFallback` discriminant + fail-fast (your "C")

**Goal:** Stop the silent-success failure mode at the architectural level. After this phase, an agent that returns `{}` or whose decorator stack falls back to the static fallback marks the wave-node output as degraded; per-service `agent-service.ts` raises `DegradedAgentOutputError` instead of writing the empty result to AgentCore Memory.

### Task β.1 — Reshape `with-fallback.ts`

- [ ] Create `libs/agent-orchestrator/src/errors.ts`:

  ```typescript
  export class DegradedAgentOutputError extends Error {
    readonly decisionId: string;
    readonly agent: string;
    readonly reason: string;
    readonly responseKeys: string[];
    constructor(args: { decisionId: string; agent: string; reason: string; responseKeys: string[] });
  }

  export class DegradedStructuredOutputError extends Error {
    readonly schemaName: string;
    readonly attempts: number;
    constructor(args: { schemaName: string; attempts: number });
  }

  export class EmptyAgentResponseError extends Error {
    readonly decisionId: string;
    readonly responseKeys: string[];
    readonly missingOrEmptyKeys: string[];
    constructor(args: { decisionId: string; responseKeys: string[]; missingOrEmptyKeys: string[] });
  }
  ```

- [ ] Modify `libs/agent-orchestrator/src/with-fallback.ts` to return a discriminated union:

  ```typescript
  import type { AgentNodeFn } from './with-validation';

  export type AgentNodeResult =
    | { ok: true;  output: Record<string, unknown> }
    | { ok: false; reason: string; fallback: Record<string, unknown> };

  export type AgentNodeWithFallback = (
    state: Record<string, unknown>,
    config?: any,
  ) => Promise<AgentNodeResult>;

  export function withFallback(
    node: AgentNodeFn,
    fallbackFn: (input: Record<string, unknown>) => Record<string, unknown>,
  ): AgentNodeWithFallback {
    return async (state, config) => {
      try {
        const output = await node(state, config);
        return { ok: true, output };
      } catch (err) {
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        return { ok: false, reason, fallback: fallbackFn(state) };
      }
    };
  }
  ```

- [ ] Update `libs/agent-orchestrator/test/with-fallback.test.ts`:
  - [ ] Happy path → `{ok: true, output: <node output>}`.
  - [ ] Node throws → `{ok: false, reason: 'Error: <msg>', fallback: <fallbackFn(state)>}`.
  - [ ] Reason captures error name + message.
  - [ ] Fallback function is invoked with the original state.

**Acceptance criteria:**
- `pnpm nx test agent-orchestrator -- --testPathPatterns=with-fallback` green.

### Task β.2 — Wave node propagates the discriminant

- [ ] Modify `libs/agent-orchestrator/src/create-orchestrator.ts:55-66`. The wave node accumulator now produces `{ [agentKey]: AgentNodeResult }` because the leaf `nodeMap[k]` (post-`withFallback`) returns `AgentNodeResult`.
- [ ] Update the `nodeMap` typing: when `fallbacks?.[key]` is provided, the entry has type `AgentNodeWithFallback`; otherwise stays `AgentNodeFn`. The wave node normalises by wrapping non-fallback nodes: `{ ok: true, output }` after invocation.
- [ ] Concretely:

  ```typescript
  const nodeMap: Record<string, AgentNodeWithFallback> = {};
  for (const [key, agentConfig] of Object.entries(agents) as [K, typeof agents[K]][]) {
    let bareNode: AgentNodeFn = createAgentNode(agentConfig);
    if (validationRules?.[key]) bareNode = withValidation(bareNode, validationRules[key]);
    const tier = …;
    bareNode = withRetry(bareNode, { ...defaultRetry, escalationPath });
    if (fallbacks?.[key]) {
      nodeMap[key] = withFallback(bareNode, fallbacks[key] as any);
    } else {
      // Adapt: a node without an explicit fallback still surfaces ok/error via the same union.
      nodeMap[key] = async (state, config) => {
        try { return { ok: true, output: await bareNode(state, config) }; }
        catch (err) {
          const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          return { ok: false, reason, fallback: {} };
        }
      };
    }
  }
  ```

- [ ] Wave-node body stays the same:

  ```typescript
  fn: async (state) => {
    const results = await Promise.all(
      wave.agents.map(async (agentKey) => ({ [agentKey]: await nodeMap[agentKey](state) })),
    );
    return Object.assign({}, ...results);
  },
  ```

- [ ] Update `libs/agent-orchestrator/test/create-orchestrator.test.ts` — assert wave output contains `.ok` discriminant on each agent key.

**Acceptance criteria:**
- `pnpm nx test agent-orchestrator -- --testPathPatterns=create-orchestrator` green.

### Task β.3 — `index.ts` exports

- [ ] In `libs/agent-orchestrator/src/index.ts`, export:
  - `formatStructuredOutputPrompt`, `StructuredOutputPromptSpec` (already added in α).
  - `DegradedAgentOutputError`, `DegradedStructuredOutputError`, `EmptyAgentResponseError`.
  - `AgentNodeResult`, `AgentNodeWithFallback`.
  - Existing exports stay.

### Task β.4 — Update `graph.ts` write-to-Memory rule (per service)

For each of the four advisory services, in `services/advisory/<svc>/agents/<agent>/graph.ts`:

- [ ] After `invokeOrchestrator(graph, ...)`, the returned `result` now has shape `{ [k]: AgentNodeResult }`. Update the Memory write block:

  ```typescript
  // Before:
  if (!('serviceUnavailable' in result)) {
    await session.writeAgentOutput(result);
  }
  return result;

  // After:
  if (!('serviceUnavailable' in result)) {
    const allOk = Object.values(result).every((r): r is { ok: true; output: Record<string, unknown> } =>
      typeof r === 'object' && r !== null && (r as any).ok === true,
    );
    if (allOk) {
      // Strip the discriminant — Memory consumers expect raw outputs, not the union.
      const stripped = Object.fromEntries(
        Object.entries(result).map(([k, v]) => [k, (v as any).output]),
      );
      await session.writeAgentOutput(stripped);
    }
  }
  return result;
  ```

- [ ] Test files for each `graph.ts` (`services/advisory/<svc>/test/unit/graph.test.ts`) — assert no Memory write when any agent has `ok: false`.

**Acceptance criteria:**
- All 4 graph.ts files updated.
- `pnpm nx test portfolio-engine-ctrl advisory-narrative-ctrl investor-profile-ctrl market-intelligence-ctrl` green.

### Task β.5 — Per-service `agent-service.ts` consumes discriminant

For each of the four `services/advisory/<svc>/src/agent-service.ts`:

- [ ] After `dispatchAgentInvocation(...)` returns:

  ```typescript
  const result = await dispatchAgentInvocation<Record<string, AgentNodeResult>>(target, { … });

  // β.5: discriminant check — fail loudly on degraded outputs
  for (const [k, v] of Object.entries(result)) {
    if (typeof v !== 'object' || v === null || (v as any).ok !== true) {
      const reason = (v as any)?.reason ?? 'unknown — non-discriminant shape';
      throw new DegradedAgentOutputError({
        decisionId,
        agent: k,
        reason,
        responseKeys: Object.keys(result),
      });
    }
  }

  // From here on, every result[k] is { ok: true, output: ... }
  ```

- [ ] Use the unwrapped outputs in the downstream Memory / DDB write path:

  ```typescript
  // portfolio-engine-ctrl example:
  return {
    decisionId,
    allocations: (result['portfolio-construction'] as { ok: true; output: Record<string, unknown> }).output,
    trades:      (result['rebalance-planner']     as { ok: true; output: Record<string, unknown> }).output,
    metadata: { …, modeUsed: subject.operatingMode ?? 'BALANCED' },
  };
  ```

- [ ] Update `test/unit/agent-service.test.ts` for each service — add a "agent returns ok:false → throws DegradedAgentOutputError" case + happy path passes through `.output`.
- [ ] **Mock fixtures** — `test/mocks/mock-agent-runtime.ts` per service must update its returned shape to `{key: {ok:true, output:{...}}}`. The MockApiFixture-deployed Function URL is what integration tests hit; updating the mock's response prevents integration smoke regressions.

**Acceptance criteria:**
- All 4 agent-service.ts files updated.
- All 4 mock-agent-runtime.ts files updated.
- `pnpm nx test portfolio-engine-ctrl advisory-narrative-ctrl investor-profile-ctrl market-intelligence-ctrl` green.

### Task β.6 — Commit

- [ ] `git add libs/agent-orchestrator/src/{errors.ts,with-fallback.ts,create-orchestrator.ts,index.ts} libs/agent-orchestrator/test/{with-fallback,create-orchestrator}.test.ts services/advisory/*/agents/*/graph.ts services/advisory/*/src/agent-service.ts services/advisory/*/test/unit/{graph,agent-service}.test.ts services/advisory/*/test/mocks/mock-agent-runtime.ts`
- [ ] Commit message:

  ```
  feat(agent-orchestrator): withFallback discriminant + DegradedAgentOutputError

  Phase β of the agent-runtime structured-output workstream. Reshapes
  withFallback to return a discriminated union { ok: true; output } |
  { ok: false; reason; fallback } so the wave-node output marks degraded
  agent paths instead of laundering them into static fallbacks. Per-service
  agent-service.ts raises DegradedAgentOutputError on any ok:false; SF
  observes a TaskFailure with a clear cause instead of silent success
  followed by proposedTrades:[].

  Memory write at graph.ts becomes all-or-nothing: a partial-degraded cycle
  no longer poisons AgentCore Memory for downstream agents.

  Adapter wraps non-fallback nodes in the same union shape so consumers don't
  need to special-case the absent-fallback configuration.

  Spec: docs/superpowers/specs/2026-05-06-agent-runtime-structured-output-design.md
  Plan: docs/superpowers/plans/2026-05-06-agent-runtime-structured-output-plan.md
  Phase: β (architectural fail-fast — user choice "C")

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

**Acceptance criteria:**
- `pnpm nx run-many -t test --projects=agent-orchestrator,portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl` green.
- `pnpm nx run-many -t lint --projects=agent-orchestrator,portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl` green.

---

## Phase γ — `assertOrchestratorOutput` + structured-output retry

**Goal:** Two library-level defense-in-depth fixes. γ.1–γ.3 hoists the empty-output guard out of `portfolio-engine-ctrl` (the only service that has one) into a lib helper consumed by all four services — closing three latent variants of the same bug. γ.4–γ.5 adds a structured-output retry inside `agent-factory.ts` mirroring onboarding-bff's named-tool retry guard.

### Task γ.1 — Hoist `EmptyAgentResponseError`

- [ ] Already added to `libs/agent-orchestrator/src/errors.ts` in β.1. Verify exports.
- [ ] Delete the local `EmptyAgentResponseError` class in `services/advisory/portfolio-engine-ctrl/src/agent-service.ts:22-33`. Replace import to use the lib version.
- [ ] Update `services/advisory/portfolio-engine-ctrl/test/unit/agent-service.test.ts` import.

### Task γ.2 — `assertOrchestratorOutput` helper

- [ ] Create `libs/agent-orchestrator/src/assert-output.ts`:

  ```typescript
  import { EmptyAgentResponseError } from './errors';
  import type { AgentNodeResult } from './with-fallback';

  /**
   * Shallow first-level key check (Q1 resolved 2026-05-06: shallow first;
   * escalate to deep schema introspection only if a degraded-but-non-empty
   * case slips through).
   *
   * After β, every wave-node output value is an AgentNodeResult discriminated
   * union. This helper unwraps `.output` and asserts that:
   *   - every expectedKey is present in the result,
   *   - every expectedKey's `.output` is a non-empty object (>= 1 own property)
   *     OR a non-empty array (>= 1 element).
   *
   * Intended to run AFTER the per-service discriminant check (Phase β.5) — the
   * helper assumes it's only called on results where every entry is ok:true.
   */
  export function assertOrchestratorOutput(
    result: Record<string, AgentNodeResult>,
    expectedKeys: readonly string[],
    context: { decisionId: string; agent: string },
  ): void {
    const missingOrEmpty: string[] = [];
    for (const key of expectedKeys) {
      const entry = result[key];
      if (!entry || entry.ok !== true) {
        missingOrEmpty.push(key);
        continue;
      }
      const output = entry.output;
      if (Array.isArray(output)) {
        if (output.length === 0) missingOrEmpty.push(key);
      } else if (typeof output === 'object' && output !== null) {
        if (Object.keys(output).length === 0) missingOrEmpty.push(key);
      } else {
        missingOrEmpty.push(key);
      }
    }
    if (missingOrEmpty.length > 0) {
      throw new EmptyAgentResponseError({
        decisionId: context.decisionId,
        responseKeys: Object.keys(result),
        missingOrEmptyKeys: missingOrEmpty,
      });
    }
  }
  ```

- [ ] Create `libs/agent-orchestrator/test/assert-output.test.ts`. Cases:
  - [ ] All expected keys present + non-empty objects → no throw.
  - [ ] One expected key missing → throws with `missingOrEmptyKeys: [key]`.
  - [ ] One expected key maps to `{ok: true, output: {}}` → throws.
  - [ ] One expected key maps to `{ok: true, output: []}` → throws.
  - [ ] One expected key maps to `{ok: false, ...}` → throws (defensive).
  - [ ] All expected keys map to non-empty arrays → no throw.

- [ ] Export `assertOrchestratorOutput` from `libs/agent-orchestrator/src/index.ts`.

**Acceptance criteria:**
- `pnpm nx test agent-orchestrator -- --testPathPatterns=assert-output` green.

### Task γ.3 — All 4 services consume `assertOrchestratorOutput`

For each `services/advisory/<svc>/src/agent-service.ts`:

- [ ] After β.5's discriminant check + before the unwrap-and-write block:

  ```typescript
  assertOrchestratorOutput(
    result,
    ['<key1>', '<key2>'],   // service-specific
    { decisionId, agent: '<service-key>' },
  );
  ```

- [ ] Service-to-keys mapping (verify against each `graph.ts`):

  | Service | Expected keys |
  |---|---|
  | `investor-profile-ctrl` | `['user-goals', 'risk-assessment']` |
  | `market-intelligence-ctrl` | `['market-research']` |
  | `portfolio-engine-ctrl` | `['portfolio-construction', 'rebalance-planner']` |
  | `advisory-narrative-ctrl` | `['explainability']` |

- [ ] Delete `portfolio-engine-ctrl/src/agent-service.ts:80-93` local empty-keys check; replaced by the helper call.
- [ ] Update each `test/unit/agent-service.test.ts` to assert that `result['<key>'] = {ok: true, output: {}}` triggers `EmptyAgentResponseError` (not just `DegradedAgentOutputError` from β).

**Acceptance criteria:**
- All 4 agent-service.ts files updated.
- `grep -c 'assertOrchestratorOutput' services/advisory/*/src/agent-service.ts` returns 4 (one match per file).
- `pnpm nx run-many -t test --projects=portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl` green.

### Task γ.4 — Structured-output retry in `agent-factory.ts`

- [ ] In `libs/agent-orchestrator/src/agent-factory.ts`, after the existing `await structured.invoke(prompt, runnableConfig)`:

  ```typescript
  const REINFORCE_SUFFIX = '\n\nIMPORTANT: Your previous response had empty or missing required fields. Re-emit the structured-output tool call with EVERY required field populated. Returning empty fields again is a hard failure.';

  function looksDegraded(result: unknown, schema: z.ZodType): boolean {
    if (typeof result !== 'object' || result === null) return true;
    const keys = Object.keys(result as Record<string, unknown>);
    if (keys.length === 0) return true;
    // Check that at least one key from the schema's top-level shape is present
    // and non-empty. Shallow check (Q1 resolved 2026-05-06).
    const shape = (schema as any)._def?.shape?.() ?? (schema as any).shape ?? {};
    const requiredKeys = Object.keys(shape);
    if (requiredKeys.length === 0) return false;  // can't introspect — assume ok
    for (const k of requiredKeys) {
      const v = (result as Record<string, unknown>)[k];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length > 0) return false;
      if (typeof v === 'object' && Object.keys(v as Record<string, unknown>).length > 0) return false;
      if (typeof v === 'string' && v.length > 0) return false;
      if (typeof v === 'number') return false;
      if (typeof v === 'boolean') return false;
    }
    return true;
  }
  ```

- [ ] Wire the retry inside `createAgentNode`'s returned function:

  ```typescript
  const result = await structured.invoke(prompt, runnableConfig);
  if (looksDegraded(result, schema)) {
    // Attempt #2 with tool_choice pinned. Spec 3 onboarding precedent —
    // services/investor/onboarding-bff/src/agent/phase-node.ts named-tool retry.
    const schemaToolName = (schema as any)._def?.typeName ?? 'StructuredOutput';
    const pinned = llm.withStructuredOutput(schema as any, { name: schemaToolName, includeRaw: false });
    const retried = await pinned.invoke(prompt + REINFORCE_SUFFIX, runnableConfig);
    if (looksDegraded(retried, schema)) {
      throw new DegradedStructuredOutputError({
        schemaName: schemaToolName,
        attempts: 2,
      });
    }
    return retried as Record<string, unknown>;
  }
  return result as Record<string, unknown>;
  ```

- [ ] Note: the retry path's `pinned.invoke()` thrown errors propagate to `withRetry` (which only catches `ValidationError` — fine, `DegradedStructuredOutputError` propagates out to `withFallback` which marks `ok: false` per β).

- [ ] Update `libs/agent-orchestrator/test/agent-factory.test.ts`:
  - [ ] Mock `structured.invoke` returns `{}` once → triggers retry → second call returns populated → returns populated.
  - [ ] Mock returns `{}` twice → throws `DegradedStructuredOutputError`.
  - [ ] Mock returns populated on first call → no retry, returns immediately (verify retry path NOT taken — assert mock called only once).
  - [ ] Telemetry: ensure retry call ALSO carries the `runnableConfig` callbacks so the AgentTracer captures both attempts.

**Acceptance criteria:**
- `pnpm nx test agent-orchestrator -- --testPathPatterns=agent-factory` green.
- `grep -c 'looksDegraded' libs/agent-orchestrator/src/agent-factory.ts` ≥ 2 (definition + usage).

### Task γ.5 — Commit

- [ ] `git add libs/agent-orchestrator/src/{assert-output.ts,agent-factory.ts,errors.ts,index.ts} libs/agent-orchestrator/test/{assert-output,agent-factory}.test.ts services/advisory/*/src/agent-service.ts services/advisory/*/test/unit/agent-service.test.ts`
- [ ] Commit message:

  ```
  feat(agent-orchestrator): assertOrchestratorOutput helper + structured-output retry

  Phase γ of the agent-runtime structured-output workstream. Two coupled
  defense-in-depth additions:

  γ.1-γ.3: Hoist EmptyAgentResponseError out of portfolio-engine-ctrl (the
  only service with a guard) into libs/agent-orchestrator. New helper
  assertOrchestratorOutput(result, expectedKeys, context) does a shallow
  first-level key check on the wave-node output and throws when any expected
  key is missing or maps to an empty object/array. All four advisory services
  consume the helper — investor-profile, market-intelligence, and
  advisory-narrative gain protection they did not previously have, closing
  three latent variants of the same bug.

  γ.4-γ.5: Inside agent-factory.ts, after structured.invoke(...) returns, run
  looksDegraded(result, schema). If true, retry once with tool_choice pinned
  to the schema's tool name and a REINFORCE_SUFFIX appended to the prompt
  ("Re-emit with EVERY required field populated"). Mirrors the named-tool
  retry guard at services/investor/onboarding-bff/src/agent/phase-node.ts
  from Spec 3 (2026-05-01) — but lifted from per-phase to per-agent so all
  five LangGraph agents benefit transparently. Second-attempt failure throws
  DegradedStructuredOutputError, which propagates to withFallback and marks
  the wave entry ok:false (Phase β handles from there).

  Spec: docs/superpowers/specs/2026-05-06-agent-runtime-structured-output-design.md
  Plan: docs/superpowers/plans/2026-05-06-agent-runtime-structured-output-plan.md
  Phase: γ (defense-in-depth)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

**Acceptance criteria:**
- `pnpm nx run-many -t test --projects=agent-orchestrator,portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl` green.
- `pnpm nx run-many -t lint --projects=agent-orchestrator,portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl` green.

---

## Phase δ — Build, deploy, integration smoke + CloudWatch assertion

**Goal:** Get the new code onto the four AgentCore Runtime containers in dev and prove that real Bedrock calls now produce non-empty outputs.

**⚠️ Requires explicit user confirmation before proceeding** — phase δ rotates the live runtimes in dev.

### Task δ.1 — Build agent containers

- [ ] `pnpm nx run-many -t build-agent --projects=portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl`
- [ ] Verify `services/advisory/<svc>/agents/<agent>/dist/bundle.js` exists for all four services.
- [ ] Spot-check bundle for the new symbols:

  ```bash
  grep -c 'formatStructuredOutputPrompt\|REINFORCE_SUFFIX\|looksDegraded' \
    services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/dist/bundle.js
  ```

  Expect ≥ 3.

**Acceptance criteria:**
- All 4 bundles built without esbuild error.
- Bundle grep returns expected matches.

### Task δ.2 — Deploy 4 agent runtime services

- [ ] **STOP — confirm with user.** Deploy script: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl`
- [ ] Wait for stack updates to settle (CDK deploy output reaches `✅ <stack>`).
- [ ] Sanity-check the new AgentCore Runtime endpoint via SSM lookup is unchanged (deploy should rotate the container under the same ARN).

**Acceptance criteria:**
- 4 stacks updated.
- No CFN rollback on any of the 4.

### Task δ.3 — Integration smoke against deployed dev

- [ ] `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration --projects=portfolio-engine-ctrl,advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl`
- [ ] Expect all four service integration suites green. The mock-agent-runtime stays in play for these — they validate the LIB and per-service wiring, not the live Bedrock call.

**Acceptance criteria:**
- 4 integration suites green.

### Task δ.4 — CloudWatch container-log assertion

- [ ] Trigger one fresh advisory cycle via the e2e fixture (manual): `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm jest --config apps/e2e-feature-tests/jest.config.js apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts -t 'BALANCED'`
- [ ] Pull container logs for the resulting decision:

  ```bash
  DECISION_ID=$(aws dynamodb scan --table-name dev-portfolio-engine-ctrl-StateTable… \
    --filter-expression '__typename = :t' --expression-attribute-values '{":t":{"S":"AgentInvocation"}}' \
    --query 'Items[-1].decisionId.S' --output text)
  aws logs filter-log-events \
    --log-group-name '/aws/bedrock-agentcore/runtimes/portfolio_engine_agents-DIbHQa6EdW-DEFAULT' \
    --filter-pattern "{$.runtimeSessionId = \"*${DECISION_ID}*\"}" \
    --max-items 50
  ```

- [ ] Assert in the log output:
  - [ ] `Orchestrator invocation completed duration` value > **30000** (30s — real LLM call, not the 10–15s degraded-empty pattern).
  - [ ] `responsePreview` field shows populated keys, NOT `{}` for `portfolio-construction` or `rebalance-planner`.
  - [ ] No `DegradedStructuredOutputError` or `DegradedAgentOutputError` lines.
  - [ ] Optional: at most one retry per agent invocation (search for `REINFORCE_SUFFIX` or "Re-emit" in any log line).

**Acceptance criteria:**
- Container logs show >30s duration AND populated responsePreview for at least one fresh invocation.
- This is the **single direct check** that the runtime-level fix landed; lib unit tests cannot exercise the real Bedrock surface.

---

## Phase ε — E2E gate + ship

### Task ε.1 — Run the e2e gate

- [ ] `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm jest --config apps/e2e-feature-tests/jest.config.js apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts`
- [ ] Expect 3/3 GREEN — same trigger yields mode-differentiated `proposedTrades` shape:
  - CONSERVATIVE: `equityWeight ≤ 0.30`, `largestPositionWeight ≤ 0.10`, `proposedTrades.length` between 3 and 5.
  - BALANCED: `equityWeight` in `[0.50, 0.70]`, `largestPositionWeight ≤ 0.15`, `proposedTrades.length` between 5 and 8.
  - AGGRESSIVE: `equityWeight ≥ 0.70`, `largestPositionWeight ≤ 0.25`, `proposedTrades.length` between 6 and 12.
- [ ] If any of the three fail with the correct shape but wrong-mode envelope, that's a prompt-content tuning issue (Phase α), not an architectural regression. Iterate on the failing mode's RULES strings; do NOT touch β/γ.
- [ ] If any fail with `DegradedAgentOutputError` or `EmptyAgentResponseError`, the lib retry didn't recover → check CloudWatch for `DegradedStructuredOutputError` and tune the prompt's `forbidEmpty` directive language.

**Acceptance criteria:**
- 3/3 GREEN against deployed dev.

### Task ε.2 — BACKLOG + memory close-out

- [ ] In `docs/BACKLOG.md`:
  - [ ] Move `[bug] Agent runtime returns degraded structured output` from `## ACTIVE` to the `## Recently shipped` table with today's date and commit hashes.
  - [ ] Update the file's "Last reviewed" + add a 2026-05-06 line summarising the ship.
  - [ ] Update Operating Mode Phase 2 Recently-shipped row from `SHIPPED-PENDING-VALIDATION` → `SHIPPED` with the e2e revalidation note.
  - [ ] Promote QUEUED slot 2 (`[infra] PR pipeline integration tests`) → slot 1.
  - [ ] If anything new surfaced during execution, add to PARKING LOT.

- [ ] Create `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_agent_runtime_structured_output.md` topic memory. Cover: workstream timeline, the three-phase structure, what made the prompt rewrite decisive vs the architectural fixes that prevent regression, the cross-service audit finding (only portfolio-engine had a guard), the Q1/Q2/Q3 resolutions, ship commits.

- [ ] Update `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`:
  - [ ] Add a one-line index entry under "## Topic Files" pointing to the new topic memory.
  - [ ] Update "## Recently Completed Work" — concise paragraph (one-liner only; full detail lives in topic memory per the >24KB MEMORY warning).

**Acceptance criteria:**
- BACKLOG diff visible.
- Memory files updated and pass the MEMORY.md ≤ 24.4KB ceiling (trim other entries if needed).

### Task ε.3 — Final commit + ship signal

- [ ] `git add docs/BACKLOG.md docs/superpowers/{specs,plans}/2026-05-06-agent-runtime-structured-output-*.md`
- [ ] Commit message:

  ```
  docs(backlog): ship agent-runtime structured-output reliability

  Adopted as ACTIVE 2026-05-06; shipped same day across three phases on main:
  - α (commit <hash>): formatStructuredOutputPrompt helper + 6 advisory prompts rewritten
  - β (commit <hash>): withFallback discriminant + DegradedAgentOutputError
  - γ (commit <hash>): assertOrchestratorOutput + structured-output retry guard

  E2E gate operating-mode-recommendation-shape.e2e.test.ts: 3/3 GREEN
  against deployed dev. Operating Mode Phase 2 promoted from
  SHIPPED-PENDING-VALIDATION → SHIPPED via natural revalidation.

  Cross-service audit during execution found only portfolio-engine-ctrl had
  any empty-output guard; investor-profile, market-intelligence, and
  advisory-narrative all silently passed result['key'] ?? {} to their Memory
  writes. All four services now share the lib-level assertOrchestratorOutput
  helper.

  Spec: docs/superpowers/specs/2026-05-06-agent-runtime-structured-output-design.md
  Plan: docs/superpowers/plans/2026-05-06-agent-runtime-structured-output-plan.md

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

**Acceptance criteria:**
- `git log -3 --oneline` shows α, β, γ commits + this docs commit.
- `pnpm nx affected -t lint` clean.
- BACKLOG ACTIVE section is empty (between workstreams) OR has the next slot promoted.

---

## Risk register (re-stated from spec for execution awareness)

- **Bedrock cost.** Phase γ.4's structured-output retry doubles cost on the failure path. Spec 3 onboarding precedent: prompt cleanup alone resolved the symptom and the retry guard never fired. Same expectation here. The `AGENT_MODEL_OVERRIDE` cost-cap remains the floor.
- **Schema vs prompt drift.** Phase α embeds JSON schema examples in prompts. Per-service prompt-anchor tests grep for current schema field names — schema rename forces prompt update in the same PR.
- **Fallback content unreachability.** Phase β makes fallbacks dead code in practice (they fire but the wave node still marks `ok: false`). Acceptable; fallbacks were a misfeature for advisory.
- **Phase ordering.** α first. If α alone closes the e2e gate (Spec 3 precedent), β + γ ship anyway as anti-fragility. If α does NOT close the gate, β + γ surface the failure mode in CloudWatch instead of `proposedTrades: []`.
- **AgentCore Runtime redeploy required.** All four `agents/*/server.ts` containers must rebuild + redeploy. Already automated via `pnpm nx run-many -t build-agent` followed by per-service deploy. δ requires user confirmation — destructive on dev.
- **Mock fixture drift (β).** The four `test/mocks/mock-agent-runtime.ts` files must update return shape to `{key: {ok:true, output:{...}}}`. If missed, integration smoke breaks even though lib unit tests pass.
