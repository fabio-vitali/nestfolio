# WS-4 ledger-ctrl typed RecordFill (break D consumer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Make a real `ORDER_FILLED` update cash balance + positions (and live tax-lots) by feeding `RecordFill` the real economics the post-WS-3 event carries.

**Architecture:** WS-3 made the producer emit `symbol`/`side` and made `ORDER_FILLED` carry `filledQty`/`averageFillPrice`. The ledger reducer (`account.reducer.ts`) and the shadow-fill simulated path already use the canonical fill shape `{orderId, symbol, side, quantity, fillPrice, filledAt}`. The only gap is `processOrderActualEvent`, which stores the **raw** NormalizedOrderEvent subject (`filledQty`/`averageFillPrice`/`timestamp`) — so `RecordFill` reads `quantity`/`fillPrice`/`filledAt` as `undefined` and the command fails (state unchanged). Fix: normalize the actual payload to the canonical names at the listener, and fix the live tax-lot block to read the typed parsed subject. No reducer change, no schema change.

**Tech Stack:** zod, `@nestfolio/event-processor` (`parseSubject`), `@nestfolio/event-processor/sourcing` (`applyCommand`/`RecordFill`), Jest.

## Global Constraints

- Tests in `test/`, not `src/__tests__/`. Event-processor pipelines only.
- `NormalizedOrderEventSchema` `symbol`/`side`/`filledQty`/`averageFillPrice` are **optional** at the producer boundary (WS-3); the order SF always writes `symbol`/`side` and writes `filledQty`/`averageFillPrice` on FILLED. The ledger consumer guards their presence (`RecordFillSchema` is the strict boundary).
- Worktree commits: `git commit --no-verify`, verify landed.

## File map

- `services/ledger/ledger-ctrl/src/handlers/event-listener.ts` — `processOrderActualEvent`: normalize the actual fill payload to canonical names; fix the live tax-lot block to read the parsed subject.
- Test: `services/ledger/ledger-ctrl/test/unit/handlers/event-listener.test.ts`.
- (No change to `account.reducer.ts` / `record-fill.ts` — already canonical; their tests stay green.)

---

### Task 1: Normalize the actual ORDER_FILLED payload + fix the live tax-lot reads

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts` (`processOrderActualEvent`, ~lines 26-75)
- Test: `services/ledger/ledger-ctrl/test/unit/handlers/event-listener.test.ts`

**Interfaces:**
- Consumes: `parseSubject(payload, NormalizedOrderEventSchema)` → `{ orderId, symbol?, side?, executionMode, filledQty?, averageFillPrice?, timestamp, ... }`.
- Produces: a stored `LedgerEntry.payload` in the canonical fill shape `{ ...subject, quantity, fillPrice, filledAt }` (matching the reducer + shadow-fill path) so `RecordFill` gets real economics; live tax-lots opened/closed with the real symbol/quantity/price.

- [ ] **Step 1: Failing test** — in `event-listener.test.ts`, drive the `ORDER_FILLED` handler with a realistic post-WS-3 subject `{ orderId, symbol:'VTI', side:'BUY', executionMode:'simulation', filledQty: 2.5, averageFillPrice: 200, timestamp:'…' }` and assert the `putLedgerEntry` payload has `quantity: 2.5, fillPrice: 200, filledAt` set (canonical names). Add a `live` BUY case asserting `taxLotManager.openLot` is called with `{ symbol:'VTI', quantity: 2.5, costBasisPerShare: 200 }`. (Match the file's existing mock setup for `repository`/`taxLotManager`.)
- [ ] **Step 2: Run, verify fail** — `pnpm nx test ledger-ctrl -- --testPathPatterns event-listener` → FAIL (payload has filledQty/averageFillPrice, not quantity/fillPrice; tax-lot reads undefined).
- [ ] **Step 3: Implement** in `processOrderActualEvent`:

```ts
const subject = parseSubject(payload, NormalizedOrderEventSchema);

// Normalize the fill economics to the canonical ledger-entry field names the reducer +
// the shadow-fill (simulated) path use, so RecordFill receives real economics (WS-4 break D consumer).
const eventPayload: Record<string, unknown> = {
  ...subject,
  ...(subject.filledQty !== undefined && {
    quantity: subject.filledQty,
    fillPrice: subject.averageFillPrice,
    filledAt: ctx.timestamp,
  }),
};
```

  Then replace the tax-lot block (remove the `payload.subject` boundary cast + `as` casts; read the typed parsed subject, guard the optional fields):

```ts
if (ctx.eventType === ExecutionCrossDomainEventTypes.ORDER_FILLED && subject.executionMode === 'live') {
  if (subject.symbol && subject.side && subject.filledQty !== undefined && subject.averageFillPrice !== undefined) {
    if (subject.side === 'BUY') {
      await deps.taxLotManager.openLot({
        tenantId: ctx.tenantId, orderId: subject.orderId, symbol: subject.symbol,
        quantity: subject.filledQty, costBasisPerShare: subject.averageFillPrice, acquiredAt: ctx.timestamp,
      });
    } else {
      await deps.taxLotManager.closeLots({
        tenantId: ctx.tenantId, symbol: subject.symbol, quantity: subject.filledQty,
        salePrice: subject.averageFillPrice, soldAt: ctx.timestamp, orderId: subject.orderId,
      });
    }
  } else {
    logger.warn('live ORDER_FILLED missing symbol/side/filledQty/averageFillPrice — skipping tax-lot tracking', { orderId: subject.orderId });
  }
}
```

- [ ] **Step 4: Run, verify pass** — same command → PASS; `pnpm nx run ledger-ctrl:lint` clean.
- [ ] **Step 5: Commit** — `git commit --no-verify -m "fix(ledger-ctrl): normalize actual fill payload to canonical RecordFill shape + typed tax-lot reads (WS-4 break D consumer)"`; verify landed.

---

### Task 2: Cross-cutting verification

- [ ] **Step 1** — `pnpm nx test ledger-ctrl` (full; reducer + record-fill tests must stay green — they use the canonical shape, unaffected).
- [ ] **Step 2** — true-affected `test,lint` vs origin/main green.
- [ ] **Step 3** — `ledger-ctrl:typecheck` + `event-processor:read-model-drift` green.
- [ ] **Step 4** — deploy ledger-ctrl to dev; per-member integration tests vs deployed dev green. (Expensive e2e batched at epic E6.)

## Out of scope

- Tightening `NormalizedOrderEventSchema` to required (not needed; consumer normalizes + `RecordFillSchema` validates).
- The real accept-decision e2e (WS-5).

## Self-review

- Spec §4 hop 7 (RecordFill reads `quantity←filledQty, fillPrice←averageFillPrice, filledAt←ctx.timestamp`; remove the `payload.subject` boundary cast + `as` casts; live tax-lots get real data) → Task 1. ✓
- Reducer unchanged: it already reads the canonical names; normalizing at the listener feeds it real values for actual fills (the simulated path already did). ✓
