# Portfolio-engine mode-anchored examples (α-tune)

**Date:** 2026-05-06
**Status:** Design — pending user review
**Workstream:** Close `operating-mode-recommendation-shape.e2e.test.ts` so portfolio-construction respects the operating-mode envelope.
**Predecessor:** `docs/superpowers/specs/2026-05-06-agent-runtime-structured-output-design.md` (architectural pipeline α/β/γ shipped 2026-05-06 commits `137523df`..`52a22f96`). Pipeline now produces non-empty `proposedTrades`; remaining gap is mode adherence.

## Problem

After the agent-runtime structured-output workstream shipped, the e2e gate at `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` still fails 3/3:

| Mode         | Observed                                                                  | Required                                                       |
| ------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| CONSERVATIVE | count=8, equityWeight=0.60, largestPositionWeight=0.25                    | count ≤ 5, equityWeight ≤ 0.30, largestPositionWeight ≤ 0.10   |
| BALANCED     | timeout                                                                   | count ∈ [5,8], equityWeight ∈ [0.50,0.70], largestPos ≤ 0.15   |
| AGGRESSIVE   | count=6, equityWeight=0.60                                                | count ≥ 6, equityWeight ≥ 0.70, largestPos ≤ 0.25              |

Two distinct root causes underlie the failures.

### Root cause 1 — The CONSERVATIVE envelope is mathematically unsatisfiable

For N positions summing to 1.0, the minimum value of `max(targetWeight)` is `1/N`. With CONSERVATIVE's `count ≤ 5`, the minimum largest position is `1/5 = 0.20`. The cap of `largestPositionWeight ≤ 0.10` therefore cannot be honoured by any portfolio that respects the count band. The model producing 0.25 at count=8 is, in part, doing close to the best a few-position allocation can achieve — even Opus 4.6 cannot satisfy a self-contradictory rule.

The financial intent of "single position cap" is **single-name equity concentration risk**: the rule exists to prevent one stock or sector ETF from dominating the portfolio. Broad bond ETFs (BND holds ~10,000 bonds), broad equity ETFs (VTI holds ~4,000 stocks), and cash equivalents (BIL) are themselves diversified and don't carry idiosyncratic concentration risk. A 40% BND position in a CONSERVATIVE portfolio is normal and is the *opposite* of a concentration problem.

The correct semantics for `largestPositionWeight` is therefore **largest EQUITY position** — the maximum `targetWeight` across allocations whose `assetClass === 'EQUITY'`.

### Root cause 2 — Schema example anchors the model to a BALANCED-shaped output regardless of mode

`services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts:3-26` defines a single mode-agnostic schema example with `equityWeight=0.55` and two positions. Bedrock structured-output models anchor heavily on the schema example shape provided in the system prompt. The "HARD RULES FOR THIS INVOCATION" wording in `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:107-115` is being out-weighted by the mode-agnostic example. CONSERVATIVE collapsing to `equityWeight=0.60` and AGGRESSIVE collapsing to `equityWeight=0.60` are exactly the symptom of this anchoring: the model regresses to the example shape regardless of imperative rules.

## Solution

Two coupled fixes shipped together. Fix 1 is the precondition (without feasible math, no prompt tune can succeed). Fix 2 is the α-tune (mode-anchored examples).

### Fix 1 — Reframe `largestPositionWeight` as "largest EQUITY position"

Reword the prompt rule, the schema field description, and the e2e assertion to operate on the largest *equity* allocation rather than the largest *any-asset* allocation. Numeric caps unchanged. The schema field name stays `largestPositionWeight` (no migration); only its definition changes.

**Feasibility check after reframing:**

| Mode         | Min equity positions = ⌈equityFloor / cap⌉ | Min total positions | Count band | Feasible? |
| ------------ | ------------------------------------------- | ------------------- | ---------- | --------- |
| CONSERVATIVE | ⌈0.30 / 0.10⌉ = 3                           | 3 + ≥1 non-equity = 4 | 3-5     | ✓ (4-5)   |
| BALANCED     | ⌈0.50 / 0.15⌉ = 4                           | 4 + ≥1 non-equity = 5 | 5-8     | ✓         |
| AGGRESSIVE   | ⌈0.70 / 0.25⌉ = 3                           | 3 (count is binding)  | 6-12    | ✓         |

### Fix 2 — Per-mode worked examples + per-mode cached orchestrator

Replace the single mode-agnostic schema example with three mode-specific examples whose numbers actually sit inside their envelope. Build the agent prompt at runtime via a `buildPortfolioConstructionPrompt(mode)` factory; build the orchestrator per mode via `getGraphForMode(mode)` cached in a `Map<OperatingMode, CompiledGraph>` at module scope (3 graphs ever, since `rebalancePlannerConfig` does not vary with mode).

**Concrete worked examples:**

CONSERVATIVE (equityWeight=0.20, largest-equity=0.10, count=4):
```
{ "allocations": [
    {"instrument":"BND","assetClass":"FIXED_INCOME","targetWeight":0.50,"rationale":"Core aggregate bond ETF for capital preservation"},
    {"instrument":"SHY","assetClass":"FIXED_INCOME","targetWeight":0.30,"rationale":"Short-duration treasuries — minimal interest-rate sensitivity"},
    {"instrument":"VTI","assetClass":"EQUITY","targetWeight":0.10,"rationale":"Broad-market US equity for modest growth participation"},
    {"instrument":"IXUS","assetClass":"EQUITY","targetWeight":0.10,"rationale":"Broad ex-US equity for geographic diversification"}
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.20,
  "riskMetrics": { "concentrationRisk": 0.10, "sectorDiversity": 0.85, "largestPositionWeight": 0.10 },
  "confidence": 0.88 }
```

BALANCED (equityWeight=0.55, largest-equity=0.14, count=6):
```
{ "allocations": [
    {"instrument":"VTI","assetClass":"EQUITY","targetWeight":0.14,"rationale":"Core US broad-market equity"},
    {"instrument":"IXUS","assetClass":"EQUITY","targetWeight":0.14,"rationale":"Broad ex-US equity for geographic diversification"},
    {"instrument":"QQQ","assetClass":"EQUITY","targetWeight":0.14,"rationale":"Tech tilt within equity sleeve"},
    {"instrument":"VWO","assetClass":"EQUITY","targetWeight":0.13,"rationale":"Emerging markets equity"},
    {"instrument":"BND","assetClass":"FIXED_INCOME","targetWeight":0.27,"rationale":"Aggregate bond ETF for income and ballast"},
    {"instrument":"SHY","assetClass":"FIXED_INCOME","targetWeight":0.18,"rationale":"Short-duration treasuries — interest-rate hedge"}
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.55,
  "riskMetrics": { "concentrationRisk": 0.18, "sectorDiversity": 0.72, "largestPositionWeight": 0.14 },
  "confidence": 0.86 }
```

AGGRESSIVE (equityWeight=0.85, largest-equity=0.20, count=8):
```
{ "allocations": [
    {"instrument":"VTI","assetClass":"EQUITY","targetWeight":0.20,"rationale":"Core US broad-market equity"},
    {"instrument":"VOO","assetClass":"EQUITY","targetWeight":0.18,"rationale":"S&P 500 — large-cap exposure"},
    {"instrument":"QQQ","assetClass":"EQUITY","targetWeight":0.15,"rationale":"Nasdaq-100 tech tilt"},
    {"instrument":"IXUS","assetClass":"EQUITY","targetWeight":0.12,"rationale":"Broad ex-US equity"},
    {"instrument":"VWO","assetClass":"EQUITY","targetWeight":0.10,"rationale":"Emerging markets equity"},
    {"instrument":"ARKK","assetClass":"EQUITY","targetWeight":0.10,"rationale":"Disruptive innovation thematic"},
    {"instrument":"BND","assetClass":"FIXED_INCOME","targetWeight":0.10,"rationale":"Bond ballast for volatility control"},
    {"instrument":"BIL","assetClass":"CASH","targetWeight":0.05,"rationale":"T-bill ETF — dry powder"}
  ],
  "totalExposure": 1.0,
  "equityWeight": 0.85,
  "riskMetrics": { "concentrationRisk": 0.22, "sectorDiversity": 0.65, "largestPositionWeight": 0.20 },
  "confidence": 0.84 }
```

## Code changes

Seven files, organised by fix.

### Fix 1 — Envelope clarification

1. `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:107-115` — `modeContext` rules: rule (2) per mode rewrites "riskMetrics.largestPositionWeight MUST be ≤ X" → "the largest EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ X". Hard-rules framing kept.
2. `services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts:24` — update `largestPositionWeight.describe()` from `"Weight of the single largest position"` to `"Weight of the single largest EQUITY position (max targetWeight across allocations whose assetClass is EQUITY)"`.
3. `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:132` — change:
   ```ts
   const largestPositionWeight = Math.max(0, ...packet.proposedTrades.map((t) => (t.targetWeightPercent ?? 0) / 100));
   ```
   to:
   ```ts
   const equityPositions = packet.proposedTrades.filter((t) => t.assetClass === 'EQUITY');
   const largestPositionWeight = equityPositions.length > 0
     ? Math.max(...equityPositions.map((t) => (t.targetWeightPercent ?? 0) / 100))
     : 0;
   ```
   Update the JSDoc comment in lines 28-33 to reflect "largest EQUITY position".
4. `docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md:149-151` — amend the envelope table: append `(largest EQUITY position — clarified 2026-05-06, see 2026-05-06-portfolio-engine-mode-anchored-examples-design.md)`. Numbers unchanged.

### Fix 2 — Per-mode prompts + per-mode orchestrator

5. `services/advisory/portfolio-engine-ctrl/src/agents/prompts.ts` — replace `portfolioConstructionSchemaShape` constant + `portfolioConstructionPrompt` constant with:
   - Three per-mode shape constants: `conservativeShape`, `balancedShape`, `aggressiveShape` (the worked examples above).
   - A `buildPortfolioConstructionPrompt(mode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE'): string` factory that calls `formatStructuredOutputPrompt({...})` with the mode-correct shape and rules. Rules list reworded so rule (4) reads "the largest EQUITY position MUST be ≤ X" with the mode-specific cap inlined.
   - Existing `rebalancePlannerPrompt` constant unchanged (mode-orthogonal).
6. `services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts` — replace `portfolioConstructionConfig: AgentConfig<...>` constant with `buildPortfolioConstructionConfig(mode): AgentConfig<typeof PortfolioConstructionSchema>` factory that wires `promptTemplate: buildPortfolioConstructionPrompt(mode)`. Other fields (`modelId`, `maxTokens`, `temperature`, `schema`) unchanged.
7. `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:24-42` — restructure orchestrator construction:
   - Remove module-scope `const graph = createOrchestrator({...})`.
   - Add `const graphCache = new Map<OperatingMode, CompiledGraph>();` at module scope.
   - Add `function getGraphForMode(mode: OperatingMode): CompiledGraph` that lazily builds and caches per-mode orchestrator with `agents: { 'portfolio-construction': buildPortfolioConstructionConfig(mode), 'rebalance-planner': rebalancePlannerConfig }`. Other orchestrator config unchanged.
   - Inside `invokePortfolioEngine`, after the existing mode-detection block (line 104-106), call `const graph = getGraphForMode(operatingMode as OperatingMode);` immediately before the `invokeOrchestrator` call.
   - Existing `export { graph };` at line 152 — remove. Verified safe: `test/unit/graph.test.ts` accesses `mod.invokePortfolioEngine` only, never imports the bare `graph` symbol.
   - `test/unit/graph.test.ts` test #1 at lines 50-59 (`creates orchestrator with 2 parallel agents`) currently asserts on `mockCreateOrchestrator.mock.calls[0][0]` which fires at module-load. After the change, `createOrchestrator` is called lazily inside `getGraphForMode`, so the test must first call `invokePortfolioEngine` (as the other tests already do) and then assert the call args. The `{agents, waves}` assertion itself is mode-orthogonal and stays the same. Tests #2-5 already drive `invokePortfolioEngine` directly and remain green without modification (the lib-level `invokeOrchestrator` mock returns the configured value regardless of which graph instance was passed in).

## Done-when

- E2E gate `operating-mode-recommendation-shape.e2e.test.ts` against deployed dev: **CONSERVATIVE GREEN + AGGRESSIVE GREEN**.
- BALANCED outcome documented but not blocking — depends on the separately-filed Vestigial MemoryStrategy entry (`docs/BACKLOG.md:67`). Gate result is "2/3 from us, 1/3 blocked-out-of-scope" → counts as ship for this workstream.
- Unit + lint + integration smoke for `portfolio-engine-ctrl` green.

## Validation gate

1. `pnpm nx run portfolio-engine-ctrl:lint` — zero new violations.
2. `pnpm nx run portfolio-engine-ctrl:test` — unit suite green (graph.test.ts may need a small update to call `getGraphForMode('BALANCED')` instead of importing `graph` directly).
3. `pnpm nx run portfolio-engine-ctrl:test-integration` against deployed dev — green.
4. Deploy AgentRuntime: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=portfolio-engine-ctrl` (reuses the standard esbuild → bundle.js → ARM64 Docker → AgentCore Runtime path documented in `project_agentruntime_deploy.md`).
5. Run e2e gate: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=operating-mode-recommendation-shape`.
6. Expected outcome: CONSERVATIVE PASS, AGGRESSIVE PASS, BALANCED times out (separate item).
7. If a tail-mode flake on first run: re-run once before declaring failure (LLM nondeterminism). Two consecutive failures → escalate to Approach B (validation rule + retry-feedback loop, filed in PARKING LOT).

## Out of scope

| Item                                                                       | Why deferred                                                                                                                                                          | Filed                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Approach B — mode-aware validation rule + retry-feedback prompt loop       | Defense-in-depth. Promote only if Fix 2 alone produces tail-mode flake on second e2e run.                                                                             | New PARKING LOT entry (Task 4)                         |
| rebalance-planner mode-awareness                                           | Mode-orthogonal to turnover minimization; would need separate analysis. No current failure observed.                                                                  | New PARKING LOT entry (Task 4)                         |
| REIT-vs-EQUITY equity-weight ambiguity                                     | `prompts.ts:36` says "EQUITY (or REIT if interpreted as equity-like)". Test filters strictly on `=== 'EQUITY'`. Latent inconsistency; promote on first observed flake. | New PARKING LOT entry (Task 4)                         |
| BALANCED timeout — Vestigial MemoryStrategy namespace                      | Already filed.                                                                                                                                                        | `docs/BACKLOG.md:67` (cross-reference, no duplicate)   |
| Stale `readUpstreamOutput('advisory-ctrl')` in `graph.ts:90`               | Already filed.                                                                                                                                                        | `docs/BACKLOG.md:90` (cross-reference, no duplicate)   |
| `updateOperatingMode` mutation re-derivation gap                           | Already filed.                                                                                                                                                        | `docs/BACKLOG.md:87` (cross-reference, no duplicate)   |
| Other 5 advisory agents (market-intelligence, advisory-narrative, etc.)    | No mode-bias issue observed; their structured-output failures were closed by the architectural α/β/γ workstream.                                                       | n/a                                                    |
| `withLiveDecision` fixture mode-parameterisation                           | Already filed.                                                                                                                                                        | `docs/BACKLOG.md:91` (cross-reference, no duplicate)   |

## References

- `docs/architecture/SYSTEM-ARCHITECTURE.md` §14 — operating-mode dimension across the system.
- `docs/architecture/SERVICE-INVENTORY.md` § portfolio-engine-ctrl — agent topology and the Opus/Sonnet split.
- `flows/advisory-cycle.flow.yaml` Phase 2c — portfolio-construction agent invocation contract.
- `docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md` — the originating Phase 2 spec whose envelope this design clarifies.
- `docs/superpowers/specs/2026-05-06-agent-runtime-structured-output-design.md` — the architectural pipeline workstream that this α-tune sits on top of.
- `services/advisory/portfolio-engine-ctrl/CLAUDE.md` — current service card (verified against code 2026-05-06; no drift relevant to this design).
