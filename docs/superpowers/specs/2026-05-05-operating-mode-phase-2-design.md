# Operating Mode Phase 2 — Agent Behavior Dimension

**Date:** 2026-05-05
**Status:** Proposed (pending approval)
**Scope:** `services/advisory/{decision-workflow-ctrl,investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl}/src/`, `apps/e2e-feature-tests/src/advisory/`
**Predecessor:** `docs/superpowers/specs/2026-04-14-operating-mode-implementation-design.md` (Phase 1 — compliance-ctrl mode-aware authority resolver, SHIPPED 2026-05-05)

## Problem

`operatingMode` is set at onboarding and lives on the composite `InvestorProfile` row. Phase 1 wired it into compliance-ctrl's authority thresholds. Phase 2's done-when remains: **same trigger event must yield mode-differentiated `proposedTrades` shape** so AGGRESSIVE/BALANCED/CONSERVATIVE actually changes what gets recommended, not just whether it auto-executes.

Verified by reading code 2026-05-05:
- `operatingMode` does NOT reach portfolio-engine or advisory-narrative today (zero refs across `services/advisory/{portfolio-engine-ctrl,advisory-narrative-ctrl}/src/` + `libs/agent-orchestrator/src/`).
- SF agent-invocation event subjects carry only `{decisionId, tenantId, taskToken}` (`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:53-67`).
- Both downstream prompts (`portfolio-engine-ctrl/src/agents/prompts.ts`, `advisory-narrative-ctrl/src/agents/prompts.ts`) are mode-agnostic — generic "consider risk/diversification" text.
- investor-profile-ctrl's event-listener reads `subject.investorProfile ?? subject.context ?? {}` (`services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts:32`) — currently `{}` because SF doesn't pass it. So even the upstream agent is mode-blind.
- agent outputs are written to AgentCore Memory via `session.writeAgentOutput(result)` and read by downstream agents via `session.searchLongTermMemory(...)` — the natural propagation channel.

## Approach: Path B — propagate via AgentCore Memory

investor-profile-ctrl receives `operatingMode` on its event subject, writes it as a first-class field in its agent output to AgentCore Memory, and downstream agents (portfolio-engine + advisory-narrative) read it from Memory and inject it into their prompts. Mode-specific behavioral rules live in the prompts themselves.

**Why Path B over plumbing through SF state on every agent event:**
- Symmetric with the existing pattern (upstream agents already publish output that downstream agents consume from Memory).
- Minimal SF changes (one agent invocation gets a new field, not three).
- agent-orchestrator lib stays unchanged; behavioral differentiation is per-agent prompt content.

### Step 1 — SF: add `operatingMode` to the ANALYZE_INVESTOR_PROFILE event

`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`:

- `UnpackTriggerEnvelope` (line 268-280) extracts `operatingMode` from `triggerContext` when present (INVESTOR_PROFILE_CREATED/UPDATED carry it on the composite payload). For the other 5 trigger types (DEPOSIT_DETECTED, PORTFOLIO_DRIFT_DETECTED, ORDER_*), default to `'BALANCED'` — see §Out of scope.
- The investor-profile invocation state (`createAgentInvocationState('InvokeInvestorProfile', 'ANALYZE_INVESTOR_PROFILE')`) gets a single new field on subject: `'operatingMode.$': '$.operatingMode'`. The other two downstream agent invocations (CONSTRUCT_PORTFOLIO, GENERATE_NARRATIVE) are NOT modified — they read mode from Memory.
- The InvestorProfile payload also gets passed as `subject.investorProfile` (currently the SF doesn't pass it; investor-profile-ctrl agent runs with empty input). This is a bug-fix coupling — see §Risk register.

### Step 2 — investor-profile-ctrl: read mode, write to Memory

`services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`:

```typescript
const operatingMode = (subject.operatingMode as string) ?? 'BALANCED';
const investorProfile = subject.investorProfile ?? {};

result = await deps.agentService.runPipeline(ctx.eventId, {
  tenantId, decisionId, operatingMode, investorProfile,
  portfolioState: subject.portfolioState ?? {},
  tenantHistory: tenantHistory.map(r => r.content),
});
```

Add `operatingMode` to the agent output schema (`services/advisory/investor-profile-ctrl/src/agents/schemas.ts`):

```typescript
export const InvestorProfileOutputSchema = z.object({
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  goalInterpretation: GoalInterpretationSchema,
  riskEvaluation: RiskEvaluationSchema,
});
```

The agent prompt remains analytical (it doesn't need to *interpret* mode, just pass it through). The agent code wraps `{ operatingMode, ...agentOutput }` before `writeAgentOutput`.

### Step 3 — portfolio-engine: read mode from Memory, inject into prompt

`services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`:

- After `session.searchLongTermMemory(...)`, also call `session.getInvestorProfileOutput()` (a new helper added to `libs/agent-orchestrator/src/memory/memory-client.ts`) which returns the most recent investor-profile output for the same `decisionId`. Extract `operatingMode`.
- Pass `operatingMode` into `agentService.runPipeline(...)` payload.

`services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts` — mode-aware prompts:

```typescript
const MODE_GUIDANCE = {
  CONSERVATIVE: 'Allocate at most 30% to equities. Prefer broad-market ETFs over single names. Cap any single position at 10%. Total positions: 3-5. Prioritize capital preservation.',
  BALANCED: 'Allocate 50-70% to equities. Mix of broad ETFs and sector tilts. Cap any single position at 15%. Total positions: 5-8. Balance growth and stability.',
  AGGRESSIVE: 'Allocate up to 90% to equities. Sector and thematic concentrations allowed. Cap any single position at 25%. Total positions: 6-12. Prioritize long-term growth.',
};

export const portfolioConstructionPrompt = (operatingMode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE') => `You are a portfolio construction specialist. Design target allocations based on investor profile, risk assessment, and market analysis.

OPERATING MODE: ${operatingMode}
${MODE_GUIDANCE[operatingMode]}

Use fund prospectus and instrument data from the knowledge base.

Consider: investor risk category, market outlook, fund characteristics, diversification within the operating-mode envelope above.

Input: {input}`;
```

`services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts` — extend `PortfolioConstructionSchema` with assertion-friendly fields:

```typescript
export const PortfolioConstructionSchema = z.object({
  allocations: z.array(...),
  totalExposure: z.number(),
  equityWeight: z.number().min(0).max(1).describe('Total weight in equity instruments — used to verify mode adherence'),
  riskMetrics: z.object({
    concentrationRisk: z.number(),
    sectorDiversity: z.number(),
    largestPositionWeight: z.number().min(0).max(1),
  }),
  confidence: z.number().min(0).max(1),
});
```

`rebalancePlannerPrompt` gets the same mode-injection treatment with mode-tuned turnover guidance.

### Step 4 — advisory-narrative: read mode from Memory, inject into prompt

Same pattern as Step 3. The narrative agent uses mode to set tone and emphasis (CONSERVATIVE → emphasize capital preservation, AGGRESSIVE → emphasize growth thesis).

`services/advisory/advisory-narrative-ctrl/src/agents/prompts.ts`:

```typescript
const MODE_NARRATIVE = {
  CONSERVATIVE: 'Frame the explanation around safety, capital preservation, and downside protection. Address volatility concerns proactively.',
  BALANCED: 'Frame the explanation around long-term growth with measured risk. Acknowledge both upside and downside scenarios.',
  AGGRESSIVE: 'Frame the explanation around growth opportunity and conviction. Acknowledge volatility as the cost of higher expected return.',
};

export const explainabilityPrompt = (operatingMode: ...) => `... OPERATING MODE: ${operatingMode}\n${MODE_NARRATIVE[operatingMode]}\n...`;
```

### Step 5 — `libs/agent-orchestrator/src/memory/memory-client.ts` helper

Add `session.getInvestorProfileOutput()`:

```typescript
async getInvestorProfileOutput(): Promise<{ operatingMode?: string; [key: string]: unknown } | null> {
  const records = await this.listMemoryRecords({
    namespace: `/investor-profile/${this.tenantId}/decisions/${this.decisionId}`,
    maxResults: 1,
  });
  if (!records.length) return null;
  return JSON.parse(records[0].content) as Record<string, unknown>;
}
```

This wraps the existing `ListMemoryRecordsCommand` pattern (already in use per `libs/agent-orchestrator/src/memory/memory-client.ts:43,60`).

### Step 6 — E2E gate

New scenario `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts`:

- Parametrized over 3 modes (CONSERVATIVE, BALANCED, AGGRESSIVE) — same pattern as existing `operating-mode-authority.e2e.test.ts`.
- Onboard a tenant with a specific mode, fire INVESTOR_PROFILE_CREATED, wait for DecisionPacket via `withLiveDecision()` fixture.
- Assert mode-specific shape:
  - **CONSERVATIVE**: `proposedTrades.length` ≤ 5, `equityWeight` ≤ 0.30, largest EQUITY position ≤ 0.10
  - **BALANCED**: `proposedTrades.length` ∈ [5, 8], `equityWeight` ∈ [0.50, 0.70], largest EQUITY position ≤ 0.15
  - **AGGRESSIVE**: `proposedTrades.length` ≥ 6, `equityWeight` ≥ 0.70, largest EQUITY position ≤ 0.25

  > Envelope clarified 2026-05-06 — `largestPositionWeight` reframed as "largest EQUITY position" so the CONSERVATIVE math is satisfiable. See `docs/superpowers/specs/2026-05-06-portfolio-engine-mode-anchored-examples-design.md` § "Root cause 1" for the full reasoning.
- Each mode runs once (LLM nondeterminism may require generous tolerances or 3-run averaging — see §Risk register).

## Files changed

**Modified (5 service stacks/handlers):**
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` — UnpackTriggerEnvelope adds `operatingMode` extraction; ANALYZE_INVESTOR_PROFILE subject gets `operatingMode` + `investorProfile` fields.
- `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts` — read mode from subject, pass through pipeline, wrap output with mode.
- `services/advisory/investor-profile-ctrl/src/agents/schemas.ts` — new `InvestorProfileOutputSchema` wrapping the existing two with `operatingMode`.
- `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` — read mode from Memory via `getInvestorProfileOutput()`, pass to pipeline.
- `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts` — `portfolioConstructionPrompt` + `rebalancePlannerPrompt` become functions of mode.
- `services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts` — `PortfolioConstructionSchema` adds `equityWeight` + `largestPositionWeight` for assertion.
- `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts` — same Memory-read pattern.
- `services/advisory/advisory-narrative-ctrl/src/agents/prompts.ts` — `explainabilityPrompt` becomes a function of mode.

**Modified (shared lib):**
- `libs/agent-orchestrator/src/memory/memory-client.ts` — add `session.getInvestorProfileOutput()` helper.

**New (test):**
- `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` — parametrized e2e gate.

**Modified (unit tests — minimal, contract assertions only):**
- `services/advisory/portfolio-engine-ctrl/test/unit/agents/golden-fixtures.test.ts` — assert prompt template renders for each mode.
- `services/advisory/advisory-narrative-ctrl/test/unit/agents/golden-fixtures.test.ts` — same.

## Validation gate

1. **Unit**: `pnpm nx run-many -t test --projects=investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,decision-workflow-ctrl,agent-orchestrator` — green.
2. **Integration smoke**: portfolio-engine-ctrl + advisory-narrative-ctrl integration tests pass (mock agent runtime path validates the pipeline shape changes).
3. **E2E gate**: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns operating-mode-recommendation-shape` — 3/3 GREEN against deployed dev. Each mode produces a `DecisionPacket` whose `proposedTrades` shape matches the assertion bands above.
4. **Visual proof**: AgentCore Memory record for `/investor-profile/<tenant>/decisions/<id>` contains `operatingMode` field at the top level (CloudWatch log inspection or AgentCore console).

## Out of scope

- **Mode enrichment for non-profile triggers** (DEPOSIT_DETECTED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED) — these will hit the `'BALANCED'` default in UnpackTriggerEnvelope until a follow-up adds a small DDB lookup or events publisher enrichment. Ship Phase 2 with the INVESTOR_PROFILE_* trigger path correctly mode-aware; follow-up tracked in PARKING LOT after ship.
- **Memory contract evolution** — the `getInvestorProfileOutput()` helper assumes investor-profile output is the only writer in that namespace. If multi-writer becomes a need, switch to a typed `BatchCreateMemoryRecords` schema. Not now.
- **Mode-aware temperature/model selection** — Path C from the brainstorm. The prompt-content differentiation is the smallest change with the largest measured behavior delta. Revisit only if e2e gate's prompt-tuning produces insufficient differentiation.
- **`updateOperatingMode` mutation** — already filed in PARKING LOT. Phase 2 only requires that the value at decision time correctly drives behavior; how the value got there is orthogonal.
- **agent-contract-tests `decisionLifecycle` assertion** — filed 2026-04-21 as a deferred assertion. Will land naturally once Phase 2's e2e gate proves the differentiation; no separate work needed in this spec.
- **`InvestorProfileOutputSchema` wrapping ALL investor-profile output** — this spec adds `operatingMode` as a top-level wrapper field. A future refactor could move all per-agent envelopes to a uniform `{ metadata, payload }` shape, but that's not Phase 2.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| LLM nondeterminism makes the e2e gate flaky | High | Wide assertion bands (e.g. `equityWeight ≤ 0.30` not `=== 0.25`); use `tool_choice` + `temperature: 0.3` for portfolio-construction. If still flaky, run each mode N times and assert majority. |
| The `'BALANCED'` default for non-profile triggers masks mode mismatches | Medium | Explicitly log `operatingMode` source ("from triggerContext" vs "default fallback") in UnpackTriggerEnvelope's downstream log. CloudWatch query verifies coverage. |
| investor-profile-ctrl is currently invoked with `{}` payload — fixing this exposes pre-existing prompt assumptions | Low | The agent currently runs with empty input and produces meaningful output via KB context alone. Adding real input only enriches; should not regress. |
| `getInvestorProfileOutput()` returns null on the very first decision (cold Memory) | Low | Defensive: handler defaults to `'BALANCED'` when null; logs at WARN level so we can spot if it ever happens in steady state. |
| Cross-domain coupling: investor-profile schema change could break the existing agent contract test | Low | The spec extends, doesn't break, the existing schema. agent-contract-tests check process metadata (tools/models/latency), not output shape. |
| Bedrock Sonnet sometimes ignores hard numeric constraints in prompts | Medium | Add a post-validation step in `services/advisory/portfolio-engine-ctrl/src/agents/validation.ts` that REJECTS outputs where `equityWeight` exceeds the mode envelope; agent fallback retries. |

## Done definition

E2E gate green 3/3 against deployed dev. AgentCore Memory record for the investor-profile output contains `operatingMode`. portfolio-engine + advisory-narrative prompts visibly mode-differentiated. BACKLOG entry moves to "Recently shipped" with commit SHA. `project_operating_mode.md` topic memory updated to mark Phase 2 SHIPPED. The non-profile trigger enrichment follow-up filed in PARKING LOT.
