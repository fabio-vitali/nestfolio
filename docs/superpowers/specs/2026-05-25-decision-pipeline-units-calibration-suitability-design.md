# Decision pipeline: units, calibration, suitability — design

**Date:** 2026-05-25
**Backlog item:** `docs/backlog/e2e-test-tolerance-or-agent-constraint-against-suitability-block.md`
**Lane:** Complex (worktree, deploy + e2e validation gate)
**Status:** Design — pending user review

## Goal

End-to-end fix of the AssemblePacket → Compliance contract so the Playwright `new-investor-happy-path` scenario reaches `AWAITING_CONFIRMATION` against deployed dev via *correct production behaviour*, not via test-tolerance workarounds.

## Out of scope

Mirrored from the backlog file:

- Rewriting agent prompts to constrain allocations to test-friendly weights — agent behaviour stays free; production rules + units adapt to it.
- Changes to the suitability table beyond what is required to clear the new-investor-happy-path scenario.
- Multi-cycle rebalance flows (`PORTFOLIO_DRIFT_DETECTED`-triggered decisions) — this workstream is scoped to first-portfolio construction from cash; drift-rebalance calibration is a separate item if regressions surface.
- `ledger-ctrl/shadow-fill.service.ts` behaviour beyond the assertion that AssemblePacket emits canonical cents.
- Adapting `broker-sim-adpt` / `broker-alpaca-adpt` to any new `ProposedTrade` shape — out of scope unless they consume `quantityOrAmountCents` directly and break under the corrected units.
- Migration of existing dev DDB rows written under the old projector shape — per [[feedback-no-deprecation]] dev is disposable; we re-seed via fresh e2e onboarding.

## Background

Investigation 2026-05-25 of `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:171-179` found five layered production bugs on the AssemblePacket → Compliance path, plus a calibration mismatch. Symptom: every new-investor decision today lands `complianceResult: BLOCKED + L2` instead of the intended `APPROVED + L2 → AWAITING_CONFIRMATION → user confirms`.

Reference SF execution (tenant `e2e-1779659953223-5fab30fd`, $1000 deposit, 2026-05-24):

```jsonc
decisionPacket.proposedTrades:
  VTI/IXUS/QQQ each   targetWeightPercent=14  quantityOrAmountCents=14
  VWO                                    13                          13
  BND                                    27                          27
  SHY                                    18                          18
decisionPacket.portfolioValue: 1            // dimensionless, not cents
decisionPacket.riskScore: 5
complianceResult: { decision: 'BLOCKED', authorityLevel: 'L2' }
```

Dev audit log row (older execution): `MAX_SINGLE_TRADE: Trade VTI (2000.0%) exceeds max single trade limit of 20%`.

### The five layered bugs

1. **AssemblePacket portfolioValue units** — `assemble-packet.ts:58` reads `allocationEnvelope.totalExposure` (the agent's normalization indicator, ≈1.0) as `portfolioValue`. This was never cents.
2. **AssemblePacket quantityOrAmountCents units** — `assemble-packet.ts:70` computes `Math.round(targetWeight * portfolioValue * 100)` → small basis-point integers (`14`, `27`), not real cents.
3. **AssemblePacket InvestorProfile DDB-wrap silent default** — `decision-state-machine.ts:354` extracts `$.investorProfileSnapshotResponse.Item.agentOutput.M` (one layer of unwrap); inner values stay DDB-AttributeValue-wrapped (`{N:"50"}`, `{M:{...}}`). `assemble-packet.ts:76` reads `investorProfile?.riskScore` which is `undefined` (actual key is `M.riskScore`) → `?? 5` silently defaults. **Every production decision today reports `riskScore=5` regardless of the agent's output.** Same bug affects `ExtractMarketSnapshot` — `agent.marketAnalysis` has been silently empty for every decision.
4. **GuardrailEvaluator units assumption** — `guardrail-evaluator.ts:29,32` treats `portfolioValue` and `quantityOrAmountCents` as canonical cents; computes `maxAmountCents = portfolioValue * maxPercent / 100`. With `portfolioValue=1, maxPercent=20`, `maxAmountCents=0.2`. Every trade trivially exceeds it. Reported percent: `(quantityOrAmountCents / portfolioValue) * 100 = 2000%`.
5. **SuitabilityChecker risk-score scale mismatch** — `suitability-checker.ts:7-18` keys `RISK_SCORE_TO_MAX_EQUITY` by 1-10. `investor-bff/src/domain/risk-profile.service.ts:18` produces 0-100. `investor-profile-ctrl/src/agents/schemas.ts:11` produces 0-100. No real producer matches; lookup falls through `?? 50`. The reason this *looks* like "55% vs 50% cap at riskScore=5" is Bug 3 making riskScore=5 always, incidentally matching `table[5]=50`.

### Plus a calibration gap

`guardrail-params.ts:15-31` BALANCED mode: `maxSingleTradePercent=10`, `monthlyTurnoverCapPercent=25`. These are calibrated for drift rebalances. An initial portfolio build from cash necessarily allocates BND@27, SHY@18, total turnover=100% — none of which can satisfy steady-state caps. Even with all five units bugs fixed, every new-investor decision would still BLOCK on MAX_SINGLE_TRADE + TURNOVER_CAP.

## Design decisions (settled with owner in brainstorming)

| Axis | Decision |
|---|---|
| Source of `portfolioValueCents` | Thread `triggerAmountCents` through SF state from `$.triggerContext.amountCents`. For new-investor: `portfolioValueCents = (currentPositionsValueCents \|\| 0) + (triggerAmountCents \|\| 0)`. |
| DDB AttributeValue unwrap | **No new Lambda, no JSONata.** `snapshot-projector.ts` wraps `agentOutput` in `JSON.stringify(...)`; SF `Extract*Snapshot` Pass states parse via `States.StringToJson($.Item.agentOutput.S)` (long-stable JSONPath intrinsic). Applies to BOTH InvestorProfileSnapshot AND MarketSnapshot. |
| Initial-build expression | `isInitialBuild: boolean` flag on `ComplianceInput`. AssemblePacket sets from `currentPositions.length === 0`. `GuardrailEvaluator` `checkSingleTradeSize` + `checkTurnoverCap` early-return `passed: true` with `details: 'Skipped for initial portfolio construction'`. `CONCENTRATION_LIMIT` unchanged (concentration is a real risk on any decision). |
| Suitability scale + cap | Replace `RISK_SCORE_TO_MAX_EQUITY` (1-10 keys, broken) with `CATEGORY_TO_MAX_EQUITY = { CONSERVATIVE: 30, MODERATE: 60, AGGRESSIVE: 90 }`. `ComplianceInput` carries `riskCategory`, drops `riskScore`. e2e fixture defaults to MODERATE → 60% cap → LLM's ~55% PASSES naturally. No fixture change. |
| Field rename | `portfolioValue` → `portfolioValueCents` everywhere on the AssemblePacket → Compliance contract. Forces every reader to confront units; greppable; prevents silent reintroduction. |

## Architecture & blast radius

End-to-end change in **3 services**, **no new Lambdas**, **no new infrastructure**.

### `services/advisory/decision-workflow-ctrl`

- `handlers/snapshot-projector.ts` — wrap `agentOutput` in `JSON.stringify(...)` for both InvestorProfileSnapshot and MarketSnapshot writes (2 lines each).
- `constructs/decision-state-machine.ts`:
  - `UnpackTriggerEnvelope` (Pass) — expose `triggerAmountCents.$: '$.triggerContext.amountCents'` (safely undefined for non-deposit triggers).
  - `ExtractInvestorProfileSnapshot` (Pass) — parameters use `'agentOutput.$': 'States.StringToJson($.investorProfileSnapshotResponse.Item.agentOutput.S)'`.
  - `ExtractMarketSnapshot` (Pass) — same change for `marketSnapshotResponse.Item.agentOutput.S`.
  - `CheckInvestorProfileSnapshotPresent` + `CheckMarketSnapshotPresent` (Choice) — tighten to `isPresent($.<…>.Item.agentOutput.S)` so an `Item` without the field routes to the `HandleMissing*` seed-empty path (otherwise `States.StringToJson(undefined)` raises uncatchable `States.Runtime` per [[feedback-states-runtime-uncatchable]]).
  - `HoistInvestorProfileFromTrigger` (Pass) — add `'riskCategory.$': '$.triggerContext.riskProfile.category'` so the trigger-hoist path also surfaces category (`INVESTOR_PROFILE_UPDATED` trigger).
  - `AssembleDecisionPacket` (CustomState) — Lambda payload adds `triggerAmountCents.$`; `ResultSelector` adds `isInitialBuild.$` + `riskCategory.$`, renames `portfolioValue` → `portfolioValueCents`.
  - `WaitForCompliance` (CustomState) — `Detail.subject` adds `isInitialBuild.$`, `riskCategory.$`; renames `portfolioValue` → `portfolioValueCents`.
- `handlers/assemble-packet.ts`:
  - Add `triggerAmountCents?: number` to event shape.
  - Compute `currentPositionsValueCents = sum(currentPositions[].marketValueCents ?? 0)`.
  - Compute `portfolioValueCents = currentPositionsValueCents + (triggerAmountCents ?? 0)`.
  - Compute `quantityOrAmountCents = Math.round(targetWeight * portfolioValueCents)` (canonical cents).
  - Compute `isInitialBuild = currentPositions.length === 0`.
  - Compute `riskCategory = (investorProfile?.riskCategory as RiskCategory) ?? 'MODERATE'`.
  - Return all of the above; remove `riskScore` from return.

### `services/advisory/compliance-ctrl`

- `rules/rule-engine.ts` — `ComplianceInput`:
  - Add `riskCategory: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE'`.
  - Add `isInitialBuild: boolean`.
  - Rename `portfolioValue` → `portfolioValueCents`.
  - Remove `riskScore`.
- `rules/suitability-checker.ts` — replace `RISK_SCORE_TO_MAX_EQUITY` with `CATEGORY_TO_MAX_EQUITY = { CONSERVATIVE: 30, MODERATE: 60, AGGRESSIVE: 90 } as const`. Read `input.riskCategory`. Defensive default `?? 60` on lookup miss.
- `rules/guardrail-evaluator.ts`:
  - `checkSingleTradeSize` — early-return `passed: true, details: 'Skipped for initial portfolio construction (no prior positions)'` when `input.isInitialBuild`.
  - `checkTurnoverCap` — same shape.
  - `checkConcentrationLimit` — **no change**, runs on every decision.
  - Rename `portfolioValue` → `portfolioValueCents` in `maxAmountCents = portfolioValueCents * maxPercent / 100`.
- `handlers/event-listener.ts` — read `subject.isInitialBuild`, `subject.riskCategory`, `subject.portfolioValueCents` from RECOMMENDATION_PROPOSED; pass through to `ComplianceInput`. Remove `subject.riskScore` read.

### No changes

- `ledger-ctrl` — already assumes canonical cents on `quantityOrAmountCents`; the AssemblePacket fix makes its behaviour correct as a side-effect.
- `broker-sim-adpt`, `broker-alpaca-adpt` — agent contract unchanged, ProposedTrade shape unchanged (units only). Implementation step includes a quick grep to confirm no incidental breakage; if any, file parking-lot.
- Agent contracts (PortfolioEngine, InvestorProfile, MarketIntelligence) — schemas, prompts, services stay frozen.
- Onboarding fixture — no change.

## Data flow (new-investor-happy-path, end-to-end)

```
DEPOSIT_DETECTED { subject.amountCents: 100000 }                    ← trigger event
        │
        ▼ EB → SF
DecisionStateMachine
  1. UnpackTriggerEnvelope (Pass)
     $.tenantId, $.userId, $.region, $.trigger, $.triggerContext
     + $.triggerAmountCents = $.triggerContext.amountCents (NEW)
  2. ParallelProjections
     Branch A: LookupInvestorProfileSnapshot (DDB GetItem)
       $.investorProfileSnapshotResponse.Item.agentOutput.S = "{...JSON...}" (NEW shape)
       ExtractInvestorProfileSnapshot (Pass, NEW parameters)
         'agentOutput.$': States.StringToJson(...Item.agentOutput.S)
         → $.agentResults.InvokeInvestorProfile.agentOutput = { riskCategory, riskScore, ... }
     Branch B: same shape, MarketSnapshot
  3. MergeProjections
  4. ResolveMandateSnapshot → operatingMode (unchanged)
  5. InvokePortfolioEngine (taskToken) — agent contract unchanged
  6. InvokeAdvisoryNarrative (taskToken) — agent contract unchanged
  7. AssembleDecisionPacket (Lambda)
     Payload adds: triggerAmountCents
     Lambda computes:
       currentPositions = portfolio.currentPositions ?? []
       currentPositionsValueCents = sum(p.marketValueCents) ?? 0
       portfolioValueCents = currentPositionsValueCents + (triggerAmountCents ?? 0)
                           = 0 + 100000 = 100000
       isInitialBuild = currentPositions.length === 0 = true
       riskCategory = investorProfile.riskCategory ?? 'MODERATE' = 'MODERATE'
       For each allocation: quantityOrAmountCents = round(targetWeight * portfolioValueCents)
         VTI: 0.14 × 100000 = 14000 (canonical cents)
     ResultSelector: { proposedTrades, currentPositions, portfolioValueCents,
                       isInitialBuild, riskCategory }
     → $.decisionPacket.*
  8. WaitForCompliance (taskToken) — emits RECOMMENDATION_PROPOSED
     subject: { ..., portfolioValueCents, isInitialBuild: true, riskCategory: 'MODERATE' }
        │
        ▼
compliance-ctrl event-listener
  ComplianceInput = { riskCategory: 'MODERATE', isInitialBuild: true,
                      portfolioValueCents: 100000, proposedTrades, ... }
  RuleEngine:
    MANDATE_ACTIVE      → passed
    MAX_SINGLE_TRADE    → passed (skipped: isInitialBuild)
    CONCENTRATION_LIMIT → passed (BND@27 < 30 cap for BALANCED)
    TURNOVER_CAP        → passed (skipped: isInitialBuild)
    SUITABILITY         → 55% vs CATEGORY_TO_MAX_EQUITY[MODERATE]=60% → passed
  AuthorityResolver → APPROVED + L2 (ADVISORY mandate)
  Emits DECISION_APPROVED with taskToken
        │
        ▼
SF resumes → ComplianceChoice → RequestUserConfirmation
  → emits USER_CONFIRMATION_REQUESTED
        │
        ▼
advisory-bff sets DecisionPacket.status = 'AWAITING_CONFIRMATION'
        │
        ▼
Playwright: badge → AWAITING_CONFIRMATION → confirm() succeeds ✓
```

## Contracts

**`ComplianceInput`** (`services/advisory/compliance-ctrl/src/rules/rule-engine.ts`)

```ts
export type RiskCategory = 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';

export interface ComplianceInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly decisionId: string;
  readonly mandate: MandateSnapshot;
  readonly proposedTrades: readonly ProposedTrade[];
  readonly currentPositions: readonly Position[];
  readonly portfolioValueCents: number;   // RENAMED
  readonly riskCategory: RiskCategory;    // NEW
  readonly isInitialBuild: boolean;       // NEW
  // riskScore: REMOVED
}
```

**`ProposedTrade`** (shape unchanged, units corrected)

```ts
export interface ProposedTrade {
  readonly symbol: string;
  readonly assetClass: 'EQUITY' | 'FIXED_INCOME' | 'CASH' | 'OTHER';
  readonly side: 'BUY' | 'SELL';
  readonly quantityOrAmountCents: number;   // canonical cents (was basis-points)
  readonly targetWeightPercent: number;     // unchanged: 0-100
  readonly rationale: string;
}
```

**RECOMMENDATION_PROPOSED subject** (`decision-state-machine.ts` WaitForCompliance Detail)

```jsonc
{
  decisionId, tenantId, userId, taskToken, awaitingCompliance: true,
  proposedTrades,
  currentPositions,
  portfolioValueCents,   // RENAMED
  riskCategory,          // NEW
  isInitialBuild         // NEW
  // riskScore: REMOVED
}
```

**SuitabilityChecker** (`rules/suitability-checker.ts`)

```ts
const CATEGORY_TO_MAX_EQUITY: Record<RiskCategory, number> = {
  CONSERVATIVE: 30,
  MODERATE:     60,
  AGGRESSIVE:   90,
};

export class SuitabilityChecker {
  check(input: ComplianceInput): CheckResult {
    const maxEquityPercent = CATEGORY_TO_MAX_EQUITY[input.riskCategory] ?? 60;
    // ... existing currentEquityWeight + equityChange logic, compared vs cap
  }
}
```

**GuardrailEvaluator** (`rules/guardrail-evaluator.ts`)

```ts
private checkSingleTradeSize(input: ComplianceInput): CheckResult {
  if (input.isInitialBuild) {
    return {
      name: 'MAX_SINGLE_TRADE',
      passed: true,
      details: 'Skipped for initial portfolio construction (no prior positions)',
    };
  }
  // ... existing logic, with portfolioValueCents
}
// checkTurnoverCap: same shape.
// checkConcentrationLimit: no change.
```

**Snapshot storage** (`snapshot-projector.ts`, both row types)

```ts
const attrs = {
  tenantId, userId,
  agentOutput: JSON.stringify(agentOutput),   // ← wrap as JSON string
  sourceEventId, updatedAt,
};
```

**SF Extract Pass states** (`decision-state-machine.ts`, both)

```ts
const extractInvestorProfileSnapshot = new sfn.Pass(this, 'ExtractInvestorProfileSnapshot', {
  parameters: {
    'agentOutput.$':
      'States.StringToJson($.investorProfileSnapshotResponse.Item.agentOutput.S)',
  },
  resultPath: '$.agentResults.InvokeInvestorProfile',
});

const checkInvestorProfileSnapshotPresent = new sfn.Choice(this, 'CheckInvestorProfileSnapshotPresent')
  .when(
    sfn.Condition.isPresent('$.investorProfileSnapshotResponse.Item.agentOutput.S'),
    extractInvestorProfileSnapshot,
  )
  .otherwise(handleMissingInvestorProfileSnapshot);
```

## Error handling & edge cases

- **Missing snapshot row** — existing `HandleMissing*` Pass seeds `{ agentOutput: {} }`. Consumers' `?? {}` / `?? 'MODERATE'` / `?? []` defaults degrade gracefully. No JSON.parse error since StringToJson only fires on the present path.
- **`triggerAmountCents` absent (non-DEPOSIT triggers)** — `$.triggerContext.amountCents` JSONPath safely returns `null`/undefined; AssemblePacket uses `?? 0`. Combined with `currentPositionsValueCents`, gives best-effort portfolio value from available data.
- **`portfolioValueCents === 0` (degenerate)** — `quantityOrAmountCents` collapses to 0; guardrails pass trivially (0 > maxAmountCents is false); SUITABILITY uses `targetWeightPercent` (unaffected). Acceptable degradation; no crash.
- **`agentOutput.S` missing from a present Item** — tightened Choice predicate routes to HandleMissing seed-empty path. Avoids `States.StringToJson(undefined)` → uncatchable `States.Runtime`.
- **Unrecognized `riskCategory` at runtime** — Zod-validated at the agent side; defensive `?? 'MODERATE'` in AssemblePacket and `?? 60` in SuitabilityChecker as defense-in-depth.
- **Concentration limit on initial build** — BALANCED cap is 30%. Current LLM allocations (BND@27, SHY@18) pass. A future agent producing >30% in a single allocation correctly BLOCKS on the first decision; this is desired behaviour.
- **Stale DDB rows from prior projector shape** — per [[feedback-no-deprecation]] dev is disposable. No migration. Stale rows would route to HandleMissing (Item.agentOutput.S absent under old Map shape). Test gate uses freshly-onboarded tenants.
- **Idempotency** — AssemblePacket's `createDecisionPacket` is already idempotent (`putIfNotExists`). SF retry semantics on `AssembleDecisionPacket` Task unchanged.

## Testing strategy

Per [[feedback-regression-tests]]: every fix gets a unit test, the contract gets an integration test, the e2e is the gate.

### Unit tests (Jest, no AWS)

- **`services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts`** — assert `agentOutput` written as `JSON.stringify(payload)` (string), not raw object; for InvestorProfileSnapshot and MarketSnapshot.
- **`services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts`** — extend:
  - `portfolioValueCents` derives from `triggerAmountCents + sum(currentPositions[].marketValueCents)`.
  - `quantityOrAmountCents` for 14% allocation against $1000 portfolio = `14000` (canonical cents).
  - `isInitialBuild === true` when `currentPositions=[]`; `false` otherwise.
  - `riskCategory` extracted from `investorProfile.riskCategory`; defaults to `'MODERATE'` on miss.
- **`services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`** — `Template.fromStack` assertions:
  - `ExtractInvestorProfileSnapshot` + `ExtractMarketSnapshot` reference `States.StringToJson(...agentOutput.S)`.
  - `CheckInvestorProfileSnapshotPresent` + `CheckMarketSnapshotPresent` predicate is on `Item.agentOutput.S`.
  - `UnpackTriggerEnvelope` exposes `triggerAmountCents`.
  - `WaitForCompliance` Detail.subject carries `isInitialBuild`, `riskCategory`, `portfolioValueCents` (not `portfolioValue`, not `riskScore`).
- **`services/advisory/compliance-ctrl/test/unit/suitability-checker.test.ts`** — replace riskScore-keyed cases:
  - MODERATE + 55% equity → passed
  - MODERATE + 65% equity → blocked (cap=60)
  - CONSERVATIVE + 35% equity → blocked (cap=30)
  - AGGRESSIVE + 95% equity → blocked (cap=90)
- **`services/advisory/compliance-ctrl/test/unit/guardrail-evaluator.test.ts`**:
  - `isInitialBuild=true` → MAX_SINGLE_TRADE passes with `details='Skipped...'` (BND@27 in canonical cents that would otherwise fail).
  - `isInitialBuild=true` → TURNOVER_CAP passes with skipped details.
  - `isInitialBuild=true` → CONCENTRATION_LIMIT still runs, still fires on >30% (regression guard).
  - `isInitialBuild=false` → MAX_SINGLE_TRADE fires normally on a real over-cap trade in canonical cents (units regression).
- **`services/advisory/compliance-ctrl/test/unit/rule-engine.test.ts`** — assert ComplianceInput shape carries `riskCategory` + `isInitialBuild` + `portfolioValueCents`; order of rule evaluation unchanged.
- **`services/advisory/compliance-ctrl/test/unit/event-listener.test.ts`** — RECOMMENDATION_PROPOSED with new subject fields produces correct ComplianceInput.

### Integration tests (Jest, real AWS dev infra)

- **`services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`** — new case: emit DEPOSIT_DETECTED for a fresh tenant with seeded BALANCED MandateSnapshot + InvestorProfileSnapshot `{ riskCategory: 'MODERATE' }`. Assert RECOMMENDATION_PROPOSED emitted with `subject.isInitialBuild===true, subject.riskCategory==='MODERATE', subject.portfolioValueCents===<deposit>`, and `proposedTrades[0].quantityOrAmountCents` matches `round(targetWeight * portfolioValueCents)`.
- **`services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`** — new case: ingest RECOMMENDATION_PROPOSED with `isInitialBuild=true, riskCategory='MODERATE'`, 55% equity allocation, BND@27. Assert: ComplianceCheck written with `result: 'APPROVED'`, audit checks show MAX_SINGLE_TRADE/TURNOVER_CAP with `passed: true, details: 'Skipped...'`, SUITABILITY `passed: true`, DECISION_APPROVED emitted via CDC with `authorityLevel: 'L2'`. Counter-case: same payload with `isInitialBuild=false` → MAX_SINGLE_TRADE fires → BLOCKED.

### E2E (Playwright, real deployed dev) — the gate

- **`apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts`** — unchanged. The test was already correct.
- Per [[feedback-flake-means-broken]] require **two consecutive passes** at the validation gate. If first run flakes-then-passes, pull CloudWatch evidence from the failing window before declaring shipped.

### Tests intentionally NOT added

- `ledger-ctrl` — existing tests use canonical-cents values; no fix needed. `pnpm nx affected` catches incidental regression.
- `broker-sim-adpt` / `broker-alpaca-adpt` — out of scope per backlog; quick grep at implementation time, file parking-lot if any consumer would break.

## Validation gate

`docs/backlog/e2e-test-tolerance-or-agent-constraint-against-suitability-block.md` → `validation_gate:` populated at ship with:
- Commit SHA of the merge.
- `pnpm nx affected -t test,lint --base=origin/main` green.
- Deploy script success line for advisory services.
- `pnpm nx run advisory-compliance-ctrl:test-integration` + `pnpm nx run advisory-decision-workflow-ctrl:test-integration` green output.
- Two consecutive `new-investor-happy-path` Playwright passes against deployed dev (per [[feedback-flake-means-broken]]).

## Open questions

**OQ1 (informational, not blocking) — `isInitialBuild` is effectively `true` for every decision until steady-state plumbing exists.**

`AssemblePacket` currently derives `currentPositions` from `portfolio?.currentPositions` (`assemble-packet.ts:75`). The PortfolioEngine agent schema (`portfolio-engine-ctrl/src/agents/schemas.ts:4`) does NOT emit `currentPositions` — the agent reasons over `allocations` only, and no SF state hop plumbs the ledger's actual positions into the agent output or AssemblePacket. So in production today, `currentPositions=[]` for every decision regardless of whether the investor actually has holdings.

Under this design, `isInitialBuild = currentPositions.length === 0` is therefore `true` for every decision until a separate workstream ferries ledger positions into the SF state. Consequence: `MAX_SINGLE_TRADE` + `TURNOVER_CAP` will be skipped for every decision system-wide post-deploy, not just the first-deposit decision.

This is consistent with the backlog out-of-scope ("multi-cycle rebalance flows are out of scope"). The system was already broken in this regime — these two guardrails fire absurdly under the units bug today, so users have never seen them work correctly. The fix consciously moves from "always wrongly BLOCK" to "skip pending steady-state plumbing", which is strictly better.

**Mitigation:** the integration test counter-case (`isInitialBuild=false → MAX_SINGLE_TRADE fires`) guards the *rule semantics* so when a future workstream plumbs `currentPositions`, the rules immediately become active.

**Follow-up queued (not parking):** filed as `docs/backlog/ferry-ledger-positions-to-advisory-steady-state-decisions.md` at QUEUED rank 3. Per [[feedback-e2e-gaps-queued-not-parking]] anything required to make the e2e suite truly green is queued — a production bug we don't have e2e coverage for is itself the e2e gap. That workstream bundles both halves: (a) ferry ledger positions to advisory and (b) add the missing steady-state e2e scenario that would have caught this.

## References

- Backlog file: `docs/backlog/e2e-test-tolerance-or-agent-constraint-against-suitability-block.md`
- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` (L56-L74, L76)
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` (L160-L192 AssemblePacket, L202-L239 WaitForCompliance, L338-L432 snapshot lookups)
- `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` (L19-L64)
- `services/advisory/compliance-ctrl/src/rules/suitability-checker.ts` (L7-L60)
- `services/advisory/compliance-ctrl/src/rules/guardrail-evaluator.ts` (L25-L110)
- `services/advisory/compliance-ctrl/src/rules/guardrail-params.ts` (L15-L31)
- `services/investor/investor-bff/src/domain/risk-profile.service.ts` (L12-L35)
- `services/advisory/investor-profile-ctrl/src/agents/schemas.ts` (L11-L12)
- `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` (L171-L179)
- `apps/nestfolio-e2e/src/pages/advisory.page.ts` (L50-L66)
