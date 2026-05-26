# Ferry ledger positions + cash into advisory decision SF (steady-state decisions)

**Backlog id:** `ferry-ledger-positions-to-advisory-steady-state-decisions`
**Type:** bug
**Status:** active

## Problem

`services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` reads `currentPositions` from `portfolio?.currentPositions ?? []`. The PortfolioEngine agent's structured-output schema (`services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts`) does not include `currentPositions`; no SF state hop plumbs ledger positions into the agent output. Net effect: `currentPositions = []` for every decision regardless of whether the investor holds anything.

After the `decision-pipeline-units-calibration-suitability` ship, `isInitialBuild = currentPositions.length === 0` is now `true` for every decision; compliance's `MAX_SINGLE_TRADE` + `TURNOVER_CAP` guardrails take the "skip during initial portfolio construction" early-return on every decision. **Steady-state guardrails are effectively disabled in production.**

Additionally, `proposedTrades[i].quantityOrAmountCents = round(targetWeight × portfolioValueCents)` is correct for an initial build (no holdings, full deploy of target) but wrong for any rebalance (the trade should be the *delta* between target and current). The system has no e2e scenario exercising a post-onboarding rebalance — such a scenario would currently fail.

## Goal

Plumb the ledger's current positions + cash balance into the advisory decision SF so `AssemblePacket` produces correct `currentPositions`, `portfolioValueCents`, `isInitialBuild`, and delta-based `proposedTrades` on every trigger — not just initial-build triggers. Add backend integration coverage proving the chain works, plus a Playwright scenario asserting the UI surfaces delta trades.

## Mechanism — A: DWC-local LedgerSnapshot projection

Extend the existing `SnapshotProjectorIngress` in `decision-workflow-ctrl` to also subscribe to `PORTFOLIO_UPDATED` (already forwarded ledgerBus → advisoryBus by `advisory-adpt`). Project a `LedgerSnapshot` row in DWC's own state table. The SF state machine reads it via `DDB GetItem` in `ParallelProjections` — same pattern as `InvestorProfileSnapshot` + `MarketSnapshot`.

```
ledger-ctrl ── PORTFOLIO_UPDATED ─→ ledgerBus
                                       │
                            advisory-adpt FromLedger rule (exists)
                                       │
                                       ▼
                                  advisoryBus
                                       │
                ┌──────────────────────┼─────────────────────┐
                ▼                                            ▼
   SnapshotProjectorIngress (extended)               decision-workflow-ctrl SF
                │                                       (LookupLedgerSnapshot)
                │ materializeToTable                        ▲
                ▼                                           │ DDB GetItem
   DWC State Table:                                         │
   LedgerSnapshot#{tenantId} ◀──────────────────────────────┘
   { state (JSON-stringified), lastEventSequence, ... }
```

**Rejected alternatives:**

- **B — Trigger event embeds portfolio body** (positions on `PORTFOLIO_DRIFT_DETECTED + ORDER_* + DEPOSIT_DETECTED` subjects). Couples every trigger event shape to ledger snapshot shape; brittle.
- **C — PE agent emits `currentPositions`** (deterministic pre-fetch into agent context). Round-trips a deterministic ledger read through an LLM reasoning surface; wastes inference tokens.

## Event topology

**Consumed:** `PORTFOLIO_UPDATED` from advisoryBus (already forwarded by `advisory-adpt` FromLedger rule). Subject shape (per `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`):

```ts
subject: {
  tenantId: string,
  streamType: string,
  positions: Record<string, { quantity: number, lastFillPrice: number, ... }>,
  positionCount: number,
  totalValueCents: number,
  snapshot: {
    positions: Record<string, ...>,
    cashBalanceCents: number,
    lastEventSequence: number,
  },
}
```

`userId` is **not** carried — ledger keys by `tenantId` only. The projection follows suit.

**No new event types introduced.**

## Projection — `LedgerSnapshot`

**Storage key:** `pk = 'LedgerSnapshot#{tenantId}'`, `sk = 'LedgerSnapshot'`. One row per tenant. Matches ledger's per-tenant addressing.

**Stored attributes:**

```ts
{
  tenantId,
  state: JSON.stringify({ positions, cashBalanceCents }),  // JSON-stringified for SF States.StringToJson read
  lastEventSequence,
  sourceEventId,
  updatedAt: ISO8601,
}
```

`state` is JSON-stringified because the SF reads it via `States.StringToJson(...Item.state.S)` — same idiom as `agentOutput` on `InvestorProfileSnapshot` / `MarketSnapshot`. Avoids exposing DDB-AV wire format (`.M` / `.N`) to JSONPath consumers.

**Late-arrival behaviour.** Aligned with `InvestorProfileSnapshot` + `MarketSnapshot` + `MandateSnapshot`: plain `record()` upsert with no `lastEventSequence` guard. `RecordIntent` does not support a conditional write today (only `UpdateIntent` does — see `libs/event-processor/src/types/write-intent.ts`). Late-arrival reordering is theoretical (EventBridge gives at-least-once but ordering is bounded by CDC batch size × Lambda concurrency for a single tenant); if it manifests in practice, a follow-up workstream extends the event-processor API to support `record()` with a condition. We store `lastEventSequence` on the row anyway so future-us has the field available without a backfill.

**Projector function** added to `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`:

```ts
function projectLedgerSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const snapshot = subject.snapshot as { positions; cashBalanceCents; lastEventSequence } | undefined;
  if (!snapshot) throw new NotRetryableError(`PORTFOLIO_UPDATED missing subject.snapshot for tenant=${tenantId}`);
  const attrs = {
    tenantId,
    state: JSON.stringify({ positions: snapshot.positions, cashBalanceCents: snapshot.cashBalanceCents }),
    lastEventSequence: snapshot.lastEventSequence,
    sourceEventId: (subject.sourceEventId as string) ?? ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  return record('LedgerSnapshot', attrs, {
    pk: projectedLedgerSnapshotPk(tenantId),
    sk: PROJECTED_LEDGER_SNAPSHOT_SK,
  });
}
```

`createHandlers()` adds `[LedgerCtrlEventTypes.PORTFOLIO_UPDATED]: (p, c) => projectLedgerSnapshot(p, c)`.

**Repository helper** (`projected-snapshot.repository.ts`) gets new exports: `projectedLedgerSnapshotPk(tenantId)` + `PROJECTED_LEDGER_SNAPSHOT_SK`.

**Ingress subscription** in `service.stack.ts` adds `LedgerCtrlEventTypes.PORTFOLIO_UPDATED` to the `SnapshotProjectorIngress` event-type set. Cross-service event-type import already established per the DWC CLAUDE.md card.

## SF state machine changes

`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` gains a third branch in `ParallelProjections`:

```
Branch C: LookupLedgerSnapshot (DDB GetItem, ResultPath = $.ledgerSnapshotResponse)
   key: { pk: 'LedgerSnapshot#{$.tenantId}', sk: 'LedgerSnapshot' }
   │
   ▼
CheckLedgerSnapshotPresent (Choice)
   when isPresent($.ledgerSnapshotResponse.Item.state.S)
     → ExtractLedgerSnapshot (Pass)
          state.$: States.StringToJson($.ledgerSnapshotResponse.Item.state.S)
       resultPath: '$.ledgerSnapshot'
   otherwise
     → HandleMissingLedgerSnapshot (Pass)
          result: { state: { positions: {}, cashBalanceCents: 0 } }
       resultPath: '$.ledgerSnapshot'
```

`Choice` on `isPresent(...state.S)` — never `Catch` on `States.Runtime`, per [[feedback-states-runtime-uncatchable]]. Symmetric with IP/Market branches.

**`MergeProjections` update.** Add a third lift:

```
'ledgerSnapshot.$': '$.parallelResults[2].ledgerSnapshot.state',
```

**Pass-through plumbing.** Add `'ledgerSnapshot.$': '$.ledgerSnapshot'` to `SetInvestorProfile` and `HoistMandateFromTrigger` (the two Pass states gating `ResolveMandateSnapshot`) — both today re-emit the full identity-field set, and missing this field on either path silently drops it. Regression tests at `test/unit/decision-state-machine.test.ts` assert each forwarding line.

**`AssembleDecisionPacket` payload update:**

```ts
'ledgerSnapshot.$': '$.ledgerSnapshot',
```

The Lambda now reads `currentPositions` and `cashBalanceCents` from `event.ledgerSnapshot` instead of `event.portfolio.currentPositions` (which was always `undefined`).

**IAM:** SF role already has `dynamodb:GetItem` on the local State table. **No new grants.**

**Latency:** P99 +10ms (single-digit-ms DDB GetItem added to an existing Parallel). Well within `AGENT_BUDGETS`.

## AssemblePacket rebalance math

`services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` change.

**Step 1 — Portfolio value:**

```ts
const positionsBySymbol = ledgerSnapshot.positions ?? {};
const currentPositions = Object.entries(positionsBySymbol)
  .filter(([_, p]) => (p.quantity ?? 0) > 0)  // skip zero/negative quantities
  .map(([symbol, p]) => ({
    symbol: symbol.trim().toUpperCase(),
    quantity: p.quantity,
    marketValueCents: Math.round(p.quantity * p.lastFillPrice * 100),
  }));

const currentPositionsValueCents = currentPositions.reduce((s, p) => s + p.marketValueCents, 0);
const portfolioValueCents = currentPositionsValueCents + (ledgerSnapshot.cashBalanceCents ?? 0) + (triggerAmountCents ?? 0);
const isInitialBuild = currentPositions.length === 0;
```

`cashBalanceCents` now comes from ledger (not derived). `triggerAmountCents` is **incoming, not-yet-ledgered** — DEPOSIT_DETECTED fires before ledger processes the deposit, so the portfolio value reflects what *will* be available post-settlement.

**Step 2 — Index by symbol:**

```ts
const targetBySymbol = new Map<string, Allocation>();
for (const a of allocationsArray) {
  if (!a.instrument || a.assetClass === 'CASH') continue;
  targetBySymbol.set(a.instrument.trim().toUpperCase(), a);
}
const currentBySymbol = new Map<string, CurrentPosition>();
for (const p of currentPositions) currentBySymbol.set(p.symbol, p);
```

**Step 3 — Delta computation:**

| Case | Side | quantityOrAmountCents | targetWeightPercent |
|---|---|---|---|
| In target, not held | `BUY` | `round(targetWeight × portfolioValueCents)` | `targetWeight × 100` |
| In target AND held, target > current | `BUY` | `targetCents − currentCents` | `targetWeight × 100` |
| In target AND held, target < current | `SELL` | `currentCents − targetCents` | `targetWeight × 100` |
| Held, not in target | `SELL` | `currentCents` (full liquidation) | `0` |

**Step 4 — Micro-trade filter:**

```ts
const MICRO_TRADE_EPSILON_BPS = 100;  // 1% of portfolioValueCents
const epsilonCents = Math.round((portfolioValueCents * MICRO_TRADE_EPSILON_BPS) / 10_000);
const proposedTrades = candidates.filter(t => t.quantityOrAmountCents >= epsilonCents);
```

`MICRO_TRADE_EPSILON_BPS` lives next to `AGENT_BUDGETS` in `services/advisory/decision-workflow-ctrl/src/agent-budgets.ts` unless plan-stage finds it shared with PE/compliance (OQ3).

**Step 5 — Deterministic ordering:** sort by `(side, symbol)` so SELLs precede BUYs (cash-recycling order) and tests can assert on `proposedTrades[0]` without flake.

**Step 6 — SF ResultSelector:** unchanged shape — `{ proposedTrades, portfolioValueCents, isInitialBuild, riskCategory, currentPositions }`. `currentPositions` is now the array `{ symbol, quantity, marketValueCents }[]` from Step 1, replacing the always-empty PE-agent placeholder.

**Unchanged:** PE agent schema, narrative agent, compliance-ctrl rule engine, `ProposedTrade` GraphQL type, advisory-bff transforms.

## Test strategy

Three artefacts, ordered by cost.

### DWC integration test — `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

New test cases:

- **`LedgerSnapshot projection materializes from PORTFOLIO_UPDATED`** — emit synthetic event; assert DDB Item exists with stringified `state`.
- **`Repeated PORTFOLIO_UPDATED upserts row`** — emit two events for same tenant; row reflects second event (last-write-wins, no conditional guard). Documents the chosen behaviour.
- **`SF AssemblePacket payload carries ledgerSnapshot`** — project row, trigger SF via `PORTFOLIO_DRIFT_DETECTED`, assert the Lambda input event carries `ledgerSnapshot.positions.VTI.quantity` + `cashBalanceCents`.
- **`Absent LedgerSnapshot falls through to HandleMissingLedgerSnapshot`** — SF starts without prior projection; AssemblePacket sees `{ positions: {}, cashBalanceCents: 0 }`.

### compliance-ctrl integration test — `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

- **`MAX_SINGLE_TRADE fires in steady-state`** — emit `RECOMMENDATION_PROPOSED` with `isInitialBuild=false`, oversized single trade. Assert `DECISION_BLOCKED` + rule `MAX_SINGLE_TRADE`.
- **`TURNOVER_CAP fires in steady-state`** — emit envelope with sum-of-|deltas| above cap. Assert blocked.
- **Regression-guard: `Initial-build skip path still active`** — `isInitialBuild=true` + same oversized trades. Assert `DECISION_APPROVED`.

### Playwright scenario — `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts`

Uses `onboardedPage` fixture (no wizard). Shape:

1. `injectPortfolioUpdated(ctx, tenant, { positions: { VTI: ..., BND: ... }, cashBalanceCents: 500_000 })`
2. `waitForLedgerSnapshotRow(ctx, tenant)` — polls DDB
3. `injectAdvisoryBffTriggerEvent(ctx, tenant, { detailType: 'PORTFOLIO_DRIFT_DETECTED' })`
4. Navigate `/advisory`; assert `[data-testid=decision-card]` visible (timeout 90s)
5. Assert `[data-testid=proposed-trade]` filtered by `BUY` has count ≥1 AND filtered by `SELL` has count ≥1
6. Assert `[data-testid=rebalance-badge]` visible

New fixtures in `apps/nestfolio-e2e/src/fixtures/`:

- `inject-portfolio-updated.ts` — EventBridge PutEvents wrapper. OQ1 governs whether emit-direct-to-advisoryBus (faster) or via ledgerBus + real adapter (more honest).
- `wait-for-ledger-snapshot.ts` — DDB polling, mirrors `wait-for-advisory-projection.ts`.

UI work (OQ2):
- Verify `[data-testid=decision-card]` + `[data-testid=proposed-trade]` exist on the advisory page; add if missing.
- Add `[data-testid=rebalance-badge]` element — a visible affordance distinguishing rebalance decisions from initial-build. The UI is part of the bug (no visible rebalance signal today) per [[feedback-e2e-ui-assertions-only]].

Scenario runs twice consecutively per [[feedback-flake-means-broken]].

### Convention doc — `apps/nestfolio-e2e/CLAUDE.md`

New file codifying:

- **`journeys/` vs `scenarios/`** — table from §5.4 of brainstorming.
- **Default `scenarios/`** — only the wizard test legitimately belongs in `journeys/`.
- **Fixture choice** — `onboardedPage` skips the wizard; use it unless the wizard IS the test.
- **Synthetic event injection** — `fixtures/inject-*.ts` patterns; `source: 'integration-test:<consumer>'` $or filter convention.

## Rollout

Single deploy: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl`.

All changes inside DWC: new `SnapshotProjectorIngress` subscription, new SF state machine state, new `assemble-packet.ts` logic, new projector function, new repository helpers. No cross-service ordering.

**Bootstrap window.** Existing tenants with ledger positions have no `LedgerSnapshot` row until their next `PORTFOLIO_UPDATED` post-deploy. During that gap, SF takes the `HandleMissingLedgerSnapshot` path and treats decisions as initial-build — **identical to today's broken state**, so no regression. Dev sandbox is disposable per [[feedback-no-deprecation]]; no backfill job needed. Prod not yet live; N/A.

**SF version semantics.** Step Functions creates a new revision on deploy; in-flight executions complete on the old definition. Atomic, safe.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Late-arrival `PORTFOLIO_UPDATED` overwrites newer state | Low | Accepted; aligned with IP/Market/Mandate projector patterns. `lastEventSequence` stored on the row so a future-us workstream can add a guard without backfill. |
| Symbol whitespace/case drift between PE allocations and ledger positions | Low | `.trim().toUpperCase()` on both sides when keying Maps. |
| Zero/negative quantity in positions (corporate-action edge) | Low | Filter `quantity > 0` when building `currentPositions`. |
| PE agent target weights sum > 1.0, oversizing trade total | Low | Compliance `TURNOVER_CAP` catches naturally. |
| Synthetic `PORTFOLIO_UPDATED` source filter doesn't match projector $or | Medium | Verify at plan time (OQ1); fallback emits via ledgerBus + real adapter. |
| Advisory MFE missing required `data-testid` attributes | Medium | Verify at plan time (OQ2); add as part of this workstream. |

## Out of scope

- **Drift-rebalance guardrail-param calibration** — whether BALANCED's `maxSingleTradePercent=10` + `monthlyTurnoverCapPercent=25` are correctly tuned for steady-state. Wait for firing data; separate workstream.
- **Real-time position market-value recalculation** on ticker tick. `lastFillPrice` stays the snapshot; positions don't re-mark to market. Separate workstream.
- **Generalising the ledger snapshot for non-decision consumers.** The projection is DWC-private; per [[feedback-no-api-between-services]] each consumer gets its own projector when needed.
- **Refactoring `deposit-reload-mid-flight.spec.ts` from journey to scenario.** Smell flagged this session; separate backlog item.
- **Parameterising `new-investor-happy-path.spec.ts` over operating modes × risk levels.** Separate workstream.
- **Backfill of `LedgerSnapshot` rows for existing tenants at deploy time.** Bootstrap window accepted above.

## Done definition

- `PORTFOLIO_UPDATED` → `LedgerSnapshot` projection row materializes in DWC state table.
- Repeated `PORTFOLIO_UPDATED` for the same tenant upserts row (last-write-wins).
- SF `LookupLedgerSnapshot` branch reads the row and propagates `ledgerSnapshot` into `AssemblePacket` payload.
- Absent `LedgerSnapshot` row falls through to `HandleMissingLedgerSnapshot`.
- `assemble-packet.ts` computes `portfolioValueCents = positions + cash + triggerAmount`.
- `isInitialBuild = currentPositions.length === 0` reflects ledger state.
- `proposedTrades` emit BUY+SELL deltas in steady-state; micro-trades filtered.
- `MAX_SINGLE_TRADE` + `TURNOVER_CAP` fire correctly in steady-state.
- Initial-build skip path preserved.
- PW scenario `scenarios/rebalance-trades-on-drift.spec.ts` passes twice consecutively per [[feedback-flake-means-broken]].
- `apps/nestfolio-e2e/CLAUDE.md` documents `journeys/` vs `scenarios/`.

## Open questions

1. **OQ1** — Source filter routing for the PW scenario's synthetic `PORTFOLIO_UPDATED`. Direct-to-advisoryBus with `source: 'integration-test:decision-workflow-ctrl'` should match the projector's $or filter; verify at plan time. Fallback path emits to ledgerBus + uses the real adapter forward.
2. **OQ2** — Existing advisory MFE `data-testid` attributes for `decision-card` + `proposed-trade`. Verify and add `rebalance-badge`.
3. **OQ3** — Constant location for `MICRO_TRADE_EPSILON_BPS`. Sibling to `AGENT_BUDGETS` in `decision-workflow-ctrl/src/agent-budgets.ts`, or new `trade-thresholds.ts`. Decide based on whether the value is shared with PE/compliance.

## References

- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` (the bug site)
- `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` (the extension target)
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` (the SF integration)
- `services/advisory/decision-workflow-ctrl/src/repositories/projected-snapshot.repository.ts` (new key helpers)
- `services/advisory/portfolio-engine-ctrl/src/agents/schemas.ts` (positions-blind PE — unchanged)
- `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts` (`PORTFOLIO_UPDATED` subject shape)
- `services/advisory/advisory-adpt/src/service.stack.ts` (ledger→advisory forward — exists, unchanged)
- `apps/nestfolio-e2e/src/fixtures/test.ts` (`onboardedPage` fixture used by the scenario)
- `apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts` (template for the new scenario)
- `docs/superpowers/specs/2026-05-25-decision-pipeline-units-calibration-suitability-design.md` (parent workstream)
