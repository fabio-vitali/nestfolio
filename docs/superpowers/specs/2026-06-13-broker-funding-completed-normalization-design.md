# Broker funding-completed normalization — coherent id+amount chain (design)

- **Date:** 2026-06-13
- **Backlog:** `broker-funding-completed-normalization-drift`
- **Type:** bug (live-money path) + typed-subject completion
- **Lane:** Complex (worktree + deploy + e2e)
- **Status:** design approved (decisions below), pending spec review → writing-plans

## 1. Problem

`broker-ctrl`'s `deposit-withdrawal-normalizer` normalizes heterogeneous inbound
funding-completed events (sim deposit/withdrawal, alpaca transfer completed/failed)
into a common `FundingEvent` carrier. It reads `transferId` / `amountCents` /
`currency` / `userId` off each subject via `payload.subject as Record<string,unknown>`
— but the producers emit **different field names**, and on the live (alpaca) path the
funding **id is not threaded coherently**, so the carry-forward lookup misses.

Tracing the full deposit/withdrawal lifecycle surfaced that the bug is **not isolated
to the completion handler** — the request hop is broken too, and the two are
inseparable.

### 1.1 Confirmed drift (verified against code 2026-06-13)

**Request hop — `broker-ctrl` router → `broker-alpaca`**
- `deposit-withdrawal-router.ts:30,59` emits `ALPACA_TRANSFER_REQUESTED` as
  `{ ...DepositInitiated|WithdrawalInitiated, direction }` — i.e. carrying
  `depositId`/`withdrawalId` + `amountCents` + `currency` + `direction`.
- `broker-alpaca-adpt/.../event-listener.ts:81,220-221,228,248` reads `s.transferId`,
  `s.amount`, `s.relationshipId` — **none of which exist** on that subject. Effect on
  the **live** path: `nestfolioTransferId = ctx.eventId` (wrong id); `String(s.amount)`
  = **`"undefined"` sent to the Alpaca ACH API**; `relationship_id = ''`.

**Completion hop — `broker-alpaca`/`broker-sim` → `broker-ctrl` normalizer (the filed bug)**
- `broker-alpaca-adpt/.../domain/contracts.ts:28-37` `AlpacaTransferResultSchema` emits
  `{ nestfolioTransferId, alpacaTransferId, direction, amount, status, failureReason?, timestamp? }`
  — **no `transferId`, no `amountCents`, no `currency`, no `userId`**.
- `broker-sim-adpt/.../domain/contracts.ts` `SimWithdrawalCompletedSchema` emits
  `{ withdrawalId, amount (dollars), sourceEventId, timestamp }` — **no `amountCents`,
  no `currency`** (deposit asymmetry: `SimDepositCompletedSchema` does carry
  `amountCents` + `currency`).
- `deposit-withdrawal-normalizer.ts:26,58,88,96` reads `s.transferId` / `s.amountCents`
  / `s.currency` off `payload.subject as Record<string,unknown>`. On the **live**
  path: `transferId` falls back to `ctx.eventId`, so `carryForward` keys on the wrong
  pk and **misses** the requested carrier; `amountCents = undefined`; `currency = 'USD'`.

**Sim withdrawal request hop (third drift)**
- `broker-sim-adpt/.../event-listener.ts:81` reads `subject.amount` on
  `SIM_WITHDRAWAL_REQUESTED`, but the router emits `amountCents` (the sim **deposit**
  handler was already migrated to `parseSubject(DepositInitiatedSchema)` + `amountCents`;
  the withdrawal handler was missed). Latent — see §1.2.

### 1.2 Why it went unnoticed

The broker-ctrl funding pipeline (router → sim/alpaca → normalizer) has **zero
end-to-end coverage**. Every funding e2e short-circuits it with synthetic events:
`apps/e2e-feature-tests/src/funding/withdraw-cash.e2e.test.ts:80-92` injects a synthetic
`WITHDRAWAL_SETTLED` straight to dashboard-bff; `funded()` injects a synthetic
`BALANCE_UPDATED`. So neither the live alpaca path nor the sim pipeline is exercised
end-to-end, masking all three drifts.

### 1.3 Root cause

The funding **id** is the linchpin. The requested carrier (written by the router,
holding the authoritative `amountCents`/`currency`/`userId`) is keyed on
`Funding#<tenantId>#<depositId|withdrawalId>` (`deposit-withdrawal-router.ts:31,60`).
The completion can only recover those values if it presents the **same id** to
`carryForward`. The sim path happens to carry `depositId`/`withdrawalId` so it (mostly)
works; the alpaca path threads an unrelated `nestfolioTransferId` (= the
`ALPACA_TRANSFER_REQUESTED` event's `eventId`), so `carryForward` misses and the
settle/fail row is built from `undefined` fallbacks. Fixing only the completion read is
cosmetic — the id must be threaded coherently through **both** hops.

## 2. Goals / Non-goals

### Goals
1. The live deposit/withdrawal id+amount chain is **correct-by-construction**:
   `transferId = depositId/withdrawalId` survives every hop, and the funding amount
   reaches Alpaca (no `"undefined"`).
2. The completion normalizer `parseSubject`s each event against a producer-owned zod
   contract, **branch per event type** (typed-subject WS-3 convention), removing all
   **4** `as Record<string,unknown>` casts (the last in the repo — closes the
   `event-subject-payload-build-tripwire` documented exception).
3. The sim withdrawal request handler reads `amountCents` (mirrors the deposit handler).
4. No new project cycle; the boundary contracts get a documented home.

### Non-goals (carried to backlog frontmatter)
- **`relationshipId` / real ACH bank-linking.** Stays `''`. A live ACH transfer still
  cannot *succeed* without it; this workstream makes the contract/id chain correct, not
  the bank link. (Funding-onboarding feature — separate.)
- Rewriting `funded()` / `withdraw-cash` synthetic-event fixtures
  (`funded-fixture-balance-updated-missing-snapshot` territory).
- `broker-ctrl-order-sf-input-contract-gap`, `ledger-ctrl-live-tax-lot-missing-order-fields`,
  `broker-ctrl-alpaca-funding-carrier-pk-divergence` — separate parked items.
- The sim deposit/withdrawal completion **unit asymmetry** (sim withdrawal emits dollars,
  deposit emits cents). Absorbed by `carryForward` here; not normalized at the producer.

## 3. Decisions (approved 2026-06-13)

| # | Decision | Choice |
|---|----------|--------|
| Scope | how wide | **Live-path-coherent** — fix request + completion hops + sim-withdrawal drift |
| Approach | completion typing | **B — consumer normalizes**: producers keep honest contracts; normalizer branches per event type and `parseSubject`s each |
| Validation | how proven | **Unit + integration (mocked-Alpaca) + one new sim funding-pipeline e2e** |
| Contract home | placement | **`execution-adpt/domain`** hosts both transfer boundary contracts (extends the home rule) |

## 4. Design — the coherent chain

```
DEPOSIT_INITIATED {depositId, amountCents, currency}            investor-adpt (producer, UNCHANGED)
   │
   ▼ broker-ctrl router — writes requested carrier @ Funding#<t>#<depositId>
   │                       (authoritative amountCents/currency/userId)  [UNCHANGED storage]
   ├─ sim:  SIM_DEPOSIT_INITIATED   {depositId, amountCents, currency, direction}   [UNCHANGED]
   └─ live: ALPACA_TRANSFER_REQUESTED  ← AlpacaTransferRequest contract
   │           { transferId: depositId, amountCents, currency, direction, relationshipId }
   │              │
   │              ▼ broker-alpaca  parseSubject(AlpacaTransferRequestSchema)
   │              │   nestfolioTransferId = transferId(=depositId);  amount = amountCents/100 → Alpaca
   │              ▼ …polling… ALPACA_TRANSFER_COMPLETED  ← AlpacaTransferResult contract
   │                  { nestfolioTransferId: depositId, amount, direction, status }
   ▼ broker-ctrl normalizer
       sim  branch:  parseSubject(SimDeposit/SimWithdrawal)  → key carryForward on depositId/withdrawalId
       live branch:  parseSubject(AlpacaTransferResult)      → key carryForward on nestfolioTransferId
       → carryForward HIT → amountCents/currency/userId from the requested carrier (authoritative)
   ▼ DEPOSIT_DETECTED / DEPOSIT_SETTLED / WITHDRAWAL_SETTLED / *_FAILED   [FundingEvent carrier, UNCHANGED shape]
```

`amountCents`/`currency`/`userId` always come from `carryForward`; the completion
subject's `amount` is a validated cross-check, not the source of truth.

## 5. Contracts

Authored in **`execution-adpt/src/domain/contracts.ts`**, exported via
`@nestfolio/execution-adpt/domain` (alongside `FundingSnapshotSchema`). DRY domain
subjects — identity travels in `RequestContext`, not on the subject.

```ts
// ALPACA_TRANSFER_REQUESTED — produced by broker-ctrl router, consumed by broker-alpaca.
export const AlpacaTransferRequestSchema = z.object({
  transferId: z.string(),            // = the nestfolio depositId/withdrawalId (threaded end-to-end)
  amountCents: z.number().int().positive(),
  currency: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  relationshipId: z.string(),        // '' until ACH bank-linking lands (non-goal)
});

// ALPACA_TRANSFER_* result — produced by broker-alpaca, consumed by broker-ctrl normalizer.
// MOVED here from broker-alpaca-adpt/src/domain/contracts.ts (unchanged shape).
export const AlpacaTransferResultSchema = z.object({
  nestfolioTransferId: z.string(),   // = transferId = depositId/withdrawalId
  alpacaTransferId: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  amount: z.number(),
  status: z.enum(['INITIATED', 'COMPLETED', 'FAILED']),
  failureReason: z.string().optional(),
  timestamp: z.string().optional(),
});
```

**Reused unchanged on the completion side** (consumer imports producer `/contracts`):
`@nestfolio/broker-sim-adpt/contracts` `SimDepositCompletedSchema`,
`SimWithdrawalCompletedSchema`. **Reused on the sim request side:**
`@nestfolio/investor-adpt/domain` `WithdrawalInitiatedSchema`.

### 5.1 Cycle analysis (measured `nx graph`, 2026-06-13)

Current edges: `broker-ctrl → execution-adpt` (type-only `FundingSnapshot`) and
`execution-adpt → broker-ctrl` (`NormalizedOrderEvent` re-export) — a **pre-existing,
tolerated intra-domain cycle**. `broker-alpaca-adpt` is a leaf (libs only).

Hosting both transfer contracts in `execution-adpt/domain` (authored there, **not**
re-exported from broker-alpaca) yields:
- `broker-ctrl → execution-adpt` (already exists; now also a value import)
- `broker-alpaca → execution-adpt` (**new, one-way** — no back-edge)
- **no** `execution-adpt → broker-alpaca` edge (Result authored in execution-adpt)
- **no** `broker-ctrl ↔ broker-alpaca` edge

→ No new cycle; the mutual-`/contracts` import that convention 2 forbids is avoided.
The plan MUST re-verify with `nx graph` after the move.

## 6. Per-file changes (all execution domain)

| File | Change |
|------|--------|
| `execution-adpt/src/domain/contracts.ts` + `index.ts` | Add `AlpacaTransferRequestSchema`/`AlpacaTransferRequest`; add `AlpacaTransferResultSchema`/`AlpacaTransferResult` (moved from broker-alpaca). Export both from `/domain`. |
| `broker-alpaca-adpt/src/domain/contracts.ts` | Remove `AlpacaTransferResultSchema` (moved). Keep `AlpacaOrderResult`, `AlpacaAccountSnapshot`, `BrokerCircuit*`, `CircuitBreaker`. |
| `broker-alpaca-adpt` imports of `AlpacaTransferResult*` | event-listener.ts, publisher-schemas.ts, contracts test → import from `@nestfolio/execution-adpt/domain`. |
| `broker-alpaca-adpt/src/handlers/event-listener.ts` | `processTransferRequested` + both reject helpers: `parseSubject(AlpacaTransferRequestSchema)` once at the top; `nestfolioTransferId = subject.transferId`; `amount = subject.amountCents/100` (dollars) for the API + result row. Removes `s.transferId ?? ctx.eventId` and `s.amount as number` casts. |
| `broker-ctrl/src/handlers/deposit-withdrawal-router.ts` | Live branch: build & emit the typed `AlpacaTransferRequest` (map `depositId`/`withdrawalId`→`transferId`, carry `amountCents`/`currency`/`direction`/`relationshipId:''`). Sim branch unchanged. |
| `broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts` | Split the 4 handlers single-producer; `parseSubject` each (`SimDepositCompleted`, `SimWithdrawalCompleted`, `AlpacaTransferResult`×2 for completed/failed); key `carryForward` on `depositId`/`withdrawalId` (sim) and `nestfolioTransferId` (alpaca). Remove all 4 `as Record<string,unknown>` casts. Map the alpaca `direction` (`INCOMING`/`OUTGOING`) → funding `DEPOSIT`/`WITHDRAWAL`. |
| `broker-sim-adpt/src/handlers/event-listener.ts` | `SIM_WITHDRAWAL_REQUESTED`: `parseSubject(WithdrawalInitiatedSchema)`, use `amountCents` (→ `amountCents/100` dollars), mirroring the deposit handler. |
| Service cards: `broker-ctrl`, `broker-alpaca-adpt`, `broker-sim-adpt`, `execution-adpt` CLAUDE.md | Regen contract/handler sections (audit-service or hand-edit per the card-drift convention). |
| Home-rule docs | Add the "intra-domain mutual boundary → domain adapter `/domain`" clause wherever the typed-subject home rule is documented as a live convention (the docs/skills `typing-convention-enforcement-skills-docs` updated). |

## 7. Error handling

`parseSubject` throws `NotRetryableError` on a malformed subject — correct: a contract
violation must not retry forever, consistent with the rest of the typed-subject work and
the existing `deposit-withdrawal-router` behaviour. The `carryForward` fallback
(`req?.x ?? fallback.x`) is **kept** as defense-in-depth; with the id now correct it
hits on the happy path, and a miss now signals a genuine ordering/missing-request anomaly
(logged, degrades gracefully) rather than silently corrupting the settle row. Alpaca
`amount` is a number; `amountCents/100` is the dollars value sent to the API (mirrors the
sim deposit `amountCents/100` virtual-ledger conversion).

## 8. Testing & validation

**Unit (primary gate)** — all four handlers:
- router: live branch emits a contract-valid `AlpacaTransferRequest` with
  `transferId = depositId/withdrawalId` and `amountCents`.
- broker-alpaca `processTransferRequested`: parses the request, threads
  `nestfolioTransferId = transferId`, sends `amountCents/100` to the (mocked) Alpaca client.
- normalizer: per-producer `parseSubject`, `carryForward` keyed on the correct id, sim +
  alpaca + failed branches; assert authoritative `amountCents`/`currency`/`userId` on the
  emitted carrier. Regression test the alpaca key-recovery specifically.
- sim withdrawal: parses `WithdrawalInitiatedSchema`, debits `amountCents/100`.

**Integration** — `broker-ctrl`, `broker-sim-adpt`, `broker-alpaca-adpt` suites
(mocked Alpaca API for the live path): request → result/normalizer through the real
event-processor pipeline.

**E2E (new)** — one scenario driving the **real sim funding pipeline** end-to-end:
`DEPOSIT_INITIATED → broker-ctrl router → broker-sim → normalizer → DEPOSIT_SETTLED →
investor-bff CashBalance` (no synthetic settle injection). Gives the previously-absent
end-to-end proof. The live alpaca path is **not** e2e'd in dev (paper API + missing
`relationshipId`); it is covered by mocked-Alpaca integration tests.

**Affected-set + deploy** — `tools/affected-projects.mjs` over the changed services;
`pnpm nx run-many -t test,lint`; deploy `execution-adpt, broker-ctrl, broker-alpaca-adpt,
broker-sim-adpt` to dev; scoped integration + the new sim e2e.

## 9. Convention extension (reusable pattern)

This establishes a new clause for the typed-subject **home rule**:

> **Intra-domain *mutual* producer/consumer boundary** (services A and B in the same
> domain where each both produces an event the other consumes) → the boundary contracts
> live in the **domain adapter `/domain`**, authored there, imported by both — *not* in
> either service's `/contracts`. This mirrors the cross-domain adapter-`/domain` rule and
> avoids the A↔B project cycle that mutual `/contracts` imports would create.

Precedent: `FundingSnapshot` already lives in `execution-adpt/domain`. Document this in
the live convention docs/skills.

## 10. Risks

- **Moving `AlpacaTransferResultSchema`** touches broker-alpaca's local imports +
  publisher-schemas + contracts test. Mechanical; covered by the broker-alpaca unit suite
  and the `check-typed-subjects` gate.
- **nx cycle** — the placement is reasoned + measured, but the plan MUST re-run
  `nx graph` after the move to confirm no new cycle (and run the worktree on real deps,
  not symlinked node_modules — `worktree-symlink-masks-test-failures`).
- **Worktree commits** need `--no-verify` and per-commit verification
  (`worktree-commit-no-verify`).
- **Live path remains un-e2e'd** by design (paper API + relationshipId); integration with
  mocked Alpaca is the live gate. Acceptable per the validation decision.
