# Operating Mode Implementation Design

> **Partially superseded by [2026-05-08-investor-profile-domain-resplit-design.md](./2026-05-08-investor-profile-domain-resplit-design.md)** — the parts dealing with mandate-on-InvestorProfile, MandateStatus sibling, and carrier-only event topology are reversed. Other parts (multi-row YAGNI removal, plural-Goal removal, version-field cleanup) remain canonical.

**Date:** 2026-04-14
**Status:** Phase 1 SHIPPED 2026-05-05 (verified 4/4 implementation tasks on `main`, E2E gate 3/3 GREEN against deployed dev — see `docs/BACKLOG.md` Recently shipped). Phase 2 (agent-behavior dimension B) filed as new QUEUED `[design]` item.
**Reference:** `specifications/01-product-vision.md` — Operating Modes and Guardrails Table

---

> **⚠️ Post-collapse note (2026-05-05):** This spec was authored before the 2026-05-04 InvestorProfile single-row collapse. References below to a separate `Mandate` row (`sk='Mandate'`), `OperatingModeRecord`, and the `MANDATE_CREATED` / `MANDATE_UPDATED` / `OPERATING_MODE_CHANGED` events are stale — those entities were collapsed into a composite `InvestorProfile` row carrying `mandate.*` + `operatingMode` as embedded fields, with a single `INVESTOR_PROFILE_CREATED` / `INVESTOR_PROFILE_UPDATED` event pair. Authoritative current state: `services/investor/investor-bff/CLAUDE.md` + `services/advisory/compliance-ctrl/CLAUDE.md`. The implementation correctly adapted to the post-collapse model — the spec text below remains for historical context only.

---

## Problem

Operating mode (CONSERVATIVE / BALANCED / AGGRESSIVE) is captured during onboarding and stored in InvestorProfile, but has zero effect on system behavior. Mandate parameters are hardcoded defaults. The authority resolver ignores operating mode entirely. The L1/L2 branching is determined only by mandate level (ADVISORY/DISCRETIONARY), a static $50k threshold, and compliance violations.

The spec defines 10 mode-specific guardrail parameters and clear L1→L2 escalation rules that should vary by mode. None of this is implemented.

## Decisions

1. **Mandate as resolved policy bundle** — operating mode maps to a fixed set of mandate parameters via a lookup table. No per-parameter user customization. Strict mode = strict bundle.

2. **DISCRETIONARY default** — onboarding changes from ADVISORY → DISCRETIONARY mandate. ADVISORY makes everything L2, rendering operating mode meaningless. The spec intends all users to grant discretionary mandates; operating mode controls the scope of that discretion.

3. **Re-derive on mode change** — when the user changes operating mode (L2 action), mandate parameters are re-derived from the new mode and a MANDATE_UPDATED event is emitted.

4. **Mode-aware authority resolver** — compliance-ctrl checks mode-derived thresholds (maxTradeSize, turnoverCap, riskBand, circuitBreaker) instead of the static $50k ceiling.

5. **E2E coverage** — parametrize key E2E scenarios across all 3 modes to verify L1/L2 branching varies correctly.

---

## Mode-to-Parameters Lookup Table

Source of truth: `specifications/01-product-vision.md`

| Parameter | Field name | Conservative | Balanced | Aggressive |
|---|---|---|---|---|
| Equity Risk Band | `equityRiskBandPercent` | 3 | 6 | 10 |
| Drift Trigger | `driftTriggerPercent` | 2 | 4 | 7 |
| Max Trade Size | `maxSingleTradePercent` | 5 | 10 | 20 |
| Rebalance Cadence | `rebalanceCadence` | QUARTERLY | MONTHLY | BI_WEEKLY |
| Monthly Turnover Cap | `monthlyTurnoverCapPercent` | 10 | 25 | 50 |
| Single ETF Concentration | `singleEtfConcentrationPercent` | 20 | 30 | 40 |
| Volatility Pause Trigger | `volatilityPauseTrigger` | HIGH | MEDIUM | EXTREME |
| Drawdown Circuit Breaker | `drawdownCircuitBreakerPercent` | 8 | 12 | 18 |
| Instrument Cool-Down | `coolDownDays` | 10 | 5 | 2 |
| Illiquid Assets | `illiquidAssetsPolicy` | NOT_ALLOWED | LIMITED | ALLOWED_SCREENED |

---

## Changes by Service

### investor-bff

**1. Lookup table function**

New pure function: `resolveGuardrailParams(mode: OperatingMode): GuardrailParams`

Returns the full parameter set for the given mode. This is the single source of truth for the mode-to-parameters mapping. Lives in a shared domain module so both onboarding and mode-change paths use it.

**2. Onboarding mandate creation** (`src/transforms/onboarding-completed.ts`)

- Change default mandate level from `'ADVISORY'` to `'DISCRETIONARY'`
- Replace hardcoded mandate parameters with `resolveGuardrailParams(operatingMode)`
- Add new fields to the Mandate DynamoDB record: `equityRiskBandPercent`, `driftTriggerPercent`, `singleEtfConcentrationPercent`, `drawdownCircuitBreakerPercent`, `volatilityPauseTrigger`, `illiquidAssetsPolicy`
- Existing fields (`maxSingleTradePercent`, `monthlyTurnoverCapPercent`, `coolDownDays`, `rebalanceCadence`) are now derived from mode instead of hardcoded

**3. Mode change handler** (new handler or addition to event-listener)

When `OPERATING_MODE_CHANGED` is received (could be from own CDC or from a settings mutation):
- Read the new operating mode
- Call `resolveGuardrailParams(newMode)`
- Update the Mandate record with new parameters
- The update triggers CDC → `MANDATE_UPDATED` event via Egress

### compliance-ctrl

**4. Extended MandateSnapshot schema**

Add new fields to the materialized MandateSnapshot (populated from `MANDATE_CREATED` / `MANDATE_UPDATED` events):

```
equityRiskBandPercent: number
driftTriggerPercent: number
singleEtfConcentrationPercent: number
drawdownCircuitBreakerPercent: number
volatilityPauseTrigger: 'HIGH' | 'MEDIUM' | 'EXTREME'
illiquidAssetsPolicy: 'NOT_ALLOWED' | 'LIMITED' | 'ALLOWED_SCREENED'
```

**5. Authority resolver rewrite** (`src/rules/authority-resolver.ts`)

Replace current logic:

```
if mandate.level === 'ADVISORY' → L2
if violations.length > 0 → L2
if hasLargeTrade (> $50k) → L2
else → L1
```

With mode-aware logic:

```
if mandate.level === 'ADVISORY' → L2  (backwards compat)
if violations.length > 0 → L2
if any trade > mandate.maxSingleTradePercent of portfolio value → L2
if monthly turnover would exceed mandate.monthlyTurnoverCapPercent → L2
if portfolio drawdown > mandate.drawdownCircuitBreakerPercent → L2
if allocation change > mandate.equityRiskBandPercent → L2
if strategy model changes allocation class → L2
else → L1
```

The static $50k threshold is replaced by the mode-derived percentage. The guardrail evaluator may also use `singleEtfConcentrationPercent`, `driftTriggerPercent`, and `illiquidAssetsPolicy` for violation detection (not just L1/L2 branching).

### e2e-feature-tests

**6. Parametrized E2E scenarios**

Using the existing `onboarded()` fixture with `operatingMode` override:

| Scenario | Modes tested | What it verifies |
|---|---|---|
| accept-decision (small trade) | CONSERVATIVE, BALANCED, AGGRESSIVE | Same trade is L2 in Conservative (>5%), L1 in Aggressive (<20%) |
| accept-decision (large trade) | CONSERVATIVE, BALANCED, AGGRESSIVE | Large trade is L2 in all modes, with different threshold messages |
| rebalance-on-drift | CONSERVATIVE, BALANCED, AGGRESSIVE | Different drift triggers (2%/4%/7%) cause rebalance at different drift levels |

Implementation: parametrized test files using `describe.each` or separate test files per mode, using `onboarded({ operatingMode: 'CONSERVATIVE', mandateLevel: 'DISCRETIONARY' })`.

---

## What Does NOT Change

- **Event topology** — OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED events already flow correctly between domains
- **Advisory agents** — they already receive operating mode in golden context; their recommendation logic is independent of this work
- **Onboarding UI** — mode selection step already exists (Step 5)
- **Decision workflow** — already reads compliance result for L1/L2 branching via the state machine
- **CDC / Egress** — mandate updates already emit events via DynamoDB Streams

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Changing default mandate to DISCRETIONARY enables autonomous execution | The guardrail thresholds are tight — Conservative's 5% max trade means most actions still escalate to L2. Rollout can start with Conservative-only in early flight phases. |
| Existing users with ADVISORY mandate | No existing production users yet (dev deployment). If there were, a migration would update their mandate to DISCRETIONARY with Balanced parameters. |
| Mode change race condition | Mode change is L2 (user must confirm). Mandate update is atomic DynamoDB write. compliance-ctrl re-materializes on MANDATE_UPDATED. No race. |
